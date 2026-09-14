/**
 * "Can this host reach a desktop?" — the pure capability probe behind the
 * editor-pane system-open actions (change: open-view-command-in-editor-pane
 * D9/D10) and the browser plugin's `chromeOpenAvailable` (change:
 * add-browser-relay D4/2.10).
 *
 * It lives in `shared` rather than in the server package because the browser
 * plugin is a separate package that must NOT depend on
 * `pi-dashboard-server` — but it must answer the SAME question, or
 * `/api/health.capabilities.systemOpen` and `GET /api/browser/status`
 * (`canOpenChrome`) could disagree about the same host. The server re-exports
 * these from `system-open-capability.ts`, so its public surface is unchanged.
 *
 * Detection precedence:
 *   1. `PI_DASHBOARD_SYSTEM_OPEN=0|1` explicit override wins (Docker sets `0`).
 *   2. macOS / Windows → true (desktop OSes ship `open` / opener).
 *   3. Linux → true only with a display session (`DISPLAY`/`WAYLAND_DISPLAY`)
 *      AND not a container; else false (headless server / CI).
 *   4. Anything else → false.
 */
import { existsSync } from "node:fs";

/** Best-effort container probe (Docker writes `/.dockerenv`). */
export function detectContainer(): boolean {
  try {
    return existsSync("/.dockerenv");
  } catch {
    return false;
  }
}

export function computeSystemOpen(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  isContainer: () => boolean = detectContainer,
): boolean {
  const override = env.PI_DASHBOARD_SYSTEM_OPEN;
  if (override === "0") return false;
  if (override === "1") return true;
  if (platform === "darwin" || platform === "win32") return true;
  if (platform === "linux") {
    const hasDisplay = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
    return hasDisplay && !isContainer();
  }
  return false;
}
