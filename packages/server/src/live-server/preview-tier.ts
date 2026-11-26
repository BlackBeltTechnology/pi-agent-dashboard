/**
 * Tier selection at mint (D1): a pure decision from the raw `Host`, the socket peer and the resolved
 * `liveServer.previewOrigins`. The first match wins, filtered by what the client `accept`s.
 *
 *   1  localhost / 127.0.0.1 Host + genuinely local peer + plain socket   → http://<label>.localhost[:port]
 *   2  Host ∈ wildcard.forHosts (+ scheme / ancestors rules)               → <scheme>://<label>.<suffix>[:port]
 *   3  port pool            (group 7 — not selected here yet)
 *   4  IPv4 Host + ipDnsSuffix + plain socket + http ancestors             → http://<label>.<a-b-c-d>.<suffix>:<port>
 *   5  port target + client accepts `preview`  (group 8 — reported, not minted here yet)
 *   legacy                                                                 → /live/<id>/~c/<token>/
 *
 * `isGenuinelyLocal` is a REACHABILITY predicate here (can this browser resolve `*.localhost` to the dashboard?),
 * never a trust grant: authorization stays with the principal. Every refusal names a closed `reason` for the log;
 * the raw Host is never echoed.
 *
 * See change: serve-live-previews-on-capability-origin (D1).
 */
