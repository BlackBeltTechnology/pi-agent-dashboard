/**
 * Cross-platform OS-command primitives: open URL in default browser,
 * detect whether the host is a virtual machine.
 *
 * Every OS-dependent helper accepts injectable `platform` and `exec`
 * (or `child_exec` for async) parameters, so tests can exercise both
 * branches without mutating globals.
 * See change: consolidate-platform-handlers.
 */

import { exec as childExec, execSync, spawnSync } from "./exec.js";

type ExecFn = (cmd: string, opts: { encoding: "utf-8"; timeout?: number }) => string;
export type AsyncExecFn = (cmd: string, cb: (err: Error | null) => void) => void;

/** Minimal spawnSync surface used by the Windows VM probe (argv form, no shell). */
export type VmSpawnSyncFn = (
  command: string,
  args: readonly string[],
  opts: {
    encoding: "utf-8";
    windowsHide?: boolean;
    timeout?: number;
    stdio?: readonly ["ignore", "pipe", "pipe"];
  },
) => { status: number | null; stdout: string | null };

export interface CommandsOpts {
  /** Override platform (defaults to process.platform). */
  platform?: NodeJS.Platform;
  /** Override synchronous exec (for VM detection tests). */
  exec?: ExecFn;
  /** Override async exec (for openBrowser tests). */
  asyncExec?: AsyncExecFn;
  /** Override spawnSync (for the Windows VM-probe tests). */
  spawnSync?: VmSpawnSyncFn;
}

function defaultExec(cmd: string, opts: { encoding: "utf-8"; timeout?: number }): string {
  return execSync(cmd, { ...opts, windowsHide: true }) as unknown as string;
}

function defaultVmSpawnSync(
  command: string,
  args: readonly string[],
  opts: { encoding: "utf-8"; windowsHide?: boolean; timeout?: number; stdio?: readonly ["ignore", "pipe", "pipe"] },
): { status: number | null; stdout: string | null } {
  return spawnSync<string>(command, args, opts as never);
}

/** Regex of known virtual-machine markers in BIOS / computer-system output. */
const VM_MARKERS = /VMware|VirtualBox|VBOX|Parallels|Virtual Machine|Hyper-V/i;

/**
 * Pure parser: does Windows Get-CimInstance probe output indicate a VM?
 * Exposed so unit tests exercise the regex without spawning PowerShell.
 */
export function parseVmProbeOutput(text: string): boolean {
  return VM_MARKERS.test(text);
}

function defaultAsyncExec(cmd: string, cb: (err: Error | null) => void): void {
  childExec(cmd, { windowsHide: true }, (err) => cb(err));
}

// ── Open URL in default browser ─────────────────────────────────────────────

/**
 * Open a URL in the system's default browser. Fire-and-forget; errors are
 * logged via `onError` but not thrown.
 *   - darwin: `open "<url>"`
 *   - win32:  `start "" "<url>"`
 *   - linux:  `xdg-open "<url>"`
 */
export function openBrowser(
  url: string,
  opts: CommandsOpts & { onError?: (err: Error) => void } = {},
): void {
  const platform = opts.platform ?? process.platform;
  const asyncExec = opts.asyncExec ?? defaultAsyncExec;
  const quoted = JSON.stringify(url);
  const cmd =
    platform === "darwin" ? `open ${quoted}`
    : platform === "win32" ? `start "" ${quoted}`
    : `xdg-open ${quoted}`;
  asyncExec(cmd, (err) => {
    if (err && opts.onError) opts.onError(err);
  });
}

// ── Virtual-machine detection ───────────────────────────────────────────────

/**
 * Best-effort virtual-machine detection. Uses platform-specific probes:
 *   - darwin: `sysctl -n hw.model` looks for VMware/VirtualBox/Parallels
 *   - linux:  `systemd-detect-virt` — non-`none` output means VM
 *   - win32:  PowerShell `Get-CimInstance Win32_BIOS` + `Win32_ComputerSystem`
 *             patterns: VMware | VirtualBox | VBOX | Parallels | Virtual Machine | Hyper-V
 *             (wmic removed by default on Win 11 22H2+; PowerShell ships everywhere)
 *
 * Returns `false` on any probe failure (best-effort).
 */
export function isVirtualMachine(opts: CommandsOpts = {}): boolean {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExec;
  try {
    if (platform === "darwin") {
      const model = String(exec("sysctl -n hw.model", { encoding: "utf-8" })).trim();
      return /VMware|VirtualBox|Parallels/i.test(model);
    }
    if (platform === "linux") {
      const virt = String(exec("systemd-detect-virt 2>/dev/null || echo none", { encoding: "utf-8" })).trim();
      return virt !== "none" && virt.length > 0;
    }
    if (platform === "win32") {
      const spawn = opts.spawnSync ?? defaultVmSpawnSync;
      // Single PowerShell invocation runs both CIM checks and concatenates
      // the output. spawnSync (argv form, no shell) means a missing
      // powershell.exe never leaks a cmd.exe "not recognized" line to the
      // parent process's stderr — the failure surfaces via `status`/`error`.
      const script =
        "$b = (Get-CimInstance -ClassName Win32_BIOS -ErrorAction SilentlyContinue).SerialNumber; " +
        "$c = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue | " +
        "Select-Object -Property Manufacturer,Model | Out-String; " +
        'Write-Output "$b`n$c"';
      const r = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf-8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 8000 },
      );
      if (r?.status !== 0) return false;
      return parseVmProbeOutput(r.stdout ?? "");
    }
  } catch {
    /* ignore */
  }
  return false;
}
