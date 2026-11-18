/**
 * The one history-seeding path for `.jsonl` header discovery (boot,
 * first-session-in-folder, pin-folder). Seeds a discovered transcript as an
 * ended, visible session via `sessionManager.restore()` — no lifecycle hook,
 * no sidecar write.
 *
 * Skips an id that is resident, in the archive index, or already has a
 * `.meta.json` sidecar: boot restored every usable sidecar, so a non-resident
 * sidecar-backed id is archived or broken, and a header-only seed must never
 * stand in for it. Fails closed (seeds nothing) without an archive index.
 * Synchronous on purpose: no await between the guard and `restore()`.
 *
 * See change: fix-discovery-resurrects-archived.
 */
import { existsSync } from "node:fs";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { metaPath } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { deriveEndedAt } from "./derive-ended-at.js";
import type { SessionManager } from "./memory-session-manager.js";
import type { SessionArchive } from "./session-archive.js";
import type { DiscoveredSession } from "./session-discovery.js";
import { extractSessionStats } from "./session-stats-reader.js";

export interface SeedDiscoveredHistoryDeps {
  sessionManager: SessionManager;
  /** Required key: an absent index would silently reinstate resurrection. */
  sessionArchive: Pick<SessionArchive, "has"> | undefined;
}

/** Seed the guard-passing transcripts; returns the seeded sessions. */
export function seedDiscoveredHistory(
  discovered: readonly DiscoveredSession[],
  deps: SeedDiscoveredHistoryDeps,
): DashboardSession[] {
  const { sessionManager, sessionArchive } = deps;
  if (!sessionArchive) return [];
  const seeded: DashboardSession[] = [];
  for (const hist of discovered) {
    if (sessionManager.get(hist.id)) continue;
    if (sessionArchive.has(hist.id)) continue;
    if (hist.sessionFile && existsSync(metaPath(hist.sessionFile))) continue;

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
      // No `lastActivityAt` here, so stat the transcript rather than lean on a
      // last-activity fallback. See change: fix-ended-session-missing-endedat.
      endedAt: deriveEndedAt({
        sessionFile: hist.sessionFile,
        startedAt: hist.startedAt,
      }),
      sessionFile: hist.sessionFile,
      sessionDir: hist.sessionDir,
      firstMessage: hist.firstMessage,
      // Discovered non-archived history is a visible ended session; `hidden`
      // means "auto-hidden headless worker" only. See change:
      // archive-sessions-lazy-load.
      hidden: false,
      dataUnavailable: true,
      model,
      contextTokens,
      contextWindow,
    });
    const session = sessionManager.get(hist.id);
    if (session) seeded.push(session);
  }
  return seeded;
}
