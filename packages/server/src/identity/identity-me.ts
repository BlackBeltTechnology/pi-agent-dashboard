/**
 * `GET /api/identity/me` payload (openspec add-multi-user-identity-plane, D24;
 * task 18.28). Returns the caller's principal and, per core host action, what
 * the optional host policy currently allows — so a UI (or a policy plugin's own
 * frontend) can hide what the server would deny. Advisory only: the server
 * still enforces every road (`identity-road-gate.ts`, gateway gate).
 */
import type { HostAction, Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import type { HostPolicy } from "./host-access.js";
import { HostActions } from "./host-resources.js";
import { isLocalOperator } from "./session-access.js";

/** Every core family action except the domain-event fan-out road. */
export const CORE_ME_ACTIONS: readonly HostAction[] = Object.values(HostActions).filter(
  (a) => a !== HostActions.domainEvent,
);

export interface IdentityMe {
  enforced: boolean;
  principal: { iss: string; sub: string; email?: string } | null;
  localOperator: boolean;
  can: Record<string, boolean>;
}

const kindOf = (action: HostAction) => action.slice(0, action.indexOf("."));

export async function identityMe(input: {
  enforced: boolean;
  principal: { iss: string; sub: string; email?: string } | null;
  policy: HostPolicy;
}): Promise<IdentityMe> {
  const { enforced, principal, policy } = input;
  const localOperator = isLocalOperator(principal);
  const shown =
    principal && !localOperator
      ? { iss: principal.iss, sub: principal.sub, ...(principal.email ? { email: principal.email } : {}) }
      : null;
  const all = (v: boolean) => Object.fromEntries(CORE_ME_ACTIONS.map((a) => [a, v]));

  if (!enforced || !policy.hasPolicy() || localOperator) {
    return { enforced, principal: shown, localOperator, can: all(true) };
  }
  if (!principal) return { enforced, principal: null, localOperator, can: all(false) };

  const decisions = await Promise.all(
    CORE_ME_ACTIONS.map((action) =>
      policy.authorize({ principal: principal as Principal, action, resource: { kind: kindOf(action) } }),
    ),
  );
  return {
    enforced,
    principal: shown,
    localOperator,
    can: Object.fromEntries(CORE_ME_ACTIONS.map((a, i) => [a, decisions[i] === true])),
  };
}
