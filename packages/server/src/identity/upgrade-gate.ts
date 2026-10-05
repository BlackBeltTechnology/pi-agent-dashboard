/**
 * Policy gate for token-ticketed WS upgrades that are NOT the browser socket —
 * `/ws/terminal/<id>` and `/live/*` (D9/D24, review B2 of task 18.13). A ticket
 * proves WHO connects; the optional host policy still decides WHETHER that
 * principal may reach the non-session road (`terminal.read`, `live.read`), exactly
 * as it does for the HTTP road and the browser bootstrap. Bounded and fail-closed
 * through `PolicyRegistry.authorize`; the break-glass operator is never denied.
 *
 * Pure over injected deps. See change: add-multi-user-identity-plane.
 */
import type { HostAction, HostResource, Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { isLocalOperator } from "./session-access.js";

export interface UpgradeGatePolicy {
  hasPolicy(): boolean;
  authorize(input: { principal: Principal; action: HostAction; resource: HostResource }): Promise<boolean>;
}

/** `true` ⇒ proceed with the upgrade. Never throws: a policy fault is a denial. */
export async function authorizeRoadUpgrade(input: {
  enforced: boolean;
  policy: UpgradeGatePolicy;
  principal: Principal | null | undefined;
  action: HostAction;
  resource: HostResource;
}): Promise<boolean> {
  if (!input.enforced || !input.policy.hasPolicy()) return true; // unchanged: no policy ⇒ ungated
  if (!input.principal) return false; // the policy authenticates a person, and there is none
  if (isLocalOperator(input.principal)) return true; // D23: the operator sees everything
  try {
    return (await input.policy.authorize({ principal: input.principal, action: input.action, resource: input.resource })) === true;
  } catch {
    return false;
  }
}
