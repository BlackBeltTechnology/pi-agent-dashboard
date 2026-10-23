/**
 * Who is calling, as far as the dashboard-state guard and the prompt-eligibility
 * rule care — built from the SAME admission predicates the guard uses, never a
 * second one.
 *
 * - `gatedAdmitted`: locally trusted NOW (proof, or the strict default is off) OR
 *   a login session. A paired-device bearer is not enough: it cannot read the
 *   dashboard's own config.
 * - `unproven`: a bare-loopback caller refused only for want of proof
 *   (`needsLocalProof`); its containment misses never raise an operator prompt.
 *
 * Both are evaluated lazily, so an auth source that tags the request after this
 * is built (cookie, bearer) is still seen.
 *
 * See change: close-container-loopback-impersonation (D8).
 */
import type { FastifyRequest } from "fastify";
import type { StateCaller } from "../lib/dashboard-state-guard.js";
import type { LocalTrustContext } from "./local-proof.js";
import { isLocallyTrusted, needsLocalProof } from "./localhost-guard.js";

export function stateCallerFor(request: FastifyRequest, localTrust: LocalTrustContext | undefined): StateCaller {
  return {
    gatedAdmitted: () =>
      isLocallyTrusted({ ip: request.ip, headers: request.headers as Record<string, unknown> }, localTrust) ||
      (request as { authVia?: string }).authVia === "session",
    unproven: () => needsLocalProof(request as unknown as { ip: string; headers: unknown; isAuthenticated?: boolean }, localTrust),
  };
}
