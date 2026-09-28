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
import { createTrustHealth, type TrustHealthSnapshot } from "./health.js";
import type { MirrorLevel, ValidatedBinding, ValidatedTeamConfig } from "./team-config.js";
import { DEFAULT_MIRROR_LEVEL } from "./team-config.js";
import type { WorkspaceView } from "./workspace.js";

export interface TeamControllerDeps {
  /**
   * Read LIVE, not captured: the dashboard can rewrite the policy while the
   * layer runs, and a revoked principal must stop being authorized immediately
   * rather than at the next restart.
   */
  config: () => ValidatedTeamConfig;
  log: CommandLog;
  listWorkspaces: () => WorkspaceView[];
  /** channelId → workspaceId for the layer's active bindings. */
  channelBindings: () => Map<string, string>;
  /**
   * Notified once when a trusted-gated verb first returns the host no-op, so
   * the plugin can mark itself unhealthy in `/api/health.plugins[]` (D5).
   */
  onTrustFailure?: (reason: string) => void;
  /**
   * Latch state restored from disk. `undefined` (nothing ever persisted) seeds
   * from `config().disarmed` instead.
   */
  initialDisarmed?: boolean;
  /**
   * Notified whenever the latch CHANGES, so it can be persisted. The latch is
   * runtime state that intentionally never writes config, so without this the
   * halt would not survive a restart (task 11.3).
   */
  onDisarmChange?: (disarmed: boolean) => void;
  now?: () => number;
}

interface ResolvedBinding {
  workspaceId: string;
  binding: BindingContext;
  policy: ValidatedBinding;
}

interface AuthorizeRequestInput {
  author: Author;
  channelId: string;
  /**
   * Parent channel id. A THREAD's messages carry the THREAD id while the
   * operator provisions the PARENT, so this is what lets a thread inherit.
   */
  parentChannelId?: string;
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
  /**
   * Adopt the dashboard's `disarmed` flag. The DASHBOARD is the only writer of
   * config, so its flag is a dashboard decision — this is how the config surface
   * re-arms. The caller must only invoke it when the flag actually CHANGED,
   * or an unrelated config edit would silently undo a chat-initiated disarm.
   */
  syncDisarmFromConfig(disarmed: boolean): void;
  bindingFor(channelId: string, parentChannelId?: string): ResolvedBinding | undefined;
  mirrorLevel(channelId: string, parentChannelId?: string): MirrorLevel;
  /**
   * Record a trusted-gated verb's host no-op (D5). Sticky; returns the reason
   * naming the missing trust level so the caller can refuse with it.
   */
  reportTrustFailure(verb: string): string;
  /** The layer's trust state, for the health surface. */
  trustHealth(): TrustHealthSnapshot;
  /** The chokepoint + audit in one call. */
  authorizeRequest(input: AuthorizeRequestInput): AuthorizeResult;
  /** Record a mirror (non-action) — produces NO log entry. */
  noteMirror(): void;
  attempts(): CommandLogEntry[];
}

export function createTeamController(deps: TeamControllerDeps): TeamController {
  const now = deps.now ?? Date.now;
  const trust = createTrustHealth();
  let disarmed = deps.initialDisarmed ?? (deps.config().disarmed === true);

  /**
   * The ONLY writer of the latch. Every transition routes through here so none
   * can forget to persist — an assignment added at a new call site would
   * reintroduce task 11.3 silently, which is exactly how it was found.
   */
  function setDisarmed(next: boolean): void {
    if (disarmed === next) return;
    disarmed = next;
    deps.onDisarmChange?.(next);
  }

  function bindingFor(channelId: string, parentChannelId?: string): ResolvedBinding | undefined {
    // A thread's messages carry the THREAD id, but the operator provisions the
    // PARENT channel. Without this fallback every thread is refused
    // `unbound_channel`, which kills the per-thread session granularity the
    // workspace-binding spec requires ("a bound channel OR ITS THREADS").
    const bindings = deps.channelBindings();
    const workspaceId =
      bindings.get(channelId) ?? (parentChannelId ? bindings.get(parentChannelId) : undefined);
    if (!workspaceId) return undefined;
    const policy = deps.config().bindings[workspaceId];
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
      setDisarmed(true);
    },
    rearmFromDashboard() {
      setDisarmed(false);
      return true;
    },
    syncDisarmFromConfig(next) {
      setDisarmed(next);
    },
    rearmFromChat() {
      // Re-arming from chat would let whoever can talk undo a deliberate halt.
      return { ok: false, reason: "rearm_requires_dashboard" };
    },
    bindingFor,
    mirrorLevel(channelId, parentChannelId) {
      return bindingFor(channelId, parentChannelId)?.policy.mirrorLevel ?? DEFAULT_MIRROR_LEVEL;
    },
    reportTrustFailure(verb) {
      const wasHealthy = trust.snapshot().healthy;
      const reason = trust.reportTrustFailure(verb);
      // Fire once, on the healthy → unhealthy edge, so the health surface is
      // not rewritten on every subsequent refusal.
      if (wasHealthy) deps.onTrustFailure?.(reason);
      return reason;
    },
    trustHealth: () => trust.snapshot(),
    authorizeRequest(input) {
      const resolved = bindingFor(input.channelId, input.parentChannelId);
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
