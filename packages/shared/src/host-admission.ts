/**
 * Host-admission primitives shared by the server gate and the Settings editor.
 *
 * One regex parses a raw `Host` header (`host[:port]`, IPv6 in brackets); a
 * second validates a bare hostname an operator types into `allowedHosts`. The
 * client validates with the SAME `isValidBareHostname` the gate parses with, so
 * a name the gate could never admit (`my_service.docker`, `https://x:9443/`) is
 * refused at entry instead of saved inert (design D8).
 *
 * Browser-safe (no node builtins): the client imports it.
 * See change: add-host-allowlist-admission.
 */

/** A raw `Host` header value: host[:port], IPv6 literal in brackets. */
export const HOST_HEADER_RE = /^[A-Za-z0-9.\-[\]:]+$/;

/**
 * A bare hostname or IP literal — no scheme, no port, no path. Labels are
 * alnum/hyphen (so an underscore like `my_service.docker` is refused), each
 * `[a-z0-9]([a-z0-9-]*[a-z0-9])?`, up to 253 chars total.
 */
export const BARE_HOSTNAME_RE =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/** Host-admission rollout mode (browser-safe home — the client imports it). */
export type HostGateMode = "report" | "enforce";

/** Does `value` look like a bare hostname the gate could admit? */
export function isValidBareHostname(value: string): boolean {
  return BARE_HOSTNAME_RE.test(value);
}

/** The admission-source labels `GET /api/host-gate` reports and the UI renders. */
export type HostGateAdmittedSource =
  | "loopback"
  | "ip-address"
  | "bind-address"
  | "local"
  | "public-base-url"
  | "cors-origin"
  | "live-tunnel"
  | "allowed-host";

/** One row of the operator-visible *Currently admitted* list. */
export interface HostGateAdmittedRow {
  host: string;
  source: HostGateAdmittedSource;
}

/** One refusal in the *Recent refusals* ring. */
export interface HostGateRecentEntry {
  host: string;
  count: number;
  lastSeen: number;
  outcome: "refused" | "would-refuse";
}

/** The `GET /api/host-gate` response body. */
export interface HostGateResponse {
  success: true;
  mode: HostGateMode;
  envOverridden: boolean;
  admitted: HostGateAdmittedRow[];
  recent: HostGateRecentEntry[];
}

/**
 * Normalize a `Host` header to its bare hostname: strip the port, strip IPv6
 * brackets, drop a single trailing dot, lower-case. Returns `null` when the
 * value is absent or does not parse as `host[:port]` / `[v6][:port]` — an
 * unbracketed IPv6 literal (ambiguous colon) also fails closed, since browsers
 * always bracket it.
 */
export function parseHostname(hostHeader: string | undefined | null): string | null {
  if (typeof hostHeader !== "string") return null;
  const value = hostHeader.trim();
  if (!value || !HOST_HEADER_RE.test(value)) return null;
  if (value.startsWith("[")) return parseBracketed(value);

  const colon = value.indexOf(":");
  if (colon === -1) {
    const host = value.replace(/\.$/, "").toLowerCase();
    return host || null;
  }
  // A second colon means either a malformed value or an (unbracketed) IPv6
  // literal. Return it lower-cased and let `net.isIP` decide admission — a
  // genuine IPv6 literal is admitted by the IP-literal rule, everything else
  // fails closed there.
  if (value.indexOf(":", colon + 1) !== -1) return value.toLowerCase();
  if (!/^\d{1,5}$/.test(value.slice(colon + 1))) return null;
  const host = value.slice(0, colon).replace(/\.$/, "").toLowerCase();
  return host || null;
}

/** `[v6]` / `[v6]:port` → lower-cased inner, or `null` when malformed. */
function parseBracketed(value: string): string | null {
  const end = value.indexOf("]");
  if (end === -1) return null;
  const rest = value.slice(end + 1);
  if (rest && !/^:\d{1,5}$/.test(rest)) return null;
  const inner = value.slice(1, end);
  return inner ? inner.toLowerCase() : null;
}

/**
 * The hostname of a URL entry (`publicBaseUrls`, `cors.allowedOrigins`, tunnel
 * origins), normalized the same way as a parsed `Host`. Unparseable entries
 * return `null` and the caller skips them — never throws (design D1/D2).
 */
export function hostnameFromUrl(raw: string | undefined | null): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    let h = new URL(raw).hostname;
    if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
    h = h.replace(/\.$/, "").toLowerCase();
    return h || null;
  } catch {
    return null;
  }
}
