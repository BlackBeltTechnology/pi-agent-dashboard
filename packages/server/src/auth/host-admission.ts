/**
 * Pure host-admission decision (D1) + the `admitted` source classifier the
 * `GET /api/host-gate` endpoint renders.
 *
 * Independent of `Origin`: the gate keys on the `Host` header itself, because a
 * DNS-rebinding page is same-origin with the dashboard and its plain GETs carry
 * no `Origin` at all (issue #637). Everything here is pure and side-effect
 * free so it is unit-tested against the REAL code the hook calls.
 *
 * See change: add-host-allowlist-admission.
 */
import { isIP } from "node:net";
import {
  type HostGateAdmittedSource,
  hostnameFromUrl,
  parseHostname,
} from "@blackbelt-technology/pi-dashboard-shared/host-admission.js";

export interface HostAdmissionOptions {
  /** Top-level `allowedHosts` (live). */
  allowedHosts?: string[];
  /** Every public base URL, incl. the legacy `pairing.publicBaseUrls` (live, via `livePublicBaseUrls`). */
  publicBaseUrls?: string[];
  /** `cors.allowedOrigins` (live). */
  configuredOrigins?: string[];
  /** Every CURRENTLY connected tunnel origin (live). */
  getLiveTunnelOrigins?: () => string[];
  /** The address the listener was bound to (boot-time `ServerConfig.host`). */
  bindHost?: string;
}

/** The source labels the operator UI renders, in first-match order (D1). */
export type AdmittedSource = HostGateAdmittedSource;

/** Normalize an `allowedHosts` / bind-address entry the same way a parsed Host is. */
function normalizeName(value: string): string {
  let v = value.trim().toLowerCase();
  if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
  return v.replace(/\.$/, "");
}

function isLoopbackLiteral(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/** `<label>.local` with a non-empty label — `.local` itself is refused (D3). */
function isLocalName(hostname: string): boolean {
  return hostname.endsWith(".local") && hostname.length > ".local".length;
}

function hostnameInUrlList(list: string[] | undefined, hostname: string): boolean {
  for (const raw of list ?? []) {
    if (hostnameFromUrl(raw) === hostname) return true;
  }
  return false;
}

/**
 * Live tunnel origins, fail-empty (X4): a tunnel source that throws must
 * never 500 a request — the host falls back to the other admission rules.
 */
export function safeLiveTunnelOrigins(opts: HostAdmissionOptions): string[] {
  try {
    return opts.getLiveTunnelOrigins?.() ?? [];
  } catch {
    return [];
  }
}

/**
 * First matching admissible source for an already-normalized hostname, or
 * `null` when the hostname is not admissible. Order is D1's: IP literals before
 * the bind name, derived URL lists before the explicit `allowedHosts`.
 */
export function classifyAdmittedHostname(
  hostname: string,
  opts: HostAdmissionOptions,
): AdmittedSource | null {
  if (isLoopbackLiteral(hostname)) return "loopback";
  // Any IP literal is admitted (D1): rebinding needs a NAME whose answer
  // changes; a browser that dialled an IP resolved nothing. Keeps the wildcard
  // bind and plain-LAN pairing working with no operator action.
  if (isIP(hostname) !== 0) return "ip-address";
  if (opts.bindHost && normalizeName(opts.bindHost) === hostname) return "bind-address";
  if (isLocalName(hostname)) return "local";
  if (hostnameInUrlList(opts.publicBaseUrls, hostname)) return "public-base-url";
  if (hostnameInUrlList(opts.configuredOrigins, hostname)) return "cors-origin";
  if (hostnameInUrlList(safeLiveTunnelOrigins(opts), hostname)) return "live-tunnel";
  if ((opts.allowedHosts ?? []).some((entry) => normalizeName(entry) === hostname)) {
    return "allowed-host";
  }
  return null;
}

/**
 * The admission decision. `hostHeader` is the raw `Host` header; a missing or
 * malformed value fails closed.
 */
export function isHostAdmitted(
  hostHeader: string | undefined,
  opts: HostAdmissionOptions,
): boolean {
  const hostname = parseHostname(hostHeader);
  if (!hostname) return false;
  return classifyAdmittedHostname(hostname, opts) !== null;
}
