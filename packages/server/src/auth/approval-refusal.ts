/**
 * Reason + remedies for a refused pairing approval (`POST /api/pair/approve`,
 * `/approve-pending`, `/deny` → 401). Pure of side effects; the approval guard
 * attaches the result to its 401 body only when the request's `Host` was
 * admitted, so a non-admitted Host learns nothing new.
 *
 * Disclosure: the request's ip, headers and auth markers are read only to derive
 * `reason` and the remedies; none of them is emitted. `sign-in` is the one
 * server-configuration fact exposed. Never throws: a malformed `Host` or a
 * throwing `loginAvailable` thunk only drops the remedy that depended on it.
 * See change: fix-pairing-approval-credential (D5/D7).
 */

import { isLauncherOrigin } from "@blackbelt-technology/pi-dashboard-shared/launcher-origin.js";
import {
  PAIRING_REMEDY_ORDER,
  type PairingApprovalRemedy,
  type PairingRefusalReason,
} from "@blackbelt-technology/pi-dashboard-shared/pairing-refusal.js";
import type { FastifyRequest } from "fastify";
import { hasLocalProof, type LocalTrustContext } from "./local-proof.js";
import { isLocallyTrusted } from "./localhost-guard.js";

export interface ApprovalRefusalOptions {
  /** Is a usable login method configured right now? Absent or throwing ⇒ no `sign-in`. */
  loginAvailable?: () => boolean;
  /** The server's configured port; absent ⇒ no `authorize-browser`. */
  configPort?: number;
  /** Did the request's `Host` pass host admission (enforce semantics)? */
  hostAdmitted: boolean;
  /**
   * Proof context. When given, a request already carrying a valid local proof is
   * never offered `authorize-browser` (it needs no authorising). The guard never
   * refuses such a request, so this only matters to direct callers.
   */
  localTrust?: LocalTrustContext;
}

/** Reason + remedies the guard appends to its 401; `null` when the Host was not admitted. */
export type ApprovalRefusal = { reason: PairingRefusalReason; remedies: PairingApprovalRemedy[] };

/** Does the `Host` header name an origin `pi-dashboard open --url` would accept? Never throws. */
function hostIsLauncherOrigin(host: unknown, configPort: number | undefined): boolean {
  if (typeof host !== "string" || host.length === 0 || configPort === undefined) return false;
  try {
    const u = new URL(`http://${host}`);
    // A Host is `hostname[:port]` only: userinfo, path, query or fragment make it malformed.
    if (u.username !== "" || u.password !== "" || u.pathname !== "/" || u.search !== "" || u.hash !== "") return false;
    if (host.includes("@") || host.includes("/") || host.includes("?") || host.includes("#")) return false;
    return isLauncherOrigin(u.hostname, u.port, configPort);
  } catch {
    return false;
  }
}

function safeLoginAvailable(loginAvailable: (() => boolean) | undefined): boolean {
  if (!loginAvailable) return false;
  try {
    return loginAvailable() === true;
  } catch {
    return false;
  }
}

/**
 * Derive `{reason, remedies}` for a refused approval, or `null` when the Host was
 * not admitted (the caller then sends the legacy two-key body).
 */
export function describeApprovalRefusal(request: FastifyRequest, opts: ApprovalRefusalOptions): ApprovalRefusal | null {
  if (!opts.hostAdmitted) return null;
  // A paired device holds a credential that can never approve: no remedy helps it.
  if ((request as { authVia?: string }).authVia === "device") return { reason: "device-credential", remedies: [] };
  const wanted = new Set<PairingApprovalRemedy>(["approve-on-host"]);
  // No strict ctx ⇒ `isLocallyTrusted` is exactly "loopback and no proxy forwarding
  // header" (same call shape as operate-required.ts): a transport-local test, identical
  // in strict and non-strict mode. The remedy is also withheld unless the request's own
  // origin is one `pi-dashboard open --url` accepts, else the command would be a dead end.
  if (
    isLocallyTrusted({ ip: request.ip, headers: request.headers as Record<string, unknown> }) &&
    hostIsLauncherOrigin(request.headers.host, opts.configPort) &&
    !(opts.localTrust && hasLocalProof(request.headers as Record<string, unknown>, opts.localTrust))
  ) {
    wanted.add("authorize-browser");
  }
  if (safeLoginAvailable(opts.loginAvailable)) wanted.add("sign-in");
  return { reason: "no-credential", remedies: PAIRING_REMEDY_ORDER.filter((r) => wanted.has(r)) };
}
