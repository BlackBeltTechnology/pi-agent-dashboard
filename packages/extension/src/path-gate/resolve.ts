/**
 * Path resolution for the agent path gate — pi parity + canonicalisation.
 *
 * `resolveToolPath` reproduces what pi's `read`/`write`/`edit` do to their path
 * argument (`resolveToCwd` in pi's `dist/core/tools/path-utils.js`): Unicode-space
 * normalisation, `@` strip, win32 shell-path mapping, `~` expansion, `file://`,
 * then resolve against `cwd`. A naive `path.resolve(cwd, arg)` would treat
 * `~/.ssh/id_rsa` as `<cwd>/~/.ssh/id_rsa` (in-root) while pi opens the real
 * file — a fail-open bypass. A parity test pins this against pi's own helper.
 *
 * `canonicalizeTarget` real-paths the nearest existing ancestor and re-appends
 * the not-yet-existing tail, so a symlink escape and a non-existent nested
 * target are both decided on the path the tool will actually open.
 *
 * `path` flavour / platform / realpath are injectable so win32 forms run on POSIX CI.
 * See change: ask-agent-file-access-in-chat (D2).
 */
import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

export interface ResolveEnv {
  path: typeof nodePath;
  platform: NodeJS.Platform;
  homeDir: string;
  realpathSync: (p: string) => string;
}

export function defaultResolveEnv(): ResolveEnv {
  return {
    path: nodePath,
    platform: process.platform,
    homeDir: os.homedir(),
    realpathSync: (p) => fs.realpathSync(p),
  };
}

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/** Git Bash / MSYS / Cygwin / WSL drive paths → native Windows form (pi parity). */
function normalizeWindowsShellPath(filePath: string): string {
  if (!filePath.startsWith("/") || filePath.startsWith("//") || filePath.includes("\\")) return filePath;
  const match = filePath.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
  if (!match) return filePath;
  const suffix = match[2]?.replaceAll("/", "\\");
  return `${match[1].toUpperCase()}:\\${suffix ?? ""}`;
}

function normalizeInput(input: string, env: ResolveEnv, stripAt: boolean): string {
  let n = input.replace(UNICODE_SPACES, " ");
  if (stripAt && n.startsWith("@")) n = n.slice(1);
  if (env.platform === "win32") n = normalizeWindowsShellPath(n);
  if (n === "~") return env.homeDir;
  if (n.startsWith("~/") || (env.platform === "win32" && n.startsWith("~\\"))) {
    return env.path.join(env.homeDir, n.slice(2));
  }
  if (/^file:\/\//.test(n)) return fileURLToPath(n);
  return n;
}

/** Lexical resolution exactly as pi's `resolveToCwd` (no filesystem access). */
export function resolveToolPath(input: string, cwd: string, env: ResolveEnv = defaultResolveEnv()): string {
  const normalized = normalizeInput(input, env, true);
  const base = normalizeInput(cwd, env, false);
  return env.path.isAbsolute(normalized) ? env.path.resolve(normalized) : env.path.resolve(base, normalized);
}

/** Real-path the nearest existing ancestor, re-appending the missing tail. */
export function canonicalizeTarget(absPath: string, env: ResolveEnv = defaultResolveEnv()): string {
  const p = env.path;
  const tail: string[] = [];
  let cur = absPath;
  for (;;) {
    try {
      const real = env.realpathSync(cur);
      return tail.length ? p.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = p.dirname(cur);
      if (parent === cur) return tail.length ? p.join(cur, ...tail.reverse()) : cur;
      tail.push(p.basename(cur));
      cur = parent;
    }
  }
}
