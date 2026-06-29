/**
 * Model and thinking-level change detection.
 * Sends model_update only when values actually change.
 */
import { existsSync } from "node:fs";
import type { BridgeContext } from "./bridge-context.js";
import { getCurrentModelString } from "./bridge-context.js";
import { gatherGitInfo } from "./vcs-info.js";

/**
 * Send model_update if model or thinking level has changed since last send.
 */
export function sendModelUpdateIfChanged(bc: BridgeContext): void {
  const model = getCurrentModelString(bc);
  const thinkingLevel = (bc.pi as any).getThinkingLevel?.() ?? undefined;
  if (model === bc.lastModel && thinkingLevel === bc.lastThinkingLevel) return;
  bc.lastModel = model;
  bc.lastThinkingLevel = thinkingLevel;
  if (model) {
    bc.connection.send({
      type: "model_update",
      sessionId: bc.sessionId,
      model,
      thinkingLevel,
    });
  }
}

/**
 * Send session_name_update if name has changed since last send.
 */
export function sendSessionNameIfChanged(bc: BridgeContext): void {
  const name = bc.pi.getSessionName() ?? "";
  if (name === bc.lastSessionName) return;
  bc.lastSessionName = name;
  bc.connection.send({
    type: "session_name_update",
    sessionId: bc.sessionId,
    name,
  });
}

/**
 * Send git_info_update if branch, PR, or worktree state has changed since last send.
 */
export function sendGitInfoIfChanged(bc: BridgeContext, cwd: string): void {
  const info = gatherGitInfo(cwd);
  if (!info) return;
  // Worktree state diff: serialise to a stable string. `"null"` marks an
  // explicit "cwd is not a worktree" so a subsequent transition into a
  // worktree still counts as a change.
  const nextWorktreeJson = info.gitWorktree ? JSON.stringify(info.gitWorktree) : "null";
  if (
    info.gitBranch === bc.lastGitBranch &&
    info.gitPrNumber === bc.lastGitPrNumber &&
    nextWorktreeJson === bc.lastGitWorktreeJson
  ) return;
  bc.lastGitBranch = info.gitBranch;
  bc.lastGitPrNumber = info.gitPrNumber;
  bc.lastGitWorktreeJson = nextWorktreeJson;
  bc.connection.send({
    type: "git_info_update",
    sessionId: bc.sessionId,
    ...info,
    // Use explicit `null` on the wire when worktree state went from
    // present → absent, so the server can clear its cached value.
    gitWorktree: info.gitWorktree ?? null,
  });
}

/**
 * Reset the change-detection caches that aren't persisted on the server
 * side, so a server-restart-driven reconnect re-sends them. `gitBranch`
 * is already persisted to `.meta.json` so it's tolerable for a tick of
 * staleness.
 */
export function resetReconnectCaches(bc: BridgeContext): void {
  // Defensive: reset git so a reconnect through a stale state cache
  // doesn't surface stale branch info if .meta.json wasn't persisted yet.
  bc.lastGitBranch = undefined;
  bc.lastGitPrNumber = undefined;
  bc.lastGitWorktreeJson = undefined;
}

/**
 * Emit `cwd_missing` the first time `existsSync(cwd)` flips to false.
 * Debounced via `bc.lastCwdMissing` — once we've reported missing, the
 * tick is a no-op forever (we never reset to false on rediscovery; see
 * the BridgeContext doc-comment for the rationale).
 *
 * Pure with respect to `bc` aside from caching the flag; the only side
 * effect is `connection.send`. See change: add-worktree-lifecycle-actions.
 */
export function sendCwdMissingIfChanged(
  bc: BridgeContext,
  cwd: string,
  exists: (p: string) => boolean = existsSync,
): void {
  if (bc.lastCwdMissing === true) return;
  if (!cwd) return;
  if (exists(cwd)) return;
  bc.lastCwdMissing = true;
  bc.connection.send({
    type: "cwd_missing",
    sessionId: bc.sessionId,
  });
}

