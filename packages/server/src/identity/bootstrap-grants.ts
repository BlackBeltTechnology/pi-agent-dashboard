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
import { isLocalOperator } from "./session-access.js";

export type BootstrapFamily = "workspace" | "openspec" | "branch" | "terminal";
export type BootstrapGrants = Readonly<Record<BootstrapFamily, boolean>>;

export const ALLOW_ALL_GRANTS: BootstrapGrants = Object.freeze({ workspace: true, openspec: true, branch: true, terminal: true });
export const DENY_ALL_GRANTS: BootstrapGrants = Object.freeze({ workspace: false, openspec: false, branch: false, terminal: false });

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
  terminal_removed: "terminal",
};

export interface GrantPolicy {
  hasPolicy(): boolean;
  authorize(input: { principal: Principal; action: HostAction; resource: HostResource }): Promise<boolean>;
}

export async function decideBootstrapGrants(principal: Principal | null | undefined, policy: GrantPolicy): Promise<BootstrapGrants> {
  if (!policy.hasPolicy()) return ALLOW_ALL_GRANTS;
  if (!principal) return DENY_ALL_GRANTS;
  if (isLocalOperator(principal)) return ALLOW_ALL_GRANTS;
  const decisions = await Promise.all(
    FAMILIES.map(async ([, action, resource]) => {
      try {
        return (await policy.authorize({ principal, action, resource })) === true;
      } catch {
        return false;
      }
    }),
  );
  return Object.freeze(Object.fromEntries(FAMILIES.map(([f], i) => [f, decisions[i]])) as Record<BootstrapFamily, boolean>);
}
