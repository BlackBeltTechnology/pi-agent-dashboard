import { promises as dnsPromises } from "node:dns";
import { isIP } from "node:net";
import type { DnsApi } from "./types.js";

/**
 * Authoritative-DNS access for the ACME source: zone discovery over DoH (SOA walk → NS names → NS addresses)
 * and propagation / CNAME checks queried straight at each authoritative server, never a recursive resolver
 * (a negative answer cached there would mask a fix). Falls back to "both DoH resolvers" when port 53 is blocked.
 * See change: add-acme-dns01-certs (design D3, tasks 3.3).
 */

/** One authoritative server's query surface (a `dns.promises.Resolver` in production). */
export interface AuthoritativeResolver {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
}

/** Builds a resolver bound to one server's addresses (IPv4 first) and port. */
type ResolverFactory = (addresses: string[], port: number) => AuthoritativeResolver;

export interface CreateDnsApiOptions {
  fetchImpl?: typeof fetch;
  resolverFactory?: ResolverFactory;
  /** Host name → IP, used only to turn an `authoritativeOverride` host into an address. */
  lookupImpl?: (host: string) => Promise<string>;
  /** E2E seam: replaces NS discovery with this single server (the caller guards the env var). */
  authoritativeOverride?: { host: string; port: number };
  /** Default interval between propagation rounds (default 5000). */
  intervalMs?: number;
  /** Default propagation bound (default 180000). */
  timeoutMs?: number;
  /** Per-server query bound (default 3000). */
  queryTimeoutMs?: number;
}

const DOH_ENDPOINTS = [
  { name: "cloudflare-dns.com", url: "https://cloudflare-dns.com/dns-query" },
  { name: "dns.google", url: "https://dns.google/resolve" },
] as const;

const FETCH_TIMEOUT_MS = 30_000;
const DNS_PORT = 53;
const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_QUERY_TIMEOUT_MS = 3_000;

const DNS_TYPE = { A: 1, NS: 2, SOA: 6, TXT: 16, AAAA: 28 } as const;
/** Codes that mean "the server answered: no such record" (not a transport problem). */
const NO_RECORD_CODES = new Set(["ENODATA", "ENOTFOUND"]);
/** Codes that mean the server was not reachable on port 53. */
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ETIMEOUT", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ECANCELLED"]);

interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

interface Server {
  host: string;
  addresses: string[];
}

interface Probe {
  /** Display name for errors (`host (addr)` or a DoH resolver name). */
  label: string;
  ok: boolean;
  reason: string;
  unreachable: boolean;
}

const normName = (s: string): string => s.trim().toLowerCase().replace(/\.$/, "");

function errCode(err: unknown): string | undefined {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : undefined;
}

function errText(err: unknown): string {
  const code = errCode(err);
  const msg = err instanceof Error ? err.message : String(err);
  return code && !msg.includes(code) ? `${code}: ${msg}` : msg;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(signal?: AbortSignal): Error {
  return new Error(`DNS propagation wait aborted${signal?.reason instanceof Error ? `: ${signal.reason.message}` : ""}`);
}

/** Rejects with `code: "ETIMEOUT"` when `p` has not settled within `ms` (fake-timer friendly). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(`no answer within ${ms} ms`), { code: "ETIMEOUT" })), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function defaultResolverFactory(queryTimeoutMs: number): ResolverFactory {
  return (addresses, port) => {
    const resolver = new dnsPromises.Resolver({ timeout: queryTimeoutMs, tries: 1 });
    resolver.setServers(addresses.map((a) => (isIP(a) === 6 ? `[${a}]:${port}` : `${a}:${port}`)));
    return resolver;
  };
}

/** Parses a DoH TXT `data` field (`"a" "b"` or a bare string) into the concatenated value. */
function parseTxtData(data: string): string {
  const parts = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, "$1"));
  return parts.length > 0 ? parts.join("") : data;
}

/** Proper suffixes of `name`, longest first, down to the single-label TLD. */
function suffixes(name: string): string[] {
  const labels = normName(name).split(".");
  return labels.map((_, i) => labels.slice(i).join("."));
}

