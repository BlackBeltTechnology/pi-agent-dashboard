/**
 * Framing probe — the dashboard's first outbound request made on a user's click,
 * to an attacker-influenced host. Everything here is SSRF defence:
 *
 *   - `https:` port 443, no userinfo, WHATWG-normalised host, on EVERY hop;
 *   - refuses everything the dashboard trusts (`isUngrantableEgressOrigin`,
 *     `classifyCorsOrigin`, the own-origin set) — an internal name, a tunnel, the PWA shell;
 *   - `dns.lookup(all)`; every address must be a public unicast address, and the
 *     socket is PINNED to the first vetted one (a dedicated `https.Agent` with a
 *     custom `lookup`, no proxy environment) so DNS rebinding cannot swap it;
 *   - `HEAD` only, origin root first, no cookies / `Authorization`, headers only
 *     (64 KB cap), socket destroyed; redirects re-enter the full check, ≤ 3 requests;
 *   - one 5 s overall deadline.
 *
 * Returns a verdict only; never the response. See change: rich-chat-links (design D12).
 */
import dns from "node:dns";
import type http from "node:http";
import https from "node:https";
import net from "node:net";
import {
  canonicalHttpsOrigin,
  isPublicUnicastAddress,
  isUngrantableEgressOrigin,
} from "@blackbelt-technology/pi-dashboard-shared/preview-egress.js";
import { type CorsOriginOptions, classifyCorsOrigin } from "../auth/cors-origin.js";
import { computeFrameVerdict, type FrameVerdict } from "./frame-policy-verdict.js";

export type ProbeVerdict = FrameVerdict | "ineligible";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type ProbeRequestFn = (options: https.RequestOptions, onResponse: (res: http.IncomingMessage) => void) => http.ClientRequest;

export interface ProbeDeps {
  /** Dashboard-own origins (tunnels, public base URLs, configured CORS origins). */
  ownOrigins: readonly string[];
  corsOpts: CorsOriginOptions;
  /** DNS seam (default `dns.promises.lookup(host, { all: true })`). */
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Transport seam (default `https.request`). */
  request?: ProbeRequestFn;
  deadlineMs?: number;
  /** Bounds DNS lookups that are still outstanding (default: one process-wide gate). */
  lookupGate?: LookupGate;
}

export interface ProbeResult {
  verdict: ProbeVerdict;
  /** Requests actually sent. */
  hops: number;
}

export const PROBE_DEADLINE_MS = 5000;
/** Total requests, the first included: A → B → C is the last connect, a redirect out of C is refused. */
export const MAX_PROBE_REQUESTS = 3;
const MAX_HEADER_BYTES = 64 * 1024;
const USER_AGENT = "pi-dashboard-frame-probe/1";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * `getaddrinfo` runs on libuv's 4-thread pool and cannot be cancelled: a hostname with slow DNS
 * keeps its thread long after the 5 s deadline abandoned the promise. The gate therefore counts a
 * lookup as outstanding until it actually SETTLES (not until the deadline), and refuses a new one
 * beyond `max` — kept below the pool size so file I/O and other DNS are never starved.
 */
export const MAX_OUTSTANDING_LOOKUPS = 3;

export interface LookupGate {
  /** A one-shot release, or null when `max` lookups are already outstanding. */
  tryAcquire(): (() => void) | null;
  readonly outstanding: number;
}

export function createLookupGate(max: number = MAX_OUTSTANDING_LOOKUPS): LookupGate {
  let outstanding = 0;
  return {
    get outstanding() {
      return outstanding;
    },
    tryAcquire() {
      if (outstanding >= max) return null;
      outstanding++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        outstanding--;
      };
    },
  };
}

const processLookupGate = createLookupGate();

const defaultLookup = async (hostname: string): Promise<ResolvedAddress[]> =>
  (await dns.promises.lookup(hostname, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family,
  }));

interface FinalResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
}

/** The hostname with IPv6 brackets stripped. */
function bareHost(u: URL): string {
  return u.hostname.startsWith("[") ? u.hostname.slice(1, -1) : u.hostname;
}

/** Per-hop checks (a) and (b): returns the canonical origin, or null when ineligible. */
function vetTarget(url: URL, deps: ProbeDeps, dashboardOrigin: string): string | null {
  // `URL.port` is "" for the default 443, so any non-empty port is refused.
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const canon = canonicalHttpsOrigin(url.origin);
  if (!canon) return null;
  const own = [...deps.ownOrigins, dashboardOrigin];
  if (isUngrantableEgressOrigin(canon, own)) return null;
  if (classifyCorsOrigin(canon, deps.corsOpts).allowed) return null;
  return canon;
}

/** A `lookup` for `net.connect` that can only ever answer with the vetted address. */
function pinnedLookup(vetted: ResolvedAddress) {
  return (_host: string, options: unknown, cb: (...args: unknown[]) => void): void => {
    const callback = (typeof options === "function" ? options : cb) as (...args: unknown[]) => void;
    const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
    if (all) callback(null, [{ address: vetted.address, family: vetted.family }]);
    else callback(null, vetted.address, vetted.family);
  };
}

