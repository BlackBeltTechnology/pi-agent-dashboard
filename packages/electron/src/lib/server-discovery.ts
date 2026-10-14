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

/** Discovery candidates are capped (a malicious LAN peer cannot make us probe unboundedly). */
const DISCOVERY_CANDIDATE_CAP = 3;
const HOST_SELECTION_DEADLINE_MS = 5000;

const sameRef = (a: HostRef, b: HostRef): boolean => a.scheme === b.scheme && a.host === b.host && a.port === b.port;

/** Preference order: stored https → stored http → discovered (deduplicated, discovery capped). */
export function buildCandidates(stored: HostRef[], discovered: HostRef[]): Candidate[] {
  const out: Candidate[] = [];
  const add = (ref: HostRef, source: Candidate["source"]) => {
    if (!out.some((c) => sameRef(c.ref, ref))) out.push({ ref, source });
  };
  for (const ref of stored.filter((r) => r.scheme === "https")) add(ref, "stored");
  for (const ref of stored.filter((r) => r.scheme !== "https")) add(ref, "stored");
  let discoveredAdded = 0;
  for (const ref of discovered) {
    if (discoveredAdded >= DISCOVERY_CANDIDATE_CAP) break;
    const before = out.length;
    add(ref, "discovered");
    if (out.length > before) discoveredAdded++;
  }
  return out;
}

/**
 * Challenge every candidate concurrently; the most-preferred accepting one wins.
 * Resolves as soon as the best remaining candidate is decided, and always by
 * `deadlineMs` (then the most-preferred accepted so far, else `null`).
 */
export function pickVerifiedHost(
  candidates: Candidate[],
  challenge: (origin: string, signal: AbortSignal) => Promise<boolean>,
  deadlineMs: number = HOST_SELECTION_DEADLINE_MS,
): Promise<Candidate | null> {
  return new Promise((resolve) => {
    if (candidates.length === 0) return resolve(null);
    const ac = new AbortController();
    // undefined = pending, true = accepted, false = rejected/failed
    const settled: Array<boolean | undefined> = candidates.map(() => undefined);
    let done = false;
    const finish = (c: Candidate | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ac.abort();
      resolve(c);
    };
    const best = (): number => settled.findIndex((s) => s === true);
    const check = () => {
      const b = best();
      const limit = b === -1 ? settled.length : b;
      const earlierPending = settled.slice(0, limit).some((s) => s === undefined);
      if (b !== -1 && !earlierPending) return finish(candidates[b] ?? null);
      if (b === -1 && settled.every((s) => s === false)) return finish(null);
    };
    const timer = setTimeout(() => {
      const b = best();
      finish(b === -1 ? null : (candidates[b] ?? null));
    }, deadlineMs);
    candidates.forEach((c, i) => {
      challenge(serverOrigin(c.ref), ac.signal).then(
        (ok) => {
          settled[i] = ok === true;
          check();
        },
        () => {
          settled[i] = false;
          check();
        },
      );
    });
  });
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
    addresses: (s.addresses ?? []).filter((a) => a !== s.host).slice(0, MAX_ADVERT_ADDRESSES),
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
    if (!s.isLocal) out.push(describeOne(s, opts));
  }
  return out;
}

// ── Lifecycle wrapper ────────────────────────────────────────────────────────

export interface ServerDiscoveryDeps {
  createBrowser?: () => DashboardBrowser;
  /** Prove the local dashboard's identity (local mode only); returns the fingerprint or undefined. */
  proveLocal?: () => Promise<string | undefined>;
  isPaired: (fp: string) => boolean;
  onChange?: () => void;
}

export interface ServerDiscovery {
  list(): DiscoveredEntry[];
  /** Resolve `localFp` once the local server is healthy (no-op without `proveLocal`, i.e. remote mode). */
  resolveLocalFp(): Promise<void>;
  /** True once the local dashboard's fingerprint is known. */
  hasLocalFp(): boolean;
  /** Raw adverts matching a fingerprint (for host healing). */
  advertsFor(fp: string): DiscoveredServer[];
  /** Raw adverts (for known-host checks). */
  raw(): DiscoveredServer[];
  stop(): void;
}

/** Start browsing (call at `app.whenReady`); `stop()` at quit. */
export function createServerDiscovery(deps: ServerDiscoveryDeps): ServerDiscovery {
  const browser = (deps.createBrowser ?? createBrowser)();
  let localFp: string | undefined;
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
    advertsFor: (fp) => Array.from(browser.servers.values()).filter((s) => !s.isLocal && s.fingerprint === fp),
    raw: () => Array.from(browser.servers.values()).filter((s) => !s.isLocal),
    stop: () => browser.stop(),
  };
}
