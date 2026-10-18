/**
 * The `operate` authority predicate and the `operate_required` refusal shared by
 * the vault routes (`/api/vault*`) and the service mutation routes
 * (`/api/services*`). One predicate, one body builder — so the disclosure rule
 * lives in one place.
 *
 * Disclosure: the body has exactly five keys (`OperateRequiredBody`). The request's
 * ip, headers and auth markers are read only to derive `reason` and `use-host`;
 * none of them is emitted. `sign-in` is the one server-configuration fact exposed.
 * `request-access` is the deliberate exception to `canDiscloseAccessPosture`: it
 * discloses exactly what the public knock route already answers the same caller
 * (Host admitted? on-link?), never the operator switch or a trusted network.
 * See change: surface-operate-required-remedy, add-request-access-remedy.
 */

import {
  OPERATE_REMEDY_ORDER,
  type OperateRemedy,
  type OperateRequiredBody,
  type OperateRequiredReason,
} from "@blackbelt-technology/pi-dashboard-shared/operate-required.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { LocalTrustContext } from "./local-proof.js";
import { isLocallyTrusted } from "./localhost-guard.js";
import { tierRefusalFor } from "./route-tier-gate.js";

/** Which route family is refusing — selects the fixed message. */
type OperateRoute = "vault" | "services";

/** Fixed `message` per route family and reason (spec table). */
const MESSAGES: Record<OperateRoute, Record<OperateRequiredReason, string>> = {
  vault: {
    "no-credential": "the vault needs an operate-tier credential or a locally trusted caller",
    "tier-too-low": "the vault needs an operate-tier credential; this device's credential has a lower tier",
  },
  services: {
    "no-credential": "service mutations need an operate-tier credential or a locally trusted caller",
    "tier-too-low": "service mutations need an operate-tier credential; this device's credential has a lower tier",
  },
};

type Marked = { authVia?: string; principalTier?: string };

/**
 * May this request use an `operate`-gated route? An `operate` device bearer, any
 * authenticated operator session or identity principal, or a locally trusted
 * caller (strict-mode aware). Moved verbatim from `canManageVault` /
 * `canMutateServices`. The services routes keep this predicate; the vault is
 * stricter (a session needs `operate`, a principal needs the host policy).
 * See change: retro-ux-credential-vault (D11).
 */
export function hasOperateAuthority(request: FastifyRequest, localTrust?: LocalTrustContext): boolean {
  const via = (request as Marked).authVia;
  if (via === "device") return (request as Marked).principalTier === "operate";
  if (via === "session" || via === "principal") return true;
  return isLocallyTrusted({ ip: request.ip, headers: request.headers as Record<string, unknown> }, localTrust);
}

/**
 * Would a mutating (`operate`-gated) route accept this request? Exactly the two
 * checks such a route passes: `hasOperateAuthority` AND the route-tier gate at
 * tier `operate` (a `control`-tier login session passes the first, is refused
 * by the second). One predicate shared by `GET /api/services` (`canOperate`)
 * so the client's gating never disagrees with the server.
 * See change: add-services-settings-ui (D8).
 */
export function canOperate(
  request: FastifyRequest,
  deps: { getTrustedNetworks: () => string[]; localTrust?: LocalTrustContext },
): boolean {
  return (
    hasOperateAuthority(request, deps.localTrust) &&
    tierRefusalFor(request, "operate", deps.getTrustedNetworks, deps.localTrust) === null
  );
}

export interface SendOperateRequiredOptions {
  route: OperateRoute;
  /** Called per refusal: is a usable login method configured right now? */
  loginAvailable: () => boolean;
  /**
   * Would the knock's pre-switch gates pass for this caller (and does it hold no
   * verified local credential)? Absent ⇒ `request-access` is never offered.
   */
  requestAccessAvailable?: (request: FastifyRequest) => boolean;
}

/** Derive reason + remedies for a refused request. Pure of side effects. */
function describeOperateRefusal(
  request: FastifyRequest,
  loginAvailable: () => boolean,
  requestAccessAvailable?: (request: FastifyRequest) => boolean,
): { reason: OperateRequiredReason; remedies: OperateRemedy[] } {
  const marked = request as Marked;
  // A paired device or a login session below `operate` holds a credential that is too weak.
  // (Only the vault refuses a session: `hasOperateAuthority` still admits one for services.)
  const tiered = marked.authVia === "device" || marked.authVia === "session";
  const reason: OperateRequiredReason = tiered && marked.principalTier !== "operate" ? "tier-too-low" : "no-credential";
  const wanted = new Set<OperateRemedy>();
  // No strict ctx ⇒ `isLocallyTrusted` is exactly "loopback and no proxy forwarding
  // header" (the one local-trust predicate; E18 forbids calling `isGenuinelyLocal` here).
  // `use-host` is withheld from a caller already on the host, proof or not.
  if (!isLocallyTrusted({ ip: request.ip, headers: request.headers as Record<string, unknown> })) wanted.add("use-host");
  if (reason === "tier-too-low" && marked.authVia === "device") wanted.add("re-pair");
  // Only a caller holding no verified credential at all (a revoked bearer counts as none).
  if (marked.authVia === undefined && requestAccessAvailable?.(request) === true) wanted.add("request-access");
  if (loginAvailable()) wanted.add("sign-in");
  return { reason, remedies: OPERATE_REMEDY_ORDER.filter((r) => wanted.has(r)) };
}

/** Send the 403 `operate_required` refusal. */
export async function sendOperateRequired(
  request: FastifyRequest,
  reply: FastifyReply,
  opts: SendOperateRequiredOptions,
): Promise<void> {
  const { reason, remedies } = describeOperateRefusal(request, opts.loginAvailable, opts.requestAccessAvailable);
  const body: OperateRequiredBody = {
    success: false,
    error: "operate_required",
    message: MESSAGES[opts.route][reason],
    reason,
    remedies,
  };
  await reply.code(403).send(body);
}
