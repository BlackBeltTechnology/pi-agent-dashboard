/**
 * Main-process discovery of other dashboards + the pure identity/host helpers
 * the server-window flows share.
 *
 * Pure helpers (no Electron, no I/O — unit-tested in
 * `__tests__/server-discovery.test.ts`): `shortFingerprint`, `isFingerprint`,
 * `serverOrigin`, `partitionFor`, `resolveExpectedFingerprint`,
 * `identityVerdict`, `buildCandidates`, `pickVerifiedHost`,
 * `describeDiscovered`. `createServerDiscovery` wraps the shared mDNS browser.
 *
 * See change: add-electron-server-windows (D3, D6, D10).
 */
import crypto from "node:crypto";
import net from "node:net";
import type { NetworkInterfaceInfo } from "node:os";
import { sanitizeDisplayName } from "@blackbelt-technology/pi-dashboard-shared/display-name.js";
import { createBrowser, type DashboardBrowser, type DiscoveredServer } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";

export { sanitizeDisplayName };

type Scheme = "http" | "https";

/** A host a server was last seen at. */
export interface HostRef {
  scheme: Scheme;
  host: string;
  port: number;
}

/** `sha256:` + 43 base64url chars — the only fingerprint shape accepted from a renderer. */
const FINGERPRINT_RE = /^sha256:[A-Za-z0-9_-]{43}$/;

export function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT_RE.test(value);
}

const PLAIN_HOST_RE = /^[A-Za-z0-9.:_-]+$/;

/** A hostname / IPv4 / IPv6 literal with no URL-significant characters (`#`, `/`, `@`, `?`, spaces, brackets). */
export function isPlainHost(host: unknown): host is string {
  return typeof host === "string" && host.length > 0 && host.length <= 253 && PLAIN_HOST_RE.test(host);
}

export function isValidPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** `sha256:` + first 16 chars of the base64url part (96 bits) — the one shared short form. */
export function shortFingerprint(fp: string): string {
  const b64 = fp.startsWith("sha256:") ? fp.slice("sha256:".length) : fp;
  return `sha256:${b64.slice(0, 16)}`;
}

/** Origin of a host reference; IPv6 literals are bracketed. */
export function serverOrigin(ref: HostRef): string {
  const host = ref.host.includes(":") && !ref.host.startsWith("[") ? `[${ref.host}]` : ref.host;
  return `${ref.scheme}://${host}:${ref.port}`;
}

/**
 * Storage partition for a server: derived ONLY from the proven fingerprint.
 * `persist:` is added only when the entry is remembered (cookie stays off disk otherwise).
 */
export function partitionFor(fp: string, remembered: boolean): string {
  const name = `server-${crypto.createHash("sha256").update(fp).digest("hex").slice(0, 32)}`;
  return remembered ? `persist:${name}` : name;
}

// ── Expected identity (D3) ───────────────────────────────────────────────────

export type ExpectedFingerprint =
  | { kind: "expected"; fingerprint: string }
  | { kind: "tofu" }
  | { kind: "mismatch"; pin: string; advert: string };

/** `expected = pin ?? advert`; pin and advert both present and different ⇒ mismatch. */
export function resolveExpectedFingerprint(pin: string | undefined, advert: string | undefined): ExpectedFingerprint {
  if (pin && advert && pin !== advert) return { kind: "mismatch", pin, advert };
  const fingerprint = pin ?? advert;
  return fingerprint ? { kind: "expected", fingerprint } : { kind: "tofu" };
}

export type IdentityVerdict = "proceed" | "tofu-confirm" | "mismatch" | "unverifiable";

/** `proven`: the fingerprint the address proved, or `"unreachable"` when the challenge could not complete. */
export function identityVerdict(input: {
  pin?: string;
  advert?: string;
  proven: string | "unreachable";
}): IdentityVerdict {
  const expected = resolveExpectedFingerprint(input.pin, input.advert);
  if (expected.kind === "mismatch") return "mismatch";
  if (input.proven === "unreachable") return "unverifiable";
  if (expected.kind === "tofu") return "tofu-confirm";
  return input.proven === expected.fingerprint ? "proceed" : "mismatch";
}

// ── Host selection (D6) ──────────────────────────────────────────────────────

export interface Candidate {
  ref: HostRef;
  source: "stored" | "discovered";
}

