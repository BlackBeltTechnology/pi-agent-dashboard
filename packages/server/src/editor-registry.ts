/**
 * Static editor registry and detection logic.
 * Detects available editors by checking for running processes + CLI on PATH.
 * Uses shared platform primitives so the win32 / unix split is owned in one
 * place. See change: consolidate-platform-handlers.
 */
import { isProcessRunning as platformIsProcessRunning } from "@blackbelt-technology/pi-dashboard-shared/platform/process-scan.js";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";

export interface EditorEntry {
  id: string;
  name: string;
  cli: string;
  processPattern: { darwin: string; linux: string; win32?: string };
  /** Windows CLI name when different from Unix (e.g., "code.cmd") */
  winCli?: string;
}

export interface DetectedEditor {
  id: string;
  name: string;
}

export const EDITORS: EditorEntry[] = [
  {
    id: "zed",
    name: "Zed",
    cli: "zed",
    processPattern: { darwin: "/Applications/Zed.app", linux: "zed" },
    // Zed not available on Windows
  },
  {
    id: "vscode",
    name: "VS Code",
    cli: "code",
    winCli: "code.cmd",
    processPattern: {
      darwin: "/Applications/Visual Studio Code.app",
      linux: "code",
      win32: "Code.exe",
    },
  },
  {
    id: "idea",
    name: "IntelliJ",
    cli: "idea",
    winCli: "idea64.exe",
    processPattern: {
      darwin: "/Applications/IntelliJ IDEA",
      linux: "idea",
      win32: "idea64.exe",
    },
  },
];

// Cached resolver for binary-availability checks (reads PATH via `where`/`which`).
const resolver = new ToolResolver({ processExecPath: process.execPath });

/**
 * Platform-unified process-running check. Re-exported for callers (and tests)
 * that previously imported it from this module.
 */
export function isProcessRunning(pattern: string): boolean {
  return platformIsProcessRunning(pattern);
}

/**
 * @deprecated Use `isProcessRunning(pattern)` — the shared primitive now
 * handles the Windows (tasklist) vs Unix (pgrep) split internally. Kept as
 * a thin alias for tests that still call it directly.
 */
export function isProcessRunningWin32(pattern: string): boolean {
  return platformIsProcessRunning(pattern, { platform: "win32" });
}

function isCliAvailable(cli: string): boolean {
  return resolver.which(cli) !== null;
}

export function detectEditors(_cwd: string): DetectedEditor[] {
  const platform = process.platform;
  const results: DetectedEditor[] = [];

  for (const editor of EDITORS) {
    let pattern: string | undefined;
    let cli: string;

    if (platform === "win32") {
      pattern = editor.processPattern.win32;
      if (!pattern) continue; // Editor not available on Windows
      cli = editor.winCli || editor.cli;
    } else {
      const key = platform === "darwin" ? "darwin" : "linux";
      pattern = editor.processPattern[key];
      cli = editor.cli;
    }

    const running = isProcessRunning(pattern);

    if (running && isCliAvailable(cli)) {
      results.push({ id: editor.id, name: editor.name });
    }
  }
  return results;
}
