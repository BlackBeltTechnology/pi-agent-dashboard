/**
 * Thin React subscriber over the singleton `packageQueue`.
 *
 * Public API kept for backwards compatibility with PackageBrowser and
 * RecommendedExtensions:
 *   - `operation`: derived from `getRunning()` — the *currently running*
 *     op across the whole client. Multiple components observing this
 *     hook see the same op, even one initiated by a different component.
 *   - `install / remove / update`: thin wrappers over `packageQueue.enqueue`.
 *   - `clearOperation`: no-op kept for backwards-compat (the queue
 *     auto-clears success after 3 s and clears errors on next enqueue).
 *
 * New surface for callers that want richer per-row state:
 *   - `statusFor(source)`: per-source state, returns `"queued"` for items
 *     still waiting in the FIFO.
 *   - `messageFor(source)`: per-source progress / error / success message.
 *   - `queueDepth`: total items waiting in the queue.
 *
 * The single window-level `pi-package-event` listener lives inside
 * `packageQueue` itself; this hook only `subscribe()`s for re-render.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { type MoveState, moveTracker } from "../lib/nav/move-tracker.js";
import {
  type PackageOperationStatus,
  type PackageScope,
  packageQueue,
  type RunningOp,
} from "../lib/package/package-queue.js";
import {
  type MoveResponse,
  movePackage,
  type PackageEntry,
  type ResetResponse,
  resetToNpm as resetToNpmApi,
} from "../lib/package/packages-api.js";

export type { PackageOperationStatus } from "../lib/package/package-queue.js";

export interface OperationState {
  operationId: string | null;
  status: "idle" | "running" | "success" | "error";
  message: string;
  source: string;
}

function getSnapshot(): { running: RunningOp | null; depth: number } {
  return { running: packageQueue.getRunning(), depth: packageQueue.getQueueDepth() };
}

function subscribe(cb: () => void) {
  return packageQueue.subscribe(cb);
}

// ── Stable snapshot shim ───────────────────────────────────────
// useSyncExternalStore demands `getSnapshot` return a referentially
// stable value when nothing changed. We can't rely on the queue
// returning the same object reference, so we cache and reuse the last
// snapshot when its fields are equal.
let lastSnap: { running: RunningOp | null; depth: number } = getSnapshot();
function getStableSnapshot() {
  const next = getSnapshot();
  if (
    next.running === lastSnap.running &&
    next.depth === lastSnap.depth
  ) {
    return lastSnap;
  }
  lastSnap = next;
  return next;
}

export function usePackageOperations(
  scope: PackageScope,
  cwd?: string,
  onComplete?: () => void,
) {
  const snap = useSyncExternalStore(subscribe, getStableSnapshot, getStableSnapshot);

  // Per-source-derived state can change without `running`/`depth` changing
  // (e.g. error → idle on auto-clear of unrelated success). To keep
  // statusFor reactive, force a re-render on any queue notification.
  const [, force] = useState(0);
  useEffect(() => packageQueue.subscribe(() => force((n) => n + 1)), []);

  // Refresh hook (installed-list refetch) on any successful completion.
  useEffect(() => {
    if (!onComplete) return;
    return packageQueue.onAnyCompletion(onComplete);
  }, [onComplete]);

  // Derive backwards-compatible `operation` shape.
  const running = snap.running;
  const operation: OperationState = running
    ? {
        operationId: running.operationId,
        status: "running",
        message: running.message,
        source: running.source,
      }
    : { operationId: null, status: "idle", message: "", source: "" };

  const enqueue = useCallback(
    (
      action: "install" | "remove" | "update",
      source: string,
      scopeOverride?: PackageScope,
    ) => {
      packageQueue.enqueue({
        source,
        action,
        scope: scopeOverride ?? scope,
        cwd,
      });
    },
    [scope, cwd],
  );

  const install = useCallback(
    (source: string, scopeOverride?: PackageScope) => enqueue("install", source, scopeOverride),
    [enqueue],
  );
  const remove = useCallback(
    (source: string, scopeOverride?: PackageScope) => enqueue("remove", source, scopeOverride),
    [enqueue],
  );
  const update = useCallback(
    (source: string, scopeOverride?: PackageScope) => enqueue("update", source, scopeOverride),
    [enqueue],
  );

  const statusFor = useCallback(
    (source: string): PackageOperationStatus => packageQueue.getStateForSource(source),
    [],
  );
  const messageFor = useCallback(
    (source: string): string => packageQueue.getMessageForSource(source),
    [],
  );

  const clearOperation = useCallback(() => {
    // Backwards-compat no-op: queue manages its own lifecycle.
  }, []);

  // ── Move ──────────────────────────────────────────────────────────────
  // Move ops live outside the source-keyed `packageQueue` (they have
  // their own moveId-keyed identity and partial-success semantics).
  // See change: unify-package-management-ui.
  // ───────────────────────────────────────────────────────────────

  // Re-render on any move-tracker state change so callers see live phase.
  const [, forceMove] = useState(0);
  useEffect(
    () => moveTracker.subscribe(() => forceMove((n) => n + 1)),
    [],
  );

  const move = useCallback(
    async (
      entry: PackageEntry,
      args: {
        fromScope: PackageScope;
        fromCwd?: string;
        toScope: PackageScope;
        toCwd?: string;
      },
    ): Promise<MoveResponse> => {
      const sourceStr = typeof entry === "string" ? entry : entry.source;
      const res = await movePackage({ entry, ...args });
      if (res.ok) {
        moveTracker.register({
          moveId: res.moveId,
          source: sourceStr,
          fromScope: args.fromScope,
          fromCwd: args.fromCwd,
          toScope: args.toScope,
          toCwd: args.toCwd,
        });
      }
      return res;
    },
    [],
  );

  // ── Reset-to-npm ───────────────────────────────────────────────────────
  // Reuses the moveId-keyed move-tracker (kind: "reset") so the composite
  // install-first / remove-second + partial-success UX is shared with move.
  // See change: reset-override-to-npm.
  const resetToNpm = useCallback(
    async (
      source: string,
      args: { scope: PackageScope; cwd?: string },
    ): Promise<ResetResponse> => {
      const res = await resetToNpmApi({ source, scope: args.scope, cwd: args.cwd });
      if (res.ok) {
        moveTracker.register({
          moveId: res.resetId,
          source,
          fromScope: args.scope,
          fromCwd: args.cwd,
          toScope: args.scope,
          toCwd: args.cwd,
          kind: "reset",
        });
      }
      return res;
    },
    [],
  );

  /** Get the live state of a move by source (most recent only). */
  const moveStateFor = useCallback(
    (source: string): MoveState | undefined => moveTracker.getBySource(source),
    [],
  );

  return {
    operation,
    install,
    remove,
    update,
    move,
    resetToNpm,
    moveStateFor,
    clearMove: (moveId: string) => moveTracker.clear(moveId),
    clearOperation,
    statusFor,
    messageFor,
    queueDepth: snap.depth,
    runningSource: running?.source ?? null,
    /** Backwards-compat: WS messages now flow through the queue's own
     * window listener, so handleMessage is a no-op kept only so existing
     * consumers (if any) don't crash on call. */
    handleMessage: (_msg: unknown) => {},
  };
}
