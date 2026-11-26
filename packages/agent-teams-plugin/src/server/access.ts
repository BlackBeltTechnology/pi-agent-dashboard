/**
 * Owner rule for the team routes (design D7): who may view and who may control a
 * team. Registered with core's `setRouteVisibility` so list and snapshot answer
 * the same 404 for an invisible team as for an unknown id, and exported for later
 * team-scoped routes (plan decision, hook trust), which call these instead of
 * re-implementing it.
 *
 *  - identity not enforced (or absent) → everyone sees and controls every team;
 *  - enforced: no principal → refused; the reserved local-operator issuer → allowed
 *    (it cannot be minted by a resolver); otherwise the principal's `(iss, sub)`
 *    must equal `Team.owner` exactly; a team without an owner is operator-only.
 * `Team.owner` is the opaque string `ownerKeyOf(principal)` (`shared/owner-key.ts`, recorded by core from the host session's `principalOwner`).
 * `canControlTeam` is the same predicate, kept separate so a read-only role can diverge.
 * See change: add-agent-teams-ui.
 */
import { ownerKeyOf } from "../shared/owner-key.js";
import type { Team } from "../shared/types.js";

/** Reserved issuer of the break-glass local operator (`packages/server/src/identity/session-access.ts`). */
export const LOCAL_OPERATOR_ISSUER = "urn:pi-dashboard:local-operator";

/** The slice of the host's `PluginIdentitySeam` this rule reads. */
export interface AccessIdentity {
  isEnforced(): boolean;
  principalOf(request: unknown): { iss: string; sub: string } | null;
}

export interface TeamAccess {
  canViewTeam(team: Team, request: unknown): boolean;
  canControlTeam(team: Team, request: unknown): boolean;
}

export { ownerKeyOf };

export function createAccess(identity: AccessIdentity | undefined): TeamAccess {
  function allowed(team: Team, request: unknown): boolean {
    if (!identity?.isEnforced()) return true;
    const principal = identity.principalOf(request);
    if (!principal) return false;
    if (principal.iss === LOCAL_OPERATOR_ISSUER) return true;
    return team.owner !== undefined && team.owner === ownerKeyOf(principal);
  }
  // A throwing identity seam propagates: the route layer treats it as "not allowed" and logs once with the team id.
  return { canViewTeam: allowed, canControlTeam: allowed };
}

let active: TeamAccess = createAccess(undefined);

/** Point the module-level helpers at the current plugin instance (plugin enable; re-enable replaces it). */
export function activateAccess(access: TeamAccess): void {
  active = access;
}

/** Shared by every team-scoped route; registered with core's `setRouteVisibility`. */
export const canViewTeam = (team: Team, request: unknown): boolean => active.canViewTeam(team, request);
/** @public exported for later team routes (design D7) */
export const canControlTeam = (team: Team, request: unknown): boolean => active.canControlTeam(team, request);
