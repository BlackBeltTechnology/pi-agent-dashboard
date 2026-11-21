/**
 * Session bootstrap: discovers sessions from known directories and starts OpenSpec polling.
 * Called during server startup (async, non-blocking).
 */
import type { SessionManager } from "./memory-session-manager.js";
import type { SessionArchive } from "./session-archive.js";
import type { BrowserGateway } from "../pairing/browser-gateway.js";
import { isOpenSpecDataEmpty, type DirectoryService } from "../directory-service.js";
import { seedDiscoveredHistory } from "./seed-discovered-history.js";

export interface SessionBootstrapDeps {
  sessionManager: SessionManager;
  browserGateway: BrowserGateway;
  directoryService: DirectoryService;
  /** Archive index; an id present here is never re-restored from its .jsonl header. */
  sessionArchive?: SessionArchive;
}

/**
 * Discover sessions from all known directories and broadcast them.
 * Runs async and does not block server startup.
 */
export async function discoverAndBroadcastSessions(deps: SessionBootstrapDeps): Promise<void> {
  const { sessionManager, browserGateway, directoryService, sessionArchive } = deps;

  try {
    const dirs = directoryService.knownDirectories();
    for (const cwd of dirs) {
      // Archived / sidecar-backed ids are never re-seeded from their `.jsonl`
      // header; no index → seed nothing. See change:
      // fix-discovery-resurrects-archived.
      const seeded = seedDiscoveredHistory(directoryService.discoverSessions(cwd), {
        sessionManager,
        sessionArchive,
      });
      for (const session of seeded) browserGateway.broadcastSessionAdded(session);
    }
  } catch (err) {
    console.error("[dashboard] Session discovery failed:", err);
  }

  // Start OpenSpec polling, broadcast changes to browsers. When the worker
  // path supplies a pre-serialized payload, fan out by string concat so the
  // large `data` is stringified exactly once per tick (in the worker).
  // See change: offload-openspec-poll-to-worker.
  directoryService.startPolling(
    (cwd, data, serialized) => {
      if (serialized !== undefined) {
        browserGateway.broadcastOpenSpecUpdate(cwd, serialized);
      } else {
        browserGateway.broadcastToAll({
          type: "openspec_update",
          cwd,
          data,
        } as any);
      }
    },
    // Folder-HEAD updates: fire-and-forget broadcast to all browsers, same
    // fan-out as `openspec_update`. See change: refresh-folder-header-branch.
    (msg) => {
      browserGateway.broadcastToAll(msg as any);
    },
  );

  // Initial OpenSpec poll for all known directories.
  //
  // Fire-and-forget: `refreshOpenSpec` / `pollOpenSpec` is synchronous internally
  // (spawnSync per change) — on Windows with many active changes and multiple
  // pinned directories this can block the event loop for minutes, making the
  // HTTP server unresponsive during startup. We intentionally do NOT await it
  // here so HTTP + WebSocket startup completes immediately.
  //
  // After each directory's poll completes, broadcast `openspec_update` to all
  // connected browsers if the prior cache was empty/undefined or the polled
  // data differs from prior — mirroring the proven `runPostInstallRepair`
  // pattern in `server.ts`. This is what unblocks cold-boot Electron clients
  // that connected before the cache was hot.
  //
  // A proper fix for the slow `spawnSync` path is to migrate the openspec
  // Recipe to async spawn; tracked separately. See change:
  // consolidate-tool-resolution. This change covers the broadcast wiring only.
  // See change: fix-cold-boot-openspec-protocol.
  void Promise.all(
    directoryService.knownDirectories().map(async (cwd) => {
      try {
        const prior = directoryService.getOpenSpecData(cwd);
        const fresh = await directoryService.refreshOpenSpec(cwd);
        const priorEmpty = isOpenSpecDataEmpty(prior);
        const dataDiffers = JSON.stringify(prior) !== JSON.stringify(fresh);
        if (priorEmpty || dataDiffers) {
          browserGateway.broadcastToAll({ type: "openspec_update", cwd, data: fresh });
        }
      } catch (err) {
        console.error(`[dashboard] initial openspec poll failed for ${cwd}:`, err);
      }
    }),
  );
}