/** Challenges run in ordered batches of this size until one proves the pin or the deadline passes. */
const CANDIDATE_BATCH_SIZE = 12;
/** At most this many literals are kept per hostname (a hostile name cannot fan out the probing). */
export const LITERALS_PER_NAME_CAP = 8;
/** A hostname that has not resolved by now counts as unreachable (inside the 5 s selection deadline). */
const LOOKUP_TIMEOUT_MS = 2000;
export const HOST_SELECTION_DEADLINE_MS = 5000;

/** Resolve a hostname to its address literals (`dns.promises.lookup({ all: true })` in production). */
export type LookupFn = (hostname: string) => Promise<string[]>;

const sameRef = (a: HostRef, b: HostRef): boolean => a.scheme === b.scheme && a.host === b.host && a.port === b.port;

/**
 * Resolve an `http` hostname ref to its address literals (≤ 8, deduplicated); an
 * `https` ref, an IP literal, or a missing `lookup` keeps the ref as is. A
 * lookup that fails or stalls past `timeoutMs` yields no literals (unreachable).
 *
 * See change: harden-peer-address-identity (D1).
 */
export async function expandRef(ref: HostRef, lookup?: LookupFn, timeoutMs: number = LOOKUP_TIMEOUT_MS): Promise<HostRef[]> {
  if (!lookup || ref.scheme === "https" || net.isIP(ref.host)) return [ref];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addrs = await Promise.race([
      lookup(ref.host),
      new Promise<string[]>((_, reject) => {
        timer = setTimeout(() => reject(new Error("lookup timeout")), timeoutMs);
      }),
    ]);
    const unique = Array.from(new Set(addrs.filter((a) => typeof a === "string" && net.isIP(a) !== 0)));
    return unique.slice(0, LITERALS_PER_NAME_CAP).map((host) => ({ ...ref, host }));
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type Ifaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

const stripZone = (addr: string): string => addr.split("%")[0] ?? addr;

/** Prefix length of an interface address: its `cidr` suffix, else the bit count of its `netmask`. */
function prefixLength(info: NetworkInterfaceInfo): number | null {
  const fromCidr = Number(info.cidr?.split("/")[1]);
  if (Number.isInteger(fromCidr) && fromCidr >= 0) return fromCidr;
  if (!info.netmask) return null;
  const bits = info.family === "IPv6" ? 128 : 32;
  let count = 0;
  const parts = info.netmask.includes(":")
    ? info.netmask.split(":").map((h) => (h === "" ? 0 : Number.parseInt(h, 16)))
    : info.netmask.split(".").map(Number);
  for (const part of parts) {
    if (!Number.isFinite(part)) return null;
    for (let v = part; v > 0; v >>= 1) count += v & 1;
  }
  return count <= bits ? count : null;
}

/**
 * Order discovered literals: addresses inside a local interface's own prefix
 * (netmask/cidr, IPv4 and IPv6, never a fixed /64) first, this machine's own
 * addresses last, the rest between; stable inside each class, nothing dropped.
 *
 * See change: harden-peer-address-identity (D5).
 */
export function orderByLocality(literals: string[], interfaces: Ifaces): string[] {
  const { own, onLink } = interfaceSets(interfaces);
  const rank = (lit: string): number => {
    const addr = stripZone(lit);
    if (own.has(addr)) return 2;
    const family = net.isIPv6(addr) ? "ipv6" : net.isIPv4(addr) ? "ipv4" : null;
    return family && onLink.check(addr, family) ? 0 : 1;
  };
  return literals
    .map((lit, i) => ({ lit, i, r: rank(lit) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.lit);
}

/** This machine's own addresses and the subnets its (non-internal) interfaces sit on. */
function interfaceSets(interfaces: Ifaces): { own: Set<string>; onLink: net.BlockList } {
  const own = new Set<string>();
  const onLink = new net.BlockList();
  for (const info of Object.values(interfaces).flatMap((infos) => infos ?? [])) {
    own.add(stripZone(info.address));
    const prefix = info.internal ? null : prefixLength(info);
    if (prefix === null) continue;
    try {
      onLink.addSubnet(stripZone(info.address), prefix, info.family === "IPv6" ? "ipv6" : "ipv4");
    } catch {
      /* malformed interface entry — not used for locality */
    }
  }
  return { own, onLink };
}

/** Preference order: stored https → stored http → discovered (deduplicated; batching bounds the probing, not a cap). */
export function buildCandidates(stored: HostRef[], discovered: HostRef[]): Candidate[] {
  const out: Candidate[] = [];
  const add = (ref: HostRef, source: Candidate["source"]) => {
    if (!out.some((c) => sameRef(c.ref, ref))) out.push({ ref, source });
  };
  for (const ref of stored.filter((r) => r.scheme === "https")) add(ref, "stored");
  for (const ref of stored.filter((r) => r.scheme !== "https")) add(ref, "stored");
  for (const ref of discovered) add(ref, "discovered");
  return out;
}

/**
 * Challenge one batch concurrently. Resolves with the most-preferred accepting candidate as soon as every
 * more-preferred one has settled, or `null` once all are rejected. `onAccepted` sees the best accepted so far.
 */
function decideBatch(
  batch: Candidate[],
  challenge: (origin: string, signal: AbortSignal) => Promise<boolean>,
  signal: AbortSignal,
  onAccepted: (c: Candidate) => void,
): Promise<Candidate | null> {
  return new Promise((resolve) => {
    // undefined = pending, true = accepted, false = rejected/failed
    const settled: Array<boolean | undefined> = batch.map(() => undefined);
    const check = () => {
      const best = settled.findIndex((v) => v === true);
      if (best === -1) return settled.every((v) => v === false) ? resolve(null) : undefined;
      onAccepted(batch[best]!);
      if (!settled.slice(0, best).some((v) => v === undefined)) resolve(batch[best]!);
    };
    batch.forEach((c, i) => {
      const done = (ok: boolean) => {
        settled[i] = ok;
        check();
      };
      challenge(serverOrigin(c.ref), signal).then((ok) => done(ok === true), () => done(false));
    });
  });
}

/**
 * Challenge candidates in ordered batches of {@link CANDIDATE_BATCH_SIZE}, each batch concurrently; the
 * most-preferred accepting one wins. A batch that accepts nothing starts the next. Always resolves by
 * `deadlineMs` (then the most-preferred accepted so far, else `null`).
 */
export async function pickVerifiedHost(
  candidates: Candidate[],
  challenge: (origin: string, signal: AbortSignal) => Promise<boolean>,
  deadlineMs: number = HOST_SELECTION_DEADLINE_MS,
  batchSize: number = CANDIDATE_BATCH_SIZE,
): Promise<Candidate | null> {
  if (candidates.length === 0) return null;
  const ac = new AbortController();
  let accepted: Candidate | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const batches = async (): Promise<Candidate | null> => {
    for (let start = 0; start < candidates.length && !ac.signal.aborted; start += batchSize) {
      const best = await decideBatch(candidates.slice(start, start + batchSize), challenge, ac.signal, (c) => {
        accepted = c;
      });
      if (best) return best;
    }
    return null;
  };
  // The deadline answers with whatever the running batch already accepted.
  const deadline = new Promise<Candidate | null>((resolve) => {
    timer = setTimeout(() => resolve(accepted), deadlineMs);
  });
  try {
    return await Promise.race([batches(), deadline]);
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}

// ── Discovered list (D10) ────────────────────────────────────────────────────

type DiscoveredState = "not-paired" | "paired" | "identity-not-advertised";

export interface DiscoveredEntry {
  /** Stable key for the list (mDNS instance, else host:port). */
  key: string;
  /** Sanitised, ≤ 64 bytes; falls back to the host. */
  name: string;
  host: string;
  port: number;
  /** Additional advert addresses (capped) — used as host-selection candidates. */
  addresses: string[];
  fingerprint?: string;
  state: DiscoveredState;
  /** Set for a non-local advert carrying this dashboard's own fingerprint. */
  note?: "same identity as this dashboard";
}

/** mDNS is unauthenticated: bound what one LAN peer (or a flood of them) can put in the list. */
const MAX_DISCOVERED_ENTRIES = 200;
const MAX_ADVERT_ADDRESSES = 8;

export interface DescribeOptions {
  /** Fingerprints that have a keyring entry. */
  isPaired: (fp: string) => boolean;
  /** Fingerprint of the local dashboard (local mode only). */
  localFp?: string;
}

/** One advert → one list entry (names sanitised, clones of the local identity labelled). */
function describeOne(s: DiscoveredServer, opts: DescribeOptions): DiscoveredEntry {
  // A malformed advertised fingerprint can never be proven: treat it as "not advertised".
  const fp = isFingerprint(s.fingerprint) ? s.fingerprint : undefined;
  const state: DiscoveredState = !fp ? "identity-not-advertised" : opts.isPaired(fp) ? "paired" : "not-paired";
  const clone = !!fp && !!opts.localFp && fp === opts.localFp;
  return {
    key: s.instance ?? `${s.host}:${s.port}`,
    name: sanitizeDisplayName(s.name, s.host),
    host: s.host,
    port: s.port,
    addresses: (s.addresses ?? []).filter((a) => a !== s.host && isPlainHost(a)).slice(0, MAX_ADVERT_ADDRESSES),
    ...(fp ? { fingerprint: fp } : {}),
    state,
    ...(clone ? { note: "same identity as this dashboard" as const } : {}),
  };
}

/** Map adverts to list entries: local adverts dropped, list bounded. */
export function describeDiscovered(servers: Iterable<DiscoveredServer>, opts: DescribeOptions): DiscoveredEntry[] {
  const out: DiscoveredEntry[] = [];
  for (const s of servers) {
    if (out.length >= MAX_DISCOVERED_ENTRIES) break;
    // Untrusted advert: only well-formed host/port become list entries (and later URL origins).
    if (!s.isLocal && isPlainHost(s.host) && isValidPort(s.port)) out.push(describeOne(s, opts));
  }
  return out;
}

// ── Lifecycle wrapper ────────────────────────────────────────────────────────

export interface ServerDiscoveryDeps {
  createBrowser?: () => DashboardBrowser;
  /** Prove the local dashboard's identity (local mode only); returns the fingerprint or undefined. */
  proveLocal?: () => Promise<string | undefined>;
  /** False in remote mode (no local server ⇒ no `self`). Evaluated lazily; default: `proveLocal` present. */
  hasLocalServer?: () => boolean;
  isPaired: (fp: string) => boolean;
  onChange?: () => void;
}

export interface ServerDiscovery {
  list(): DiscoveredEntry[];
  /** Resolve `localFp` once the local server is healthy (no-op without `proveLocal`, i.e. remote mode). */
  resolveLocalFp(): Promise<void>;
  /** True once the local dashboard's fingerprint is known. */
  hasLocalFp(): boolean;
  /** This machine's own fingerprint: proven, `"none"` (no local server — nothing is `self`), or `undefined` while unresolved. */
  localFp(): string | "none" | undefined;
  /** Adverts carrying a fingerprint (locality flag ignored; adverts of this machine's own fingerprint excluded). */
  advertsFor(fp: string): DiscoveredServer[];
  /** Raw adverts (for known-host checks). */
  raw(): DiscoveredServer[];
  stop(): void;
}

/** Start browsing (call at `app.whenReady`); `stop()` at quit. */
export function createServerDiscovery(deps: ServerDiscoveryDeps): ServerDiscovery {
  let localFp: string | undefined;
  const browser = (deps.createBrowser ?? (() => createBrowser({ ownFingerprint: () => localFp })))();
  const notify = () => deps.onChange?.();
  browser.on("server-up", notify);
  browser.on("server-update", notify);
  browser.on("server-down", notify);
  return {
    list: () => describeDiscovered(browser.servers.values(), { isPaired: deps.isPaired, localFp }),
    async resolveLocalFp() {
      if (!deps.proveLocal) return;
      try {
        localFp = await deps.proveLocal();
      } catch {
        localFp = undefined;
      }
      notify();
    },
    hasLocalFp: () => localFp !== undefined,
    localFp: () => {
      if (localFp !== undefined) return localFp;
      return deps.proveLocal && (deps.hasLocalServer?.() ?? true) ? undefined : "none";
    },
    // Selection never uses the locality flag: an advert falsely claiming this machine's fingerprint
    // can only hide itself, never the pinned server's adverts (D3).
    advertsFor: (fp) => Array.from(browser.servers.values()).filter((s) => s.fingerprint === fp && s.fingerprint !== localFp),
    raw: () => Array.from(browser.servers.values()).filter((s) => !s.isLocal),
    stop: () => browser.stop(),
  };
}
