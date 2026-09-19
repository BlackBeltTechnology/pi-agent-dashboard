/**
 * Team-controls CONFIGURATION SURFACE (D6) — builds the read-only snapshot the
 * dashboard settings panel renders.
 *
 * Server-side and PURE: it takes the validated config, the host's workspaces,
 * `allowedRoots`, the command log and a delegation port, and returns one plain
 * object. No sockets, no DOM, no adapter — so every display rule (inert
 * folders, the delegation disclosure, log ordering, the fail-closed banner) is
 * testable directly, and the panel stays a dumb renderer.
 *
 * WHY A PROJECTION RATHER THAN THE PANEL READING STATE ITSELF: the panel must
 * never be a second source of truth. It is told what the layer will do, and
 * the layer is the only thing that decides.
 *
 * See change: add-chat-gateway-team-controls.
 */
import type {
  SurfaceBinding,
  SurfaceLogEntry,
  SurfaceRoleAssigners,
  TeamSurfaceView,
} from "../../shared/types.js";
import type { CommandLog } from "./audit.js";
import { inertWorkspaceFolders } from "./binding.js";
import type { ValidatedTeamConfig } from "./team-config.js";
import type { WorkspaceView } from "./workspace.js";

/** A platform member who can assign a role. */
interface RoleAssigner {
  id: string;
  name?: string;
}

/**
 * The answer to "who can assign this role?".
 *
 * `unavailable` carries the MISSING PERMISSION rather than degrading to an
 * empty list: an empty `assigners` list would read as "nobody can hand this
 * out", understating who actually holds the role. A platform that cannot
 * enumerate MUST say so.
 */
export type DelegationAnswer =
  | { kind: "assigners"; members: RoleAssigner[] }
  | { kind: "unavailable"; missingPermission: string };

/**
 * Where the delegation disclosure comes from.
 *
 * BATCHED by role, deliberately: the platform read behind it (a full guild
 * member enumeration) is expensive and rate-limited, so asking once per panel
 * build instead of once per mapped role keeps a many-role binding from issuing
 * a burst of identical enumerations. Missing keys are treated as an empty
 * roster by the caller, never as "unknown" — a port that cannot answer MUST
 * return `unavailable`, or the panel would understate the delegation.
 */
export interface DelegationPort {
  assignersForRoles(roleIds: readonly string[]): Promise<Record<string, DelegationAnswer>>;
}

export interface BuildSurfaceInput {
  /** Absent when team controls are not configured; the panel still renders. */
  config?: ValidatedTeamConfig;
  workspaces: WorkspaceView[];
  allowedRoots: string[];
  log: CommandLog;
  /** Live disarm state — owned by the controller, not by the config. */
  isDisarmed: boolean;
  delegation: DelegationPort;
  /** Rows to return. The log itself orders most-recent-first. */
  logLimit?: number;
  /** Set when config validation rejected the operator's input. */
  configError?: string;
  /** Channel the layer owns for a workspace, once provisioned. */
  channelFor?: (workspaceId: string) => string | undefined;
  /** Why a workspace could not be provisioned, when it could not. */
  problemFor?: (workspaceId: string) => string | undefined;
}

/** Rows the panel asks for by default. */
const SURFACE_LOG_LIMIT = 50;

/** Defaults shown when team controls are entirely unconfigured. */
const UNCONFIGURED_CEILING = "observe" as const;

/** `CommandLogEntry` → the wire shape. Explicit, so the contract is visible. */
function toLogEntry(e: {
  at: number;
  principal: string;
  channelId: string;
  threadId?: string;
  workspaceId?: string;
  tier?: "observe" | "control" | "operate";
  verb: string;
  target?: string;
  outcome: "permitted" | "refused";
  reason?: string;
}): SurfaceLogEntry {
  // Optional keys are omitted rather than set to `undefined`, so the framed
  // payload stays byte-stable and a renderer can test presence honestly.
  const out: SurfaceLogEntry = {
    at: e.at,
    principal: e.principal,
    channelId: e.channelId,
    verb: e.verb,
    outcome: e.outcome,
  };
  if (e.threadId !== undefined) out.threadId = e.threadId;
  if (e.workspaceId !== undefined) out.workspaceId = e.workspaceId;
  if (e.tier !== undefined) out.tier = e.tier;
  if (e.target !== undefined) out.target = e.target;
  if (e.reason !== undefined) out.reason = e.reason;
  return out;
}

