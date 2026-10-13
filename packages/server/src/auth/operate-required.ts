/**
 * The `operate` authority predicate and the `operate_required` refusal shared by
 * the vault routes (`/api/vault*`) and the service mutation routes
 * (`/api/services*`). One predicate, one body builder — so the disclosure rule
 * lives in one place.
 *
 * Disclosure: the body has exactly five keys (`OperateRequiredBody`). The request's
 * ip, headers and auth markers are read only to derive `reason` and `use-host`;
 * none of them is emitted. `sign-in` is the one server-configuration fact exposed.
 * See change: surface-operate-required-remedy.
 */

import {
  OPERATE_REMEDY_ORDER,
  type OperateRemedy,
  type OperateRequiredBody,
  type OperateRequiredReason,
} from "@blackbelt-technology/pi-dashboard-shared/operate-required.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { LocalTrustContext } from "./local-proof.js";
import { isGenuinelyLocal, isLocallyTrusted } from "./localhost-guard.js";

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
 * `canMutateServices`.
 */
export function hasOperateAuthority(request: FastifyRequest, localTrust?: LocalTrustContext): boolean {
  const via = (request as Marked).authVia;
  if (via === "device") return (request as Marked).principalTier === "operate";
  if (via === "session" || via === "principal") return true;
  return isLocallyTrusted({ ip: request.ip, headers: request.headers as Record<string, unknown> }, localTrust);
}

export interface SendOperateRequiredOptions {
  route: OperateRoute;
  /** Called per refusal: is a usable login method configured right now? */
  loginAvailable: () => boolean;
}

/** Derive reason + remedies for a refused request. Pure of side effects. */
export function describeOperateRefusal(
  request: FastifyRequest,
  loginAvailable: () => boolean,
): { reason: OperateRequiredReason; remedies: OperateRemedy[] } {
  const marked = request as Marked;
  const reason: OperateRequiredReason =
    marked.authVia === "device" && marked.principalTier !== "operate" ? "tier-too-low" : "no-credential";
  const wanted = new Set<OperateRemedy>();
  if (!isGenuinelyLocal(request.ip, request.headers as Record<string, unknown>)) wanted.add("use-host");
  if (reason === "tier-too-low") wanted.add("re-pair");
  if (loginAvailable()) wanted.add("sign-in");
  return { reason, remedies: OPERATE_REMEDY_ORDER.filter((r) => wanted.has(r)) };
}

/** Send the 403 `operate_required` refusal. */
export async function sendOperateRequired(
  request: FastifyRequest,
  reply: FastifyReply,
  opts: SendOperateRequiredOptions,
): Promise<void> {
  const { reason, remedies } = describeOperateRefusal(request, opts.loginAvailable);
  const body: OperateRequiredBody = {
    success: false,
    error: "operate_required",
    message: MESSAGES[opts.route][reason],
    reason,
    remedies,
  };
  await reply.code(403).send(body);
}