import { isIP } from "node:net";
import type { ResolvedPreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import { splitHostHeader } from "./preview-origin.js";

type MintTier = 1 | 2 | 4;
type MintTierOrPool = MintTier | 3;
type MintReason =
  | "disabled"
  | "no-accept"
  | "malformed-host"
  | "ipv6-host"
  | "ipv6-ancestors"
  | "non-local-peer"
  | "forwarding-headers"
  | "tls-socket"
  | "no-match";

export interface TierInput {
  hostHeader: string | undefined;
  /** The accepting socket's local port (used when `Host` carries none). */
  socketPort: number | undefined;
  /** `isGenuinelyLocal`: loopback peer AND no forwarding header. */
  genuinelyLocal: boolean;
  /** Was a core forwarding header present? Only for the log reason. */
  forwardingHeaders: boolean;
  /** Raw socket TLS (`request.raw.socket.encrypted`), never `request.protocol`. */
  socketTls: boolean;
  /** The mint request's `Origin` header. */
  originHeader: string | undefined;
  resolved: ResolvedPreviewOrigins;
  /** The raw `accept` body value (untrusted). */
  accept: unknown;
  kind: "port" | "static";
  /**
   * Tier 3 (D5): can THIS principal on THIS Host have a pool listener? True only for a login-session principal (a `Path=/`
   * cookie) whose Host IP is the bind address or a local interface address, with a pool configured and not exhausted.
   * Absent = false.
   */
  poolEligible?: boolean;
}

export type TierDecision =
  | {
      tier: MintTier;
      ancestors: string[];
      /** Builds the capability origin from a freshly generated label. */
      buildOrigin: (label: string) => { origin: string; originHost: string };
      reason?: undefined;
    }
  /** `tier5`: the client accepts `preview`, the target is a port target and previews are on (group 8 mints it). */
  /** Tier 3: the caller allocates a pool listener for `hostIp` (falls back to {@link selectMintTier} with `poolEligible:false`). */
  | { tier: 3; ancestors: string[]; hostIp: string; reason?: undefined }
  | { tier: "legacy" | "tier5"; reason: MintReason };

const ACCEPT_MAX_ENTRIES = 8;

/** `accept` negotiation: array only, first 8 entries, case-sensitive, unknown tokens ignored. Never throws. */
export function parseAccept(raw: unknown): { origin: boolean; preview: boolean } {
  const out = { origin: false, preview: false };
  if (!Array.isArray(raw)) return out;
  for (const token of raw.slice(0, ACCEPT_MAX_ENTRIES)) {
    if (token === "origin") out.origin = true;
    else if (token === "preview") out.preview = true;
  }
  return out;
}

const DEFAULT_PORT = { http: 80, https: 443 } as const;
const portPart = (port: number | undefined, scheme: "http" | "https"): string =>
  port === undefined || port === DEFAULT_PORT[scheme] ? "" : `:${port}`;

/** Canonical `Origin` of the mint request, or `null` when absent / unusable (opaque `null`, non-http, path, userinfo). */
function canonicalOrigin(origin: string | undefined): { origin: string; hostname: string } | null {
  if (typeof origin !== "string" || origin.length === 0 || origin.length > 300) return null;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return null;
  return { origin: u.origin, hostname: u.hostname };
}

const isLoopbackIpv4 = (hostname: string): boolean => hostname.startsWith("127.");

/** A canonical dotted IPv4 Host text: no trailing dot, no leading zeros (the `isIP` round trip). */
const IPV4_TEXT = /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/;

/** What the per-tier matchers share, derived once from the request. */
interface TierCtx {
  input: TierInput;
  raw: string;
  host: { hostname: string; port?: number };
  ancestors: string[];
  ancestorScheme: "http" | "https";
  port: number | undefined;
}

type TierMatch = Extract<TierDecision, { tier: MintTierOrPool }> | { refuse: MintReason } | null;

function matchTier1(c: TierCtx): TierMatch {
  const { hostname } = c.host;
  if (!(hostname === "localhost" || (hostname === "127.0.0.1" && IPV4_TEXT.test(hostname)))) return null;
  if (c.input.socketTls) return { refuse: "tls-socket" };
  if (!c.input.genuinelyLocal) return { refuse: c.input.forwardingHeaders ? "forwarding-headers" : "non-local-peer" };
  return {
    tier: 1,
    ancestors: c.ancestors,
    buildOrigin: (label) => {
      const originHost = `${label}.localhost${portPart(c.port, "http")}`;
      return { origin: `http://${originHost}`, originHost };
    },
  };
}

function matchTier2(c: TierCtx): TierMatch {
  const { resolved } = c.input;
  const wc = resolved.wildcard;
  if (!wc || !resolved.tiers.includes(2)) return null;
  if (!wc.forHosts.some((h) => h.toLowerCase().replace(/\.$/, "") === c.host.hostname)) return null;
  const scheme = wc.scheme ?? "https";
  const ok = scheme === "https" ? c.ancestorScheme === "https" : !c.input.socketTls && c.ancestorScheme === "http";
  if (!ok) return null;
  return {
    tier: 2,
    ancestors: c.ancestors,
    buildOrigin: (label) => {
      const originHost = `${label}.${wc.suffix}${portPart(wc.port, scheme)}`;
      return { origin: `${scheme}://${originHost}`, originHost };
    },
  };
}

function matchTier3(c: TierCtx): TierMatch {
  const { resolved } = c.input;
  const { hostname } = c.host;
  if (!c.input.poolEligible || !resolved.pool || !resolved.tiers.includes(3)) return null;
  // canonical dotted IPv4 only, never loopback (tier 1 owns it), plain http on both the socket and the ancestor
  if (!IPV4_TEXT.test(hostname) || isIP(hostname) !== 4 || isLoopbackIpv4(hostname) || c.raw.split(":")[0].endsWith(".")) return null;
  if (c.input.socketTls || c.ancestorScheme !== "http") return null;
  return { tier: 3, ancestors: c.ancestors, hostIp: hostname };
}

function matchTier4(c: TierCtx): TierMatch {
  const { resolved } = c.input;
  const suffix = resolved.ipDnsSuffix;
  const { hostname } = c.host;
  if (!suffix || !resolved.tiers.includes(4)) return null;
  // canonical dotted IPv4 only: `192.168.1.5.` / `192.168.001.005` fail the round trip
  if (!IPV4_TEXT.test(hostname) || isIP(hostname) !== 4 || isLoopbackIpv4(hostname) || c.raw.split(":")[0].endsWith(".")) return null;
  if (c.input.socketTls || c.ancestorScheme !== "http") return null;
  const dashed = hostname.replaceAll(".", "-");
  return {
    tier: 4,
    ancestors: c.ancestors,
    buildOrigin: (label) => {
      const originHost = `${label}.${dashed}.${suffix}${portPart(c.port, "http")}`;
      return { origin: `http://${originHost}`, originHost };
    },
  };
}

export function selectMintTier(input: TierInput): TierDecision {
  const { resolved } = input;
  if (!resolved.enabled) return { tier: "legacy", reason: "disabled" };
  const accept = parseAccept(input.accept);
  if (!accept.origin && !accept.preview) return { tier: "legacy", reason: "no-accept" };
  const tier5: TierDecision =
    accept.preview && input.kind === "port" ? { tier: "tier5", reason: "no-match" } : { tier: "legacy", reason: "no-match" };
  if (!accept.origin) return tier5;

  const raw = input.hostHeader?.trim() ?? "";
  const host = splitHostHeader(raw);
  if (!host) return { ...tier5, reason: "malformed-host" };
  if (raw.startsWith("[") || host.hostname.includes(":")) return { ...tier5, reason: "ipv6-host" };

  const fallbackScheme = input.socketTls ? "https" : "http";
  const ancestor = canonicalOrigin(input.originHeader);
  const ancestorOrigin = ancestor?.origin ?? `${fallbackScheme}://${host.hostname}${host.port === undefined ? "" : `:${host.port}`}`;
  const ancestorHostname = ancestor?.hostname ?? host.hostname;
  // CSP has no IPv6 host-source form: an IPv6 ancestors host skips tiers 1-4.
  if (ancestorHostname.startsWith("[") || ancestorHostname.includes(":")) return { ...tier5, reason: "ipv6-ancestors" };
  const c: TierCtx = {
    input,
    raw,
    host,
    ancestors: [ancestorOrigin],
    ancestorScheme: ancestorOrigin.startsWith("https:") ? "https" : "http",
    port: host.port ?? input.socketPort,
  };
  // First match wins; tier 3's listener is allocated by the caller (the pool), not here.
  for (const match of [matchTier1, matchTier2, matchTier3, matchTier4]) {
    const m = match(c);
    if (m && "refuse" in m) return { ...tier5, reason: m.refuse };
    if (m) return m;
  }
  return { ...tier5, reason: "no-match" };
}
