/**
 * resolvePiShell — which `bash.exe` pi-coding-agent would pick on Windows, so
 * diagnostics report what the agent will actually run (not what the dashboard
 * would like it to run).
 *
 * Replica of pi-coding-agent 1.5.0 `getShellConfig()` with no `shellPath`
 * (dist/utils/shell.js — re-check on every pi bump; the build gate
 * assert-bundled-bash-resolvable.mjs compares this replica to the shipped pi):
 *   1. `%ProgramFiles%\Git\bin\bash.exe`, then `%ProgramFiles(x86)%\Git\bin\bash.exe`
 *      — first that exists;
 *   2. else the first `where bash.exe` hit that exists — modelled as the first
 *      PATH directory holding `bash.exe` (`where` lists only existing files, in
 *      PATH order; it also searches the process cwd first, a documented residual);
 *   3. else none (pi throws "No bash shell found").
 * pi never looks for `sh.exe`.
 *
 * Pure: env + fs are injected. Contains NO bundled-git path literals (it only
 * scans PATH), so it stays outside no-hardcoded-bundled-git-paths.test.ts.
 *
 * Existence mirrors pi's `shellPathExists` (`accessSync(F_OK)`, which on Windows
 * also accepts runnable Store aliases that `existsSync` rejects). The WSL-launcher
 * check is pi's `isLegacyWslBashPath` (1.4.0+), `SystemRoot`-aware, classified
 * against the spawn env.
 *
 * See change: fix-windows-bundled-bash-exe, update-pi-core-1-5-adopt-apis.
 */
import { accessSync, constants } from "node:fs";
import path from "node:path";

export interface ResolvedPiShell {
  path: string;
  /** pi treats System32/Sysnative bash.exe as the WSL launcher (stdin transport). */
  isWslLauncher: boolean;
}

export interface ResolvePiShellOpts {
  /** Spawn env the agent process would receive. */
  env: NodeJS.ProcessEnv;
  /** Override the existence check (default: pi's `accessSync(F_OK)`) for tests. */
  exists?: (p: string) => boolean;
}

/** pi's shell existence check (`shellPathExists`): `accessSync(p, F_OK)`, false on any error. */
function piPathExists(p: string): boolean {
  try {
    accessSync(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * pi's `isLegacyWslBashPath` (1.4.0+): with `SystemRoot` set (case-insensitive
 * key), only `<SystemRoot>\System32\bash.exe` and `<SystemRoot>\Sysnative\bash.exe`
 * are the launcher, and a `SystemRoot` that is not drive-absolute means "not the
 * launcher". The fixed `<drive>:\windows\(system32|sysnative)\bash.exe` pattern is
 * only the fallback when `SystemRoot` is unset.
 */
export function isWslLauncherBash(p: string, env: NodeJS.ProcessEnv): boolean {
  const win32 = path.win32;
  const normalized = win32.normalize(p).toLowerCase();
  const systemRoot = envGet(env, "SystemRoot");
  if (systemRoot) {
    if (!/^[a-z]:[\\/]/i.test(systemRoot)) return false;
    return ["System32", "Sysnative"].some(
      (dir) => normalized === win32.join(systemRoot, dir, "bash.exe").toLowerCase(),
    );
  }
  return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/.test(normalized);
}

/** Case-insensitive env lookup (Windows env keys are case-insensitive). */
function envGet(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === lower) {
      const v = env[key];
      if (typeof v === "string" && v !== "") return v;
    }
  }
  return undefined;
}

export function resolvePiShell(opts: ResolvePiShellOpts): ResolvedPiShell | null {
  const exists = opts.exists ?? piPathExists;
  const join = path.win32.join;
  const found = (p: string): ResolvedPiShell => ({ path: p, isWslLauncher: isWslLauncherBash(p, opts.env) });

  for (const key of ["ProgramFiles", "ProgramFiles(x86)"]) {
    const root = envGet(opts.env, key);
    if (!root) continue;
    const candidate = `${root}\\Git\\bin\\bash.exe`;
    if (exists(candidate)) return found(candidate);
  }

  const pathValue = envGet(opts.env, "PATH") ?? "";
  for (const raw of pathValue.split(";")) {
    const dir = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!dir) continue;
    const candidate = join(dir, "bash.exe");
    if (exists(candidate)) return found(candidate);
  }
  return null;
}
