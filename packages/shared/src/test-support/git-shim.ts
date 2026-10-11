/**
 * Test-only fault injection for the `git` binary.
 *
 * `checkoutRoots` / `checkoutRootsAsync` forward only `timeout` to the runner, so
 * a probe failure cannot be injected through the API. The only lever is the
 * binary itself: a temp dir holding a fake `git`, or an environment in which no
 * `git` resolves at all.
 *
 * Two traps, both load-bearing:
 *   - the tool registry caches one Resolution per tool, so a PATH change only
 *     takes effect after `rescan("git")`;
 *   - `ToolResolver.which` falls back to a LOGIN SHELL (`$SHELL -lc 'which git'`)
 *     that brings its own PATH, so emptying PATH alone still resolves a system
 *     git. `SHELL` is pointed at a nonexistent binary to close that fallback.
 *
 * Tests using this must call {@link cleanupGitShims} from `afterAll`.
 *
 * See change: widen-containment-to-resolved-checkout.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getDefaultRegistry } from "../tool-registry/index.js";
import { restoreEnv } from "./git-fixtures.js";

const created: string[] = [];

/** A temp dir holding an executable `git` that runs `body` (POSIX shell). */
export function makeGitShim(body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "git-shim-"));
  writeFileSync(path.join(dir, "git"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  created.push(dir);
  return dir;
}

/**
 * A temp dir holding a `git` that sleeps `delayMs` and then execs the REAL git,
 * so every probe takes at least `delayMs` while still answering truthfully.
 * Resolve the real binary BEFORE putting the shim on PATH (the lookup would
 * otherwise find the shim). Compose with {@link useGitPath} for an in-process
 * test, or put the returned dir first on a spawned server's `PATH`.
 *
 * The runner resolves `git` through the tool registry, which caches one
 * Resolution per tool: the shim only takes effect after `useGitPath`'s
 * `rescan("git")`, or when it is on `PATH` at process start. POSIX shell only.
 * See change: harden-plugin-cwd-admission.
 */
export function makeSlowGitShim(delayMs: number, realGit: string = resolveRealGit()): string {
  const seconds = (delayMs / 1000).toFixed(3);
  // `sleep & wait` so a SIGTERM ends the shim at once instead of leaving the
  // delay running and the stdio pipes held open.
  return makeGitShim(
    `sleep ${seconds} &\nslp=$!\ntrap 'kill $slp 2>/dev/null; exit 143' TERM\nwait $slp\nexec ${JSON.stringify(realGit)} "$@"`,
  );
}

/**
 * Absolute path of the `git` the shared runner currently resolves. Call it BEFORE
 * `useGitPath(shim)`: afterwards the registry resolves the shim itself.
 */
export function resolveRealGit(): string {
  const r = getDefaultRegistry().resolveExecutor("git");
  if (!r.ok || r.argv.length === 0) throw new Error("git is not resolvable");
  return r.argv[0];
}

/**
 * Prepend `dir` to PATH, or — when `dir` is `null` — make git UNAVAILABLE by
 * replacing PATH with an empty directory and `SHELL` with a nonexistent binary.
 * Rescans the registry so the cached `git` Resolution cannot mask the change.
 * Returns a restore function; always call it in a `finally`.
 */
export function useGitPath(dir: string | null): () => void {
  const savedPath = process.env.PATH;
  const savedShell = process.env.SHELL;
  if (dir === null) {
    const empty = mkdtempSync(path.join(tmpdir(), "git-nopath-"));
    created.push(empty);
    process.env.PATH = empty;
    process.env.SHELL = path.join(empty, "no-such-shell");
  } else {
    process.env.PATH = `${dir}${path.delimiter}${savedPath ?? ""}`;
  }
  getDefaultRegistry().rescan("git");
  return () => {
    restoreEnv("PATH", savedPath);
    restoreEnv("SHELL", savedShell);
    getDefaultRegistry().rescan("git");
  };
}

/** Remove every temp dir this module created. Call from `afterAll`. */
export function cleanupGitShims(): void {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
  created.length = 0;
}
