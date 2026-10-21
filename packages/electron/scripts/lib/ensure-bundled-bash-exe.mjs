/**
 * Ship `usr/bin/bash.exe` in the bundled Windows git tree.
 *
 * dugite-native ships GNU bash only as `usr/bin/sh.exe`. pi-coding-agent's
 * `getShellConfig()` (win32) resolves `shellPath` → `%ProgramFiles%\Git\bin\bash.exe`
 * → first `where bash.exe` hit; it never looks for `sh.exe`. A byte copy named
 * `bash.exe` lets pi resolve the bundled shell, and MSYS2 bash then picks
 * `posix off` from argv[0] (`sh` → `posix on`). `sh.exe` stays in place.
 *
 * - `sh.exe` missing → throws (a dugite-native layout change must fail the build,
 *   even when a `bash.exe` is present).
 * - `bash.exe` present → untouched (idempotent; a future tarball that ships a
 *   real bash.exe wins).
 *
 * See change: fix-windows-bundled-bash-exe.
 */
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * @param {string} gitDir the extracted bundle root (`resources/git`)
 * @returns {boolean} true when a copy was made
 */
export function ensureBundledBashExe(gitDir) {
  const usrBin = path.join(gitDir, "usr", "bin");
  const sh = path.join(usrBin, "sh.exe");
  const bash = path.join(usrBin, "bash.exe");
  if (!existsSync(sh)) {
    throw new Error(`bundled git is missing usr/bin/sh.exe (${sh}) — cannot provide usr/bin/bash.exe`);
  }
  if (existsSync(bash)) return false;
  copyFileSync(sh, bash);
  return true;
}
