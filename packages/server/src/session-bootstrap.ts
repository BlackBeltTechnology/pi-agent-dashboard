/**
 * Session bootstrap: discovers sessions from known directories and starts OpenSpec polling.
 * Called during server startup (async, non-blocking).
 */
import type { SessionManager } from "./memory-session-manager.js";
import type { BrowserGateway } from "./browser-gateway.js";
import type { DirectoryService } from "./directory-service.js";
import { extractSessionStats } from "./session-stats-reader.js";

export interface SessionBootstrapDeps {
  sessionManager: SessionManager;
  browserGateway: BrowserGateway;
  directoryService: DirectoryService;
}

/**
 * Discover sessions from all known directories and broadcast them.
 * Runs async and does not block server startup.
 */
export async function discoverAndBroadcastSessions(deps: SessionBootstrapDeps): Promise<void> {
  const { sessionManager, browserGateway, directoryService } = deps;

  try {
    const dirs = directoryService.knownDirectories();
    for (const cwd of dirs) {
      const discovered = directoryService.discoverSessions(cwd);
      for (const hist of discovered) {
        if (!sessionManager.get(hist.id)) {
          let contextTokens: number | undefined;
          let contextWindow: number | undefined;
          let model: string | undefined;
          if (hist.sessionFile) {
            try {
              const stats = extractSessionStats(hist.sessionFile);
              if (stats) {
                contextTokens = stats.lastTotalTokens;
                contextWindow = stats.contextWindow;
                model = stats.model;
              }
            } catch { /* ignore */ }
          }
          sessionManager.restore({
            id: hist.id,
            cwd: hist.cwd,
            name: hist.name,
            source: "tui",
            status: "ended",
            startedAt: hist.startedAt,
            sessionFile: hist.sessionFile,
            sessionDir: hist.sessionDir,
            firstMessage: hist.firstMessage,
            hidden: true,
            dataUnavailable: true,
            model,
            contextTokens,
            contextWindow,
          });
          const session = sessionManager.get(hist.id);
          if (session) browserGateway.broadcastSessionAdded(session);
        }
      }
    }
  } catch (err) {
    console.error("[dashboard] Session discovery failed:", err);
  }

  // Start OpenSpec polling, broadcast changes to browsers
  directoryService.startPolling((cwd, data) => {
    browserGateway.broadcastToAll({
      type: "openspec_update",
      cwd,
      data,
    } as any);
  });

  // Initial OpenSpec poll for all known directories.
  //
  // NOTE: `refreshOpenSpec` / `pollOpenSpec` is currently synchronous internally
  // (spawnSync per change) — on Windows with many active changes (~19) and
  // multiple pinned directories this can block the event loop for minutes,
  // making the HTTP server unresponsive during startup. We intentionally do
  // NOT await it here so HTTP + WebSocket startup completes immediately;
  // openspec data populates in the background and pushes `openspec_update`
  // broadcasts to browsers as each directory finishes.
  //
  // A proper fix is to migrate the openspec Recipe to async spawn; tracked
  // separately. See change: consolidate-tool-resolution.
  void Promise.all(
    directoryService.knownDirectories().map(async (cwd) => {
      try { await directoryService.refreshOpenSpec(cwd); }
      catch (err) { console.error(`[dashboard] initial openspec poll failed for ${cwd}:`, err); }
    }),
  );
}
