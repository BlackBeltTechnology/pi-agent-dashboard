/**
 * Per-socket policy grants for non-session state (D9/D24, task 18.37a).
 *
 * The WS connect bootstrap and live fan-out disclose non-session state —
 * workspace (pinned dirs, workspaces), OpenSpec, branch/HEAD and terminals. With
 * a host policy registered each family is authorized through it. The policy is
 * async but the gateway's connection handler is synchronous, so the decision is
 * made ONCE at the WS upgrade (`server.ts`, before `handleUpgrade`) and bound to
 * the socket as `bootstrapGrants`; the gateway then applies it synchronously.
 *
 * - No policy ⇒ everything allowed (unchanged).
 * - No principal ⇒ nothing (the policy authenticates a person, and there is none).
 * - Break-glass operator ⇒ everything (D23), policy not consulted.
 * - Policy false / throw / timeout / non-boolean ⇒ that family denied (fail-closed,
 *   contained by `PolicyRegistry.authorize`; a bare throw here is also denied).
 * See change: add-multi-user-identity-plane.
 */
import type { HostAction, HostResource, Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { HostActions, hostResource } from "./host-resources.js";
import { canAccessSession, isLocalOperator } from "./session-access.js";

export type BootstrapFamily = "workspace" | "openspec" | "branch" | "terminal";
export type BootstrapGrants = Readonly<Record<BootstrapFamily, boolean>> & {
  /**
   * Per-TARGET terminal decisions (review r2 B2). The family grant answers "may this
   * principal see terminals at all"; a policy may still deny a specific terminal id.
   * `"all"` ⇒ every terminal the owner gate admits; a set ⇒ only those ids.
   * Absent while a policy is registered ⇒ fail-closed (no terminal).
   */
  readonly terminals?: "all" | ReadonlySet<string>;
};

export const ALLOW_ALL_GRANTS: BootstrapGrants = Object.freeze({ workspace: true, openspec: true, branch: true, terminal: true, terminals: "all" as const });
export const DENY_ALL_GRANTS: BootstrapGrants = Object.freeze({
  workspace: false,
  openspec: false,
  branch: false,
  terminal: false,
  terminals: Object.freeze(new Set<string>()) as ReadonlySet<string>,
});

const FAMILIES: ReadonlyArray<readonly [BootstrapFamily, HostAction, HostResource]> = [
  ["workspace", HostActions.workspaceRead, hostResource.workspace()],
  ["openspec", HostActions.openspecRead, hostResource.openspec()],
  ["branch", HostActions.branchRead, hostResource.branch()],
  ["terminal", HostActions.terminalRead, hostResource.terminal()],
];

/** Browser→frame family of a non-session WS frame type, or undefined when not gated here. */
export const FRAME_FAMILY: Readonly<Record<string, BootstrapFamily>> = {
  pinned_dirs_updated: "workspace",
  workspaces_updated: "workspace",
  openspec_update: "openspec",
  git_head_update: "branch",
  terminal_added: "terminal",
  terminal_updated: "terminal",
  terminal_removed: "terminal",
};

export interface GrantPolicy {
  hasPolicy(): boolean;
  authorize(input: { principal: Principal; action: HostAction; resource: HostResource }): Promise<boolean>;
}

export async function decideBootstrapGrants(
  principal: Principal | null | undefined,
  policy: GrantPolicy,
  /** Terminals alive at upgrade time; only the principal's OWN are put to the policy. */
  terminals: ReadonlyArray<{ id: string; principalOwner?: { iss: string; sub: string } }> = [],
): Promise<BootstrapGrants> {
  if (!policy.hasPolicy()) return ALLOW_ALL_GRANTS;
  if (!principal) return DENY_ALL_GRANTS;
  if (isLocalOperator(principal)) return ALLOW_ALL_GRANTS;
  const ask = async (action: HostAction, resource: HostResource): Promise<boolean> => {
    try {
      return (await policy.authorize({ principal, action, resource })) === true;
    } catch {
      return false;
    }
  };
  const decisions = await Promise.all(FAMILIES.map(([, action, resource]) => ask(action, resource)));
  const grants = Object.fromEntries(FAMILIES.map(([f], i) => [f, decisions[i]])) as Record<BootstrapFamily, boolean>;
  // Per-target: only when the family allows terminals at all, and only for ones this principal owns.
  const owned = grants.terminal
    ? terminals.filter((t) => canAccessSession({ active: true, principal, owner: t.principalOwner }))
    : [];
  const allowedIds = new Set<string>();
  await Promise.all(
    owned.map(async (t) => {
      if (await ask(HostActions.terminalRead, hostResource.terminal(t.id))) allowedIds.add(t.id);
    }),
  );
  return Object.freeze({ ...grants, terminals: allowedIds as ReadonlySet<string> });
}
