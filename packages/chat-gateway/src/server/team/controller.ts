/**
 * Team-controls controller — the stateful bridge between the pure modules and
 * the gateway. It resolves a channel to its binding, authorizes a request
 * through the single chokepoint, records every attempt in the append-only log,
 * and owns the disarm state (any `observe`+ principal may disarm; only the
 * dashboard may re-arm).
 *
 * Everything the controller reads about workspaces/bindings is injected as a
 * function, so it is fully testable with no dashboard.
 *
 * See change: add-chat-gateway-team-controls.
 */

import type { CommandLog, CommandLogEntry } from "./audit.js";
import type { Author, AuthorizeResult, BindingContext } from "./authorize.js";
import { authorize } from "./authorize.js";
import type { MirrorLevel, ValidatedBinding, ValidatedTeamConfig } from "./team-config.js";
import { DEFAULT_MIRROR_LEVEL } from "./team-config.js";
import type { WorkspaceView } from "./workspace.js";

export interface TeamControllerDeps {
  config: ValidatedTeamConfig;
  log: CommandLog;
  listWorkspaces: () => WorkspaceView[];
  /** channelId → workspaceId for the layer's active bindings. */
  channelBindings: () => Map<string, string>;
  now?: () => number;
}

export interface ResolvedBinding {
  workspaceId: string;
  binding: BindingContext;
  policy: ValidatedBinding;
}

export interface AuthorizeRequestInput {
  author: Author;
  channelId: string;
  verb: string;
  /** Session cwd the verb would affect (scope containment). */
  targetCwd?: string;
  threadId?: string;
  /** Session id the verb targets, for the log. */
  target?: string;
}

export interface TeamController {
  isDisarmed(): boolean;
  /** Any observe+ principal disarms from chat. Idempotent. */
  disarm(): void;
  /** Only the dashboard re-arms. Returns false when a chat caller tries. */
  rearmFromDashboard(): boolean;
  /** A chat-originated re-arm is always refused; state persists. */
  rearmFromChat(): { ok: false; reason: string };
  bindingFor(channelId: string): ResolvedBinding | undefined;
  mirrorLevel(channelId: string): MirrorLevel;
  /** The chokepoint + audit in one call. */
  authorizeRequest(input: AuthorizeRequestInput): AuthorizeResult;
  /** Record a mirror (non-action) — produces NO log entry. */
  noteMirror(): void;
  attempts(): CommandLogEntry[];
}

export function createTeamController(deps: TeamControllerDeps): TeamController {
  const now = deps.now ?? Date.now;
  let disarmed = deps.config.disarmed === true;

  function bindingFor(channelId: string): ResolvedBinding | undefined {
    const workspaceId = deps.channelBindings().get(channelId);
    if (!workspaceId) return undefined;
    const policy = deps.config.bindings[workspaceId];
    const workspace = deps.listWorkspaces().find((w) => w.id === workspaceId);
    if (!policy || !workspace) return undefined;
    return {
      workspaceId,
      policy,
      binding: {
        workspaceId,
        folders: workspace.folders,
        principals: policy.principals,
        roles: policy.roles,
        ceiling: policy.ceiling,
      },
    };
  }

  return {
    isDisarmed: () => disarmed,
    disarm() {
      disarmed = true;
    },
    rearmFromDashboard() {
      disarmed = false;
      return true;
    },
    rearmFromChat() {
      // Re-arming from chat would let whoever can talk undo a deliberate halt.
      return { ok: false, reason: "rearm_requires_dashboard" };
    },
    bindingFor,
    mirrorLevel(channelId) {
      return bindingFor(channelId)?.policy.mirrorLevel ?? DEFAULT_MIRROR_LEVEL;
    },
    authorizeRequest(input) {
      const resolved = bindingFor(input.channelId);
      const result = authorize({
        author: input.author,
        channelId: input.channelId,
        binding: resolved?.binding,
        verb: input.verb,
        targetCwd: input.targetCwd,
        disarmed,
      });
      const entry: CommandLogEntry = {
        at: now(),
        principal: input.author.id,
        channelId: input.channelId,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(resolved ? { workspaceId: resolved.workspaceId } : {}),
        ...(result.kind === "grant" ? { tier: result.tier } : {}),
        verb: input.verb,
        ...(input.target ? { target: input.target } : {}),
        outcome: result.kind === "grant" ? "permitted" : "refused",
        ...(result.kind === "refusal" ? { reason: result.reason } : {}),
      };
      deps.log.append(entry);
      return result;
    },
    noteMirror() {
      // Mirroring is not an action: it must produce no command-log entry.
    },
    attempts: () => deps.log.entries(),
  };
}