/** HEAD one hop; resolves on the status line + headers, then tears the socket down. */
function head(
  url: URL,
  vetted: ResolvedAddress,
  request: ProbeRequestFn,
  signal: AbortSignal,
): Promise<FinalResponse> {
  return new Promise((resolve, reject) => {
    // A dedicated agent: never `https.globalAgent`, so a proxy env cannot re-resolve the target.
    const agent = new https.Agent({ keepAlive: false, maxSockets: 1, lookup: pinnedLookup(vetted) as never });
    const finish = () => agent.destroy();
    const req = request(
      {
        method: "HEAD",
        host: bareHost(url),
        port: 443,
        path: `${url.pathname}${url.search}`,
        agent,
        signal,
        maxHeaderSize: MAX_HEADER_BYTES,
        headers: { "user-agent": USER_AGENT, accept: "*/*" },
      },
      (res) => {
        const out = { status: res.statusCode ?? 0, headers: res.headers };
        res.destroy();
        req.destroy();
        finish();
        resolve(out);
      },
    );
    req.on("error", (err) => {
      finish();
      reject(err);
    });
    req.end();
  });
}

/** Everything a probe's hops share: seams, the deadline signal and its rejecting promise. */
interface ProbeEnv {
  deps: ProbeDeps;
  dashboardOrigin: string;
  lookup: (hostname: string) => Promise<ResolvedAddress[]>;
  gate: LookupGate;
  request: ProbeRequestFn;
  signal: AbortSignal;
  /** Rejects when the overall deadline fires. */
  aborted: Promise<never>;
}

/** A hop either ends the probe with a verdict or continues to the next (vetted-later) URL. */
type HopOutcome = { verdict: ProbeVerdict } | { next: URL };

const ineligible: HopOutcome = { verdict: "ineligible" };

/**
 * Addresses for `host`: a literal IP is taken as-is, a name goes through the (gated) lookup.
 * `"busy"` = the lookup gate is full (transient); `null` = the lookup failed or the deadline hit.
 */
async function resolveAddresses(host: string, env: ProbeEnv): Promise<ResolvedAddress[] | "busy" | null> {
  try {
    const ipFamily = net.isIP(host);
    if (ipFamily) return [{ address: host, family: ipFamily }];
    // Held until the lookup settles, however the probe ends. Over the cap: no lookup, transient.
    const release = env.gate.tryAcquire();
    if (!release) return "busy";
    const pending = (async () => env.lookup(host))();
    pending.then(release, release);
    return await Promise.race([pending, env.aborted]);
  } catch {
    return null;
  }
}

/** The `Location` of a followable redirect response, or null when this is not one. */
function redirectLocation(res: FinalResponse): string | null {
  const location = res.headers.location;
  return REDIRECT_STATUSES.has(res.status) && typeof location === "string" && location ? location : null;
}

function resolveRedirect(location: string, base: URL): URL | null {
  try {
    return new URL(location, base);
  } catch {
    return null;
  }
}

/** One full-vetted hop: vet, resolve, pin, HEAD, then a verdict or the redirect target. */
async function probeHop(url: URL, state: { hops: number }, env: ProbeEnv): Promise<HopOutcome> {
  const canon = vetTarget(url, env.deps, env.dashboardOrigin);
  if (!canon) return ineligible;
  const addresses = await resolveAddresses(bareHost(url), env);
  if (addresses === "busy") return { verdict: "undetermined" };
  if (!addresses || addresses.length === 0 || !addresses.every((a) => isPublicUnicastAddress(a.address))) {
    return ineligible;
  }
  state.hops++;
  let res: FinalResponse;
  try {
    res = await Promise.race([head(url, addresses[0], env.request, env.signal), env.aborted]);
  } catch {
    return { verdict: "undetermined" }; // timeout or reset AFTER a vetted connect
  }
  const location = redirectLocation(res);
  if (location === null) {
    return {
      verdict: computeFrameVerdict({
        status: res.status,
        headers: res.headers,
        targetOrigin: canon,
        dashboardOrigin: env.dashboardOrigin,
      }),
    };
  }
  if (state.hops >= MAX_PROBE_REQUESTS) return ineligible;
  const next = resolveRedirect(location, url);
  return next ? { next } : ineligible;
}

/**
 * Parse + vet the raw input, then keep the origin only: the user's path, query and fragment are
 * never sent. Vetting the raw input first matters — the rebuilt URL no longer carries userinfo.
 */
function rootUrlOf(rawOrigin: string, env: ProbeEnv): URL | null {
  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    return null;
  }
  if (!vetTarget(url, env.deps, env.dashboardOrigin)) return null;
  return new URL(`${url.origin}/`);
}

async function probeHops(rawOrigin: string, env: ProbeEnv): Promise<ProbeResult> {
  const state = { hops: 0 };
  let url = rootUrlOf(rawOrigin, env);
  if (!url) return { verdict: "ineligible", hops: 0 };
  for (;;) {
    const out = await probeHop(url, state, env);
    if (!("next" in out)) return { verdict: out.verdict, hops: state.hops };
    url = out.next;
  }
}

export async function probeFramePolicy(
  rawOrigin: string,
  dashboardOrigin: string,
  deps: ProbeDeps,
): Promise<ProbeResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.deadlineMs ?? PROBE_DEADLINE_MS);
  const aborted = new Promise<never>((_, reject) => {
    ctl.signal.addEventListener("abort", () => reject(new Error("deadline")), { once: true });
  });
  aborted.catch(() => {}); // never an unhandled rejection when the probe finishes first
  const env: ProbeEnv = {
    deps,
    dashboardOrigin,
    lookup: deps.lookup ?? defaultLookup,
    gate: deps.lookupGate ?? processLookupGate,
    request: deps.request ?? ((o, cb) => https.request(o, cb)),
    signal: ctl.signal,
    aborted,
  };
  try {
    return await probeHops(rawOrigin, env);
  } finally {
    clearTimeout(timer);
  }
}
