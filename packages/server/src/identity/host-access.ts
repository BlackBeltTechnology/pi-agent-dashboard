/**
 * Non-session HTTP road gate (openspec §7.3 / §8.4, design D9). The optional
 * host access policy governs only NON-session roads (OpenSpec, branch,
 * terminal, system, and other global commands). Session roads are owner-gated
 * (§8.1) and never routed here.
 *
 * Inert by construction: when no policy is registered the gate returns `true`
 * and the road discloses exactly as today. Only once a `trustedPolicyPlugin`
 * has registered a policy does the road become gated.
 */
import type { HostAction, HostResource, Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";

/** The slice of `PolicyRegistry` this gate needs (keeps callers decoupled). */
export interface HostPolicy {
  hasPolicy(): boolean;
  authorize(input: { principal: Principal; action: HostAction; resource: HostResource }): Promise<boolean>;
}

/**
 * Gate a non-session HTTP road. Returns `true` to proceed.
 *
 * - No policy registered ⇒ proceed (ungated, today's behavior).
 * - Policy registered but no request principal ⇒ deny `403` (nothing to
 *   authorize; the plane is active and this road is now protected).
 * - Otherwise the policy decides; `false`/throw/timeout ⇒ deny `403`
 *   (`PolicyRegistry.authorize` is itself fail-closed + audited).
 *
 * `403` (not `404`): a non-session road's existence is not owner-secret, so no
 * existence-hiding oracle is needed here — unlike the session gate's `404`.
 */
export async function gateHttpNonSession(
  reply: { code(status: number): unknown },
  policy: HostPolicy,
  principal: Principal | null | undefined,
  action: HostAction,
  resource: HostResource,
): Promise<boolean> {
  if (!policy.hasPolicy()) return true; // ungated — exactly today
  if (!principal) {
    reply.code(403);
    return false;
  }
  if (await policy.authorize({ principal, action, resource })) return true;
  reply.code(403);
  return false;
}
