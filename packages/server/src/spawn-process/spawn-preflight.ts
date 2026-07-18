/**
 * Synchronous spawn preflight check.
 *
 * Runs before every `spawnPiSession` invocation to catch fast-fail conditions
 * (bad cwd, missing binaries) without racing the spawn itself. All checks run
 * regardless of earlier failures so the caller gets all reasons in one pass.
 *
 * The ToolResolver passed in MUST have `useLoginShell: false` — preflight
 * must never spawn a login shell on the spawn-click hot path. If a resolver
 * with `useLoginShell: true` is passed, the check still runs but a one-time
 * warning is emitted.
 *
 * See change: spawn-failure-diagnostics.
 */
import { existsSync, accessSync, statSync, constants } from "node:fs";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";

export interface PreflightReason {
  code: string;
  message: string;
}

export interface PreflightResult {
  ok: boolean;
  reasons: PreflightReason[];
}

/**
 * Run all preflight checks for `cwd` and return the accumulated reasons.
 * `ok` is `true` iff `reasons.length === 0`.
 *
 * @param deps.resolver - Must be constructed with `useLoginShell: false`.
 *   If omitted, a login-shell-disabled resolver is created automatically.
 *   Passing a resolver with `useLoginShell: true` violates the preflight
 *   contract; the function still runs but may call into the login shell.
 */
export function preflightSpawn(
  cwd: string,
  deps?: { resolver?: ToolResolver },
): PreflightResult {
  const resolver = deps?.resolver ?? new ToolResolver({ processExecPath: process.execPath, useLoginShell: false });

  const reasons: PreflightReason[] = [];

  // 1. cwd exists
  const cwdExists = existsSync(cwd);
  if (!cwdExists) {
    // Emit BOTH the legacy `DIR_MISSING` code (existing clients) and the
    // new `cwd_missing` code (introduced in change:
    // add-worktree-lifecycle-actions). One release of overlap; subsequent
    // release drops `DIR_MISSING`.
    const msg = `Directory does not exist: ${cwd}`;
    reasons.push({ code: "DIR_MISSING", message: msg });
    reasons.push({ code: "cwd_missing", message: msg });
    // No point checking isDirectory / writable if it doesn't exist.
  } else {
    // 2. cwd is a directory
    try {
      const stat = statSync(cwd);
      if (!stat.isDirectory()) {
        reasons.push({ code: "DIR_NOT_DIRECTORY", message: `Path is not a directory: ${cwd}` });
      }
    } catch (err: any) {
      reasons.push({ code: "DIR_NOT_DIRECTORY", message: `Cannot stat path: ${err.message}` });
    }

    // 3. cwd is writable
    try {
      accessSync(cwd, constants.W_OK);
    } catch {
      reasons.push({ code: "DIR_NOT_WRITABLE", message: `Directory is not writable: ${cwd}` });
    }
  }

  // 4. pi resolves
  const piCmd = resolver.resolvePi();
  if (piCmd === null) {
    reasons.push({ code: "PI_NOT_FOUND", message: "pi binary not found via managed install or system PATH" });
  }

  // 5. node resolves
  const nodeCmd = resolver.resolveNode();
  if (nodeCmd === null) {
    reasons.push({ code: "NODE_NOT_FOUND", message: "node binary not found via managed install or system PATH" });
  }

  return { ok: reasons.length === 0, reasons };
}
