/**
 * Cross-platform OS-command primitives: open URL in default browser,
 * detect whether the host is a virtual machine.
 *
 * Every OS-dependent helper accepts injectable `platform` and `exec`
 * (or `child_exec` for async) parameters, so tests can exercise both
 * branches without mutating globals.
 * See change: consolidate-platform-handlers.
 */

import { exec as childExec, execSync } from "./exec.js";

export type ExecFn = (cmd: string, opts: { encoding: "utf-8"; timeout?: number }) => string;
export type AsyncExecFn = (cmd: string, cb: (err: Error | null) => void) => void;

export interface CommandsOpts {
  /** Override platform (defaults to process.platform). */
  platform?: NodeJS.Platform;
  /** Override synchronous exec (for VM detection tests). */
  exec?: ExecFn;
  /** Override async exec (for openBrowser tests). */
  asyncExec?: AsyncExecFn;
}

function defaultExec(cmd: string, opts: { encoding: "utf-8"; timeout?: number }): string {
  return execSync(cmd, { ...opts, windowsHide: true }) as unknown as string;
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
 *   - win32:  `wmic bios get serialnumber` + `wmic computersystem get manufacturer,model`
 *             patterns: VMware | VirtualBox | VBOX | Parallels | Virtual Machine | Hyper-V
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
      const checks = [
        "wmic bios get serialnumber",
        "wmic computersystem get manufacturer,model",
      ];
      for (const cmd of checks) {
        try {
          const out = String(exec(cmd, { encoding: "utf-8", timeout: 5000 }));
          if (/VMware|VirtualBox|VBOX|Parallels|Virtual Machine|Hyper-V/i.test(out)) return true;
        } catch {
          /* try next */
        }
      }
      return false;
    }
  } catch {
    /* ignore */
  }
  return false;
}