export function createDnsApi(opts: CreateDnsApiOptions = {}): DnsApi {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const queryTimeoutMs = opts.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const makeResolver = opts.resolverFactory ?? defaultResolverFactory(queryTimeoutMs);
  const lookupHost = opts.lookupImpl ?? (async (host: string) => (await dnsPromises.lookup(host)).address);
  const defaultInterval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const defaultTimeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const port = opts.authoritativeOverride?.port ?? DNS_PORT;

  async function dohQuery(endpoint: (typeof DOH_ENDPOINTS)[number], name: string, type: keyof typeof DNS_TYPE, signal?: AbortSignal): Promise<DohAnswer[]> {
    const url = `${endpoint.url}?name=${encodeURIComponent(name)}&type=${type}`;
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const res = await fetchImpl(url, { headers: { accept: "application/dns-json" }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { Status?: number; Answer?: DohAnswer[] };
    // 0 = NOERROR, 3 = NXDOMAIN (both are answers); anything else is a resolver failure.
    if (body.Status !== 0 && body.Status !== 3) throw new Error(`DNS status ${body.Status}`);
    return body.Answer ?? [];
  }

  /** First DoH resolver that answers wins; both failing is an error. */
  async function dohAny(name: string, type: keyof typeof DNS_TYPE): Promise<DohAnswer[]> {
    const failures: string[] = [];
    for (const endpoint of DOH_ENDPOINTS) {
      try {
        return await dohQuery(endpoint, name, type);
      } catch (err) {
        failures.push(`${endpoint.name}: ${errText(err)}`);
      }
    }
    throw new Error(`DoH ${type} lookup for ${name} failed (${failures.join("; ")})`);
  }

  async function overrideServer(override: { host: string; port: number }): Promise<Server> {
    const address = isIP(override.host) ? override.host : await lookupHost(override.host);
    return { host: override.host, addresses: [address] };
  }

  async function discoverZone(name: string): Promise<{ zone: string; servers: Server[] }> {
    const owner = normName(name);
    if (opts.authoritativeOverride) return { zone: owner, servers: [await overrideServer(opts.authoritativeOverride)] };

    let zone: string | null = null;
    for (const suffix of suffixes(owner)) {
      const answer = await dohAny(suffix, "SOA");
      if (answer.some((a) => a.type === DNS_TYPE.SOA && normName(a.name) === suffix)) {
        zone = suffix;
        break;
      }
    }
    if (!zone) throw new Error(`no DNS zone (SOA) found for ${owner}`);

    const nsNames = [...new Set((await dohAny(zone, "NS")).filter((a) => a.type === DNS_TYPE.NS).map((a) => normName(a.data)))];
    if (nsNames.length === 0) throw new Error(`zone ${zone} has no NS records`);
    const servers: Server[] = [];
    for (const host of nsNames) {
      const [v4, v6] = await Promise.all([dohAny(host, "A").catch(() => []), dohAny(host, "AAAA").catch(() => [])]);
      const addresses = [...v4.filter((a) => a.type === DNS_TYPE.A), ...v6.filter((a) => a.type === DNS_TYPE.AAAA)].map((a) => a.data);
      servers.push({ host, addresses });
    }
    return { zone, servers };
  }

  /** Runs `query` against every server in parallel, each bounded by the per-server timeout. */
  function probeServers<T>(servers: Server[], query: (r: AuthoritativeResolver) => Promise<T>): Promise<Array<{ server: Server; value?: T; error?: unknown }>> {
    return Promise.all(
      servers.map(async (server) => {
        if (server.addresses.length === 0) return { server, error: Object.assign(new Error("no address resolved"), { code: "ENOADDRESS" }) };
        try {
          return { server, value: await withTimeout(query(makeResolver(server.addresses, port)), queryTimeoutMs) };
        } catch (error) {
          return { server, error };
        }
      }),
    );
  }

  async function resolveCnameAtAuthoritative(owner: string) {
    const { servers } = await discoverZone(owner);
    const name = normName(owner);
    const results = await probeServers(servers, (r) => r.resolveCname(name));
    const perServer = results.map(({ server, value, error }) => {
      if (error === undefined) return { server: server.host, target: value && value.length > 0 ? normName(value[0]) : null };
      if (NO_RECORD_CODES.has(errCode(error) ?? "")) return { server: server.host, target: null };
      return { server: server.host, target: null, error: errText(error) };
    });
    if (perServer.every((s) => s.error !== undefined)) {
      throw new Error(`CNAME lookup for ${name} failed at every authoritative server (${perServer.map((s) => `${s.server}: ${s.error}`).join("; ")})`);
    }
    const targets = [...new Set(perServer.map((s) => s.target).filter((t): t is string => t !== null))];
    return { targets, perServer };
  }

  async function authoritativeRound(servers: Server[], owner: string, value: string): Promise<Probe[]> {
    const results = await probeServers(servers, (r) => r.resolveTxt(owner));
    return results.map(({ server, value: txts, error }) => {
      const label = `${server.host} (${server.addresses.join(",") || "no address"})`;
      if (error === undefined) {
        const found = (txts ?? []).some((chunks) => chunks.join("") === value);
        return { label, ok: found, reason: "TXT value not present", unreachable: false };
      }
      const code = errCode(error) ?? "";
      if (NO_RECORD_CODES.has(code)) return { label, ok: false, reason: "TXT value not present", unreachable: false };
      const text = code === "ETIMEOUT" ? `no answer within ${queryTimeoutMs} ms` : errText(error);
      return { label, ok: false, reason: text, unreachable: UNREACHABLE_CODES.has(code) || code === "ENOADDRESS" };
    });
  }

  async function dohRound(owner: string, value: string, signal?: AbortSignal): Promise<Probe[]> {
    return Promise.all(
      DOH_ENDPOINTS.map(async (endpoint): Promise<Probe> => {
        try {
          const answer = await dohQuery(endpoint, owner, "TXT", signal);
          const found = answer.some((a) => a.type === DNS_TYPE.TXT && parseTxtData(a.data) === value);
          return { label: endpoint.name, ok: found, reason: "TXT value not present", unreachable: false };
        } catch (error) {
          return { label: endpoint.name, ok: false, reason: errText(error), unreachable: false };
        }
      }),
    );
  }

  /**
   * Polls `round` every `intervalMs` (start-to-start, so a slow round never stretches the cadence) until it is
   * all-ok. Rounds start strictly before the bound; at the bound the call fails naming the lagging servers.
   * `fallbackOnUnreachable`: when the FIRST round finds every server unreachable, return `"unreachable"`.
   */
  async function poll(
    owner: string,
    round: () => Promise<Probe[]>,
    bounds: { intervalMs: number; timeoutMs: number; signal?: AbortSignal },
    fallbackOnUnreachable: boolean,
  ): Promise<"ok" | "unreachable"> {
    const start = Date.now();
    const deadline = start + bounds.timeoutMs;
    for (let i = 0; ; i++) {
      if (bounds.signal?.aborted) throw abortError(bounds.signal);
      const probes = await round();
      if (probes.every((p) => p.ok)) return "ok";
      if (i === 0 && fallbackOnUnreachable && probes.every((p) => p.unreachable)) return "unreachable";
      const nextStart = start + (i + 1) * bounds.intervalMs;
      if (nextStart >= deadline) {
        await sleep(deadline - Date.now(), bounds.signal);
        const lagging = probes.filter((p) => !p.ok).map((p) => `${p.label}: ${p.reason}`);
        throw new Error(`TXT ${owner} not visible after ${Math.round(bounds.timeoutMs / 1000)}s; lagging: ${lagging.join("; ")}`);
      }
      await sleep(nextStart - Date.now(), bounds.signal);
    }
  }

  async function waitForTxt(owner: string, value: string, wait: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal }) {
    const name = normName(owner);
    const bounds = { intervalMs: wait.intervalMs ?? defaultInterval, timeoutMs: wait.timeoutMs ?? defaultTimeout, signal: wait.signal };
    const { servers } = await discoverZone(name);
    const direct = await poll(name, () => authoritativeRound(servers, name, value), bounds, true);
    if (direct === "ok") return { mode: "authoritative" as const };
    // Port 53 is blocked: weaker check — both DoH resolvers must return the value.
    await poll(name, () => dohRound(name, value, wait.signal), bounds, false);
    return { mode: "doh-fallback" as const };
  }

  return { discoverZone, resolveCnameAtAuthoritative, waitForTxt };
}