/**
 * Build one binding's view. `workspace` is absent when the configured binding
 * no longer names a real workspace — the record is retained, so the panel shows
 * it as unbound rather than hiding it (a vanishing binding would be invisible
 * drift).
 */
async function buildBinding(
  workspaceId: string,
  binding: NonNullable<ValidatedTeamConfig["bindings"]>[string],
  workspace: WorkspaceView | undefined,
  input: BuildSurfaceInput,
  answers: Record<string, DelegationAnswer>,
): Promise<SurfaceBinding> {
  const roleIds = Object.keys(binding.roles).sort();
  const roles = roleIds.map((roleId) => {
    const answer = answers[roleId] ?? { kind: "assigners", members: [] };
    const assigners: SurfaceRoleAssigners =
      answer.kind === "assigners"
        ? { kind: "assigners", members: answer.members.map((m) => ({ ...m })) }
        : { kind: "unavailable", missingPermission: answer.missingPermission };
    return { roleId, tier: binding.roles[roleId], assigners };
  });

  // Only folders that EXIST are listed; a folder outside `allowedRoots` is inert
  // and shown as such, because "this workspace has a folder you cannot use" is
  // exactly the fact that would otherwise be silent.
  const inert = new Set(inertWorkspaceFolders(workspace?.folders ?? [], input.allowedRoots));
  const folders = (workspace?.folders ?? []).map((path) => ({ path, inert: inert.has(path) }));

  const principals = Object.keys(binding.principals)
    .sort()
    .map((id) => ({ id, tier: binding.principals[id] }));

  const view: SurfaceBinding = {
    workspaceId,
    bound: workspace !== undefined,
    ceiling: binding.ceiling,
    mirrorLevel: binding.mirrorLevel,
    principals,
    roles,
    folders,
  };
  if (workspace) view.workspaceName = workspace.name;
  const channelId = input.channelFor?.(workspaceId);
  if (channelId !== undefined) view.channelId = channelId;
  const problem = input.problemFor?.(workspaceId);
  if (problem !== undefined) view.problem = problem;
  return view;
}

/** Build the whole panel snapshot. */
export async function buildTeamSurface(input: BuildSurfaceInput): Promise<TeamSurfaceView> {
  const limit = input.logLimit ?? SURFACE_LOG_LIMIT;
  const byId = new Map(input.workspaces.map((w) => [w.id, w] as const));
  const configured = input.config?.bindings ?? {};
  const workspaceIds = Object.keys(configured).sort();

  // ONE delegation read for the whole panel, covering every mapped role in every
  // binding — see `DelegationPort`.
  const allRoleIds = [
    ...new Set(workspaceIds.flatMap((id) => Object.keys(configured[id].roles))),
  ].sort();
  const answers =
    allRoleIds.length > 0 ? await input.delegation.assignersForRoles(allRoleIds) : {};

  const bindings = await Promise.all(
    workspaceIds.map((workspaceId) =>
      buildBinding(workspaceId, configured[workspaceId], byId.get(workspaceId), input, answers),
    ),
  );

  const view: TeamSurfaceView = {
    configured: input.config !== undefined,
    disarmed: input.isDisarmed,
    ceiling: input.config?.ceiling ?? UNCONFIGURED_CEILING,
    allowedRoots: [...input.allowedRoots],
    bindings,
    // `recent()` is newest-first by contract — the required ordering is the
    // log's own, not the renderer's, so a paged read cannot reorder it.
    log: input.log.recent(limit).map(toLogEntry),
    logLimit: limit,
  };
  if (input.configError !== undefined) view.configError = input.configError;
  return view;
}
