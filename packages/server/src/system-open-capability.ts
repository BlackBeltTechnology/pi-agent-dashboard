/**
 * Server capability + command builders for the editor-pane system-open actions
 * (D9/D10). The opener spawns on the SERVER host, so "can we reach a desktop?"
 * is a server fact — never a browser-origin check. `computeSystemOpen` answers
 * it once; `/api/health` advertises `capabilities.systemOpen` and the client
 * shows the two file actions only when it is true.
 *
 * Detection precedence (D9):
 *   1. `PI_DASHBOARD_SYSTEM_OPEN=0|1` explicit override wins (Docker sets `0`).
 *   2. macOS / Windows → true (desktop OSes ship `open` / opener).
 *   3. Linux → true only with a display session (`DISPLAY`/`WAYLAND_DISPLAY`)
 *      AND not a container; else false (headless server / CI).
 *   4. Anything else → false.
 *
 * See change: open-view-command-in-editor-pane (D9/D10).
 */
import { existsSync } from "node:fs";
import { dirname } from "node:path";
// Safe wrapper (uniform `windowsHide` etc.); direct node:child_process is
// banned outside platform/exec.ts. See change: platform-command-executor.
import { execFile } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

/** Best-effort container probe (Docker writes `/.dockerenv`). */
function detectContainer(): boolean {
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

let cached: boolean | undefined;
/** Memoized capability, computed once at first read (process lifetime). */
export function systemOpenCapability(): boolean {
  if (cached === undefined) cached = computeSystemOpen();
  return cached;
}

export interface OpenerCommand {
  cmd: string;
  args: string[];
}

/** Default-app open. No-shell argv; the resolved path is its own element. */
export function buildOpenCommand(platform: NodeJS.Platform, resolved: string): OpenerCommand {
  if (platform === "darwin") return { cmd: "open", args: [resolved] };
  if (platform === "win32") return { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", resolved] };
  return { cmd: "xdg-open", args: [resolved] };
}

/**
 * Reveal-in-file-manager (selects WITHOUT executing). Windows passes `/select,`
 * and the path as separate argv elements; Linux opens the containing directory
 * (no file exec). No-shell argv throughout.
 */
export function buildRevealCommand(platform: NodeJS.Platform, resolved: string): OpenerCommand {
  if (platform === "darwin") return { cmd: "open", args: ["-R", resolved] };
  if (platform === "win32") return { cmd: "explorer", args: ["/select,", resolved] };
  return { cmd: "xdg-open", args: [dirname(resolved)] };
}

/**
 * Fire-and-forget spawn via `execFile` (argv array — never a shell string, so a
 * path with a comma/space/quote cannot inject). Errors are swallowed: a failed
 * opener must not 500 the endpoint (the file/path was already validated).
 */
export function runOpener(cmd: string, args: string[]): void {
  execFile(cmd, args, () => {
    /* detached opener; ignore result */
  });
}
