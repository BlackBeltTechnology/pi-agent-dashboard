/**
 * Pure decision core for the live-server preview viewer (change:
 * improve-canvas-html-and-url-ux, design D3/D4/D5/D9). No React, no I/O.
 *
 * - Provenance → policy: an operator action opens with OPEN egress, every other
 *   open (agent auto-open, chip tap, undeclared surface) is RESTRICTED.
 * - Policy → frame `sandbox` (the D3 table). `allow-same-origin` is never a token.
 * - Exposure → whether restricted scripts need the operator's "Run scripts".
 * - `live:` / `static:` tab-path parsing and frame-src composition.
 */
import { isLoopbackUrl, validateAddressPath } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import type { PreviewPolicy } from "../api/live-server-api.js";

export type Opener = "operator" | "agent";

/** Egress is fixed by who opened the preview (preview-egress-grants "Egress policy is fixed by provenance"). */
export function egressForOpener(opener: Opener): PreviewPolicy["egress"] {
  return opener === "operator" ? "open" : "restricted";
}

/**
 * Frame `sandbox` token string for a policy (design D3 table):
 * open+scripts → 4 tokens; restricted+scripts → `allow-scripts allow-forms`;
 * scripts off → empty (the attribute stays present).
 */
export function sandboxFor(policy: PreviewPolicy): string {
  if (!policy.scripts) return "";
  return policy.egress === "open"
    ? "allow-scripts allow-forms allow-popups allow-downloads"
    : "allow-scripts allow-forms";
}

/** Inputs of the wanted-policy decision. */
export interface WantedPolicyInput {
  opener: Opener;
  /** The Scripts ⇄ Static toggle (static targets); `true` for port targets. */
  scriptsOn: boolean;
  /** The dashboard is exposed (fail closed when unknown). */
  exposed: boolean;
  /** The operator clicked "Run scripts" during the current exposure epoch. */
  runScriptsApproved: boolean;
}

/**
 * The policy to request on a mint. A RESTRICTED preview on an exposed dashboard
 * asks for scripts only after the operator's "Run scripts" click; open egress
 * (an operator opened it) is not gated by exposure.
 */
export function wantedPolicy(i: WantedPolicyInput): PreviewPolicy {
  const egress = egressForOpener(i.opener);
  const gated = egress === "restricted" && i.exposed && !i.runScriptsApproved;
  return { egress, scripts: i.scriptsOn && !gated };
}

/** True when scripts are wanted (toggle on) but withheld by exposure: show "Run scripts". */
export function needsRunScripts(i: WantedPolicyInput): boolean {
  return egressForOpener(i.opener) === "restricted" && i.exposed && !i.runScriptsApproved && i.scriptsOn;
}

/** A `live:` / `static:` tab path decoded. */
export type PresetPath =
  | { kind: "port"; host: string; port: number; deep: string }
  | { kind: "static"; file: string }
  | { kind: "invalid-path" };

/**
 * Parse `live:<loopback url>` / `static:<file>` tab paths. `live:preview`, empty
 * and non-loopback payloads return `null` (→ picker). A loopback URL whose deep
 * path fails `validateAddressPath` is `invalid-path` (frame nothing).
 */
export function parsePresetPath(viewerPath: string | undefined): PresetPath | null {
  if (!viewerPath) return null;
  if (viewerPath.startsWith("static:")) {
    const file = viewerPath.slice("static:".length);
    return file ? { kind: "static", file } : null;
  }
  if (!viewerPath.startsWith("live:")) return null;
  const target = viewerPath.slice("live:".length);
  if (!isLoopbackUrl(target)) return null;
  try {
    const u = new URL(target);
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    // Strip IPv6 brackets so the host matches the server allowlist.
    const host = u.hostname.replace(/^\[|\]$/g, "");
    // `URL` resolves dot-segments itself; the raw tab payload is what the agent supplied.
    const raw = target.replace(/^https?:\/\/[^/?#]*/i, "");
    const checked = validateAddressPath(raw === "" ? "/" : raw);
    if (!checked.ok) return { kind: "invalid-path" };
    return { kind: "port", host, port, deep: checked.path };
  } catch {
    return null;
  }
}

/** Compose a frame `src` from the API base, a minted capability path and a validated deep path. */
export function frameSrc(apiBase: string, capabilityPath: string, deep: string): string {
  return `${apiBase}${capabilityPath}${deep}`;
}

export type AddressTarget =
  | { kind: "same"; deep: string }
  | { kind: "other"; host: string; port: number; deep: string }
  | { kind: "error"; reason: "invalid-path" | "loopback-only" | "invalid" };

/**
 * Classify an address-bar submission against the framed target (design D9).
 * Port target: a bare path (`/x`, `x`) or a URL on the same host:port → `same`;
 * another loopback host:port → `other` (inline confirm); non-loopback → error.
 * Static target: only a path is meaningful; a URL is refused.
 */
export function classifyAddress(
  input: string,
  current: { kind: "static" } | { kind: "port"; host: string; port: number },
): AddressTarget {
  const raw = input.trim();
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  if (!isUrl) {
    const v = validateAddressPath(raw);
    return v.ok ? { kind: "same", deep: v.path } : { kind: "error", reason: "invalid-path" };
  }
  if (current.kind === "static") return { kind: "error", reason: "loopback-only" };
  if (!isLoopbackUrl(raw)) return { kind: "error", reason: "loopback-only" };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { kind: "error", reason: "invalid" };
  }
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const rest = raw.replace(/^https?:\/\/[^/?#]*/i, "");
  const v = validateAddressPath(rest === "" ? "/" : rest);
  if (!v.ok) return { kind: "error", reason: "invalid-path" };
  const sameHost = host === current.host || (isLocalName(host) && isLocalName(current.host));
  return sameHost && port === current.port
    ? { kind: "same", deep: v.path }
    : { kind: "other", host, port, deep: v.path };
}

const isLocalName = (h: string): boolean => h === "localhost" || h === "127.0.0.1" || h === "::1";

/** True when the dashboard page itself is served from this machine (a genuinely local operator). */
export function isLocalOperator(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".localhost");
}

/** `http://<host>:<port>/<deep>` — the target's own address (IPv6 hosts bracketed). */
export function localTargetUrl(host: string, port: number, deep: string): string {
  const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${h}:${port}/${deep}`;
}

/** Decode an encoded deep path for display; falls back to the raw text. */
export function displayDeep(deep: string): string {
  try {
    return decodeURI(deep);
  } catch {
    return deep;
  }
}
