/**
 * Server side of Supervised mode state: reconcile what the bridge reports with the
 * persisted copy (register / reconnect / `supervised_state`), and apply an
 * operator flip. Keeps `event-wiring.ts` and the browser handler thin.
 *
 * Persistence rides the normal `sessionManager.update` → `onChange` →
 * `sessionToMeta` full-overwrite save (the `supervised` field is enumerated
 * there); `mergeSessionMeta` is only the early write for a session that has no
 * `sessionFile` in memory yet (principalOwner precedent).
 *
 * See change: add-supervised-tool-approval (design D4, D12).
 */
import type { SupervisedState } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { mergeSessionMeta, readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { ToolGateOwner } from "@blackbelt-technology/pi-dashboard-shared/tool-gate/owner.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { reconcileSupervised, type SupervisedSide } from "./supervised-reconcile.js";

export interface SupervisedSyncDeps {
  sessionManager: {
    get(id: string): DashboardSession | undefined;
    update(id: string, updates: Partial<DashboardSession>): unknown;
  };
  piGateway: { sendToSession(sessionId: string, msg: { type: "set_supervised"; on: boolean; rev: number }): boolean };
  broadcastSessionUpdated(sessionId: string, updates: Record<string, unknown>): void;
}

/** True when `v` is a usable reported state (`on` boolean; `rev` absent or a finite number). */
export function isSupervisedReport(v: { on?: unknown; rev?: unknown } | undefined): v is SupervisedSide {
  return !!v && typeof v.on === "boolean" && (v.rev === undefined || (typeof v.rev === "number" && Number.isFinite(v.rev)));
}

function storedState(deps: SupervisedSyncDeps, sessionId: string, fileHint?: string): SupervisedSide | undefined {
  const session = deps.sessionManager.get(sessionId);
  if (session?.supervised !== undefined) return { on: session.supervised, rev: session.supervisedRev };
  // A session the boot scan could not restore (no transcript yet): fall back to the sidecar.
  const file = session?.sessionFile ?? fileHint;
  return file ? readSessionMeta(file)?.supervised : undefined;
}

/**
 * Reconcile the bridge's reported `{on, rev}` with the stored copy, persist + broadcast
 * the winner, and send `set_supervised {on, rev}` to the bridge. `alwaysSend` (register /
 * reconnect) re-sends even when the bridge already holds the winner; a later
 * `supervised_state` report only corrects a mismatch (no ping-pong).
 * `toolGateOwner` is the bridge's UI hint; it is stored, never persisted.
 */
export function applyBridgeSupervised(
  deps: SupervisedSyncDeps,
  sessionId: string,
  reported: SupervisedSide,
  toolGateOwner: ToolGateOwner | undefined,
  opts: { alwaysSend: boolean; fileHint?: string },
): SupervisedState | undefined {
  const session = deps.sessionManager.get(sessionId);
  if (!session) return undefined;
  const winner = reconcileSupervised(reported, storedState(deps, sessionId, opts.fileHint));
  if (session.supervised !== winner.on || session.supervisedRev !== winner.rev || session.toolGateOwner !== toolGateOwner) {
    deps.sessionManager.update(sessionId, { supervised: winner.on, supervisedRev: winner.rev, toolGateOwner });
    const file = session.sessionFile ?? opts.fileHint;
    if (!session.sessionFile && file) {
      try {
        mergeSessionMeta(file, { supervised: winner });
      } catch {
        /* best-effort: the onChange save lands it once the session carries its file */
      }
    }
    deps.broadcastSessionUpdated(sessionId, {
      supervised: winner.on,
      supervisedRev: winner.rev,
      toolGateOwner: toolGateOwner ?? null,
    });
  }
  const bridgeHolds = reported.on === winner.on && (reported.rev ?? 0) === winner.rev;
  if (opts.alwaysSend || !bridgeHolds) {
    deps.piGateway.sendToSession(sessionId, { type: "set_supervised", on: winner.on, rev: winner.rev });
  }
  return winner;
}

/**
 * Apply an accepted operator flip: next `rev` = stored + 1, update + persist + broadcast,
 * forward `set_supervised {on, rev}` to the session's bridge, and audit-log it.
 * Returns the new rev, or `undefined` for an unknown session.
 */
export function flipSupervised(deps: SupervisedSyncDeps, sessionId: string, on: boolean, source: string): number | undefined {
  const session = deps.sessionManager.get(sessionId);
  if (!session) return undefined;
  const rev = (session.supervisedRev ?? 0) + 1;
  deps.sessionManager.update(sessionId, { supervised: on, supervisedRev: rev });
  deps.broadcastSessionUpdated(sessionId, { supervised: on, supervisedRev: rev });
  deps.piGateway.sendToSession(sessionId, { type: "set_supervised", on, rev });
  console.error(`[supervised] mode ${on ? "on" : "off"} rev=${rev} session=${sessionId} source=${source}`);
  return rev;
}
