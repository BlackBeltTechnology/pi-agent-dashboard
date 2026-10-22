/**
 * Browser-WS `watch_files` handler: admits the declared cwd through the shared guard, then hands the
 * paths to the file-watch manager. Extracted from `server.ts` so the admission race rules are unit
 * testable. See change: core-file-cwd-admission (D1, `watch_files`).
 *
 * Admission is async, so two things can change while it runs: the socket can disconnect (a late
 * admission must not re-create a cleared connection map) and a newer `watch_files` for the same
 * `(ws, sessionId)` can arrive (a stale one must not overwrite it). A per-`(ws, sessionId)` sequence
 * number is taken BEFORE the await; after it, the result is dropped when the socket has closed or a
 * newer message arrived. Refusal and indeterminate are a silent no-op, as before.
 */

import type { FileChangeListener, FileWatchManager } from "./file-watch-manager.js";
import { admitFileCwd } from "./lib/file-cwd-admission.js";
import type { RouteAdmissionDeps } from "./lib/route-admission.js";

export interface WatchFilesMessage {
  sessionId?: string;
  cwd?: string;
  paths?: unknown;
}

export interface WatchFilesHandler {
  handle(msg: WatchFilesMessage | undefined, ws: object): Promise<void>;
  /** Clear the connection's watches and drop any admission still in flight for it. */
  onDisconnect(ws: object): void;
}

export function createWatchFilesHandler(deps: {
  routeAdmission: RouteAdmissionDeps;
  manager: FileWatchManager;
  onChange: FileChangeListener;
}): WatchFilesHandler {
  const sequence = new WeakMap<object, Map<string, number>>();
  const closed = new WeakSet<object>();

  return {
    async handle(msg, ws) {
      const sessionId = msg?.sessionId;
      const cwd = msg?.cwd;
      if (!sessionId || !cwd) return;
      // Harden against a malformed client payload: keep only string rel-paths.
      const paths = Array.isArray(msg?.paths) ? msg.paths.filter((p): p is string => typeof p === "string") : [];
      let perSession = sequence.get(ws);
      if (!perSession) {
        perSession = new Map();
        sequence.set(ws, perSession);
      }
      const seq = (perSession.get(sessionId) ?? 0) + 1;
      perSession.set(sessionId, seq);

      const admitted = await admitFileCwd(cwd, deps.routeAdmission);
      if (!admitted.ok) return;
      try {
        if (closed.has(ws) || sequence.get(ws)?.get(sessionId) !== seq) return;
        deps.manager.setWatched(ws, sessionId, admitted.cwd, paths, deps.onChange);
      } finally {
        admitted.release();
      }
    },
    onDisconnect(ws) {
      closed.add(ws);
      deps.manager.clearConnection(ws);
    },
  };
}
