import type { SessionSource } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";

/**
 * Detect the source environment of the current pi session
 * by checking environment variables in priority order.
 *
 * @param hasUI - Whether the pi session has a UI (TUI). When true and ZED_TERM
 *   is set, it means pi TUI is running inside Zed's terminal (not Zed's agent).
 * @param sessionFile - Path to the session's .jsonl file, used to check for
 *   a .meta.json sidecar with source information.
 */
export function detectSessionSource(hasUI?: boolean, sessionFile?: string): SessionSource {
  // A TUI is attached → the session is a CLI/TUI session, not headless,
  // regardless of any .meta.json sidecar (which can be stamped "dashboard"
  // by event-wiring's pendingDashboardSpawns by-cwd matcher when an
  // unrelated dashboard Spawn for the same cwd happened around the same time).
  if (hasUI) {
    if (process.env.ZED_TERM) return "tui"; // pi TUI inside Zed's terminal
    if (process.env.TMUX) return "tmux";
    return "tui";
  }

  // No TUI attached → headless. Check for .meta.json sidecar written by
  // the dashboard server when it spawned this session.
  if (sessionFile) {
    const meta = readSessionMeta(sessionFile);
    if (meta?.source === "dashboard") return "dashboard";
  }

  if (process.env.ZED_TERM) return "zed";
  if (process.env.TMUX) return "tmux";
  return "tui";
}
