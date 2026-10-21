/**
 * resolvePiShell — which `bash.exe` pi-coding-agent would pick on Windows, so
 * diagnostics report what the agent will actually run (not what the dashboard
 * would like it to run).
 *
 * Replica of pi-coding-agent 1.3.0 `getShellConfig()` with no `shellPath`
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
 * See change: fix-windows-bundled-bash-exe.
 */
import { existsSync } from "node:fs";
import path from "node:path";

export interface ResolvedPiShell {
  path: string;
  /** pi treats System32/Sysnative bash.exe as the WSL launcher (stdin transport). */
  isWslLauncher: boolean;
}

export interface ResolvePiShellOpts {
  /** Spawn env the agent process would receive. */
  env: NodeJS.ProcessEnv;
  /** Override `fs.existsSync` for tests. */
  exists?: (p: string) => boolean;
}

/** pi's `isLegacyWslBashPath`: `[a-z]:\windows\(system32|sysnative)\bash.exe`. */
export function isWslLauncherBash(p: string): boolean {
  const normalized = p.replace(/\//g, "\\").toLowerCase();
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
  const exists = opts.exists ?? existsSync;
  const join = path.win32.join;
  const found = (p: string): ResolvedPiShell => ({ path: p, isWslLauncher: isWslLauncherBash(p) });

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
