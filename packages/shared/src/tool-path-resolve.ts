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
 *
 * Shared by the interactive path gate (`packages/extension/src/path-gate`) and the
 * fail-closed `path-containment-guard` extension, so there is one copy of the
 * realpath / case-folding / component-wise containment rules. `canonicalizeTarget`
 * also follows DANGLING symlinks (a write through one creates its target).
 * See change: ask-agent-file-access-in-chat (D2), add-path-containment-guard-extension (D1, D6).
 */
import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { volumeCaseInsensitive } from "./canonical-subject.js";

export interface ResolveEnv {
  path: typeof nodePath;
  platform: NodeJS.Platform;
  homeDir: string;
  realpathSync: (p: string) => string;
  /** `fs.accessSync(p, F_OK)` as pi's `fileExists` (follows symlinks). Injectable for tests. */
  exists: (p: string) => boolean;
  /** `fs.statSync(p).isDirectory()`, false when missing. Injectable for tests. */
  isDirectory: (p: string) => boolean;
  /**
   * `fs.lstatSync(p).isSymbolicLink()`, false when missing. Optional: an env
   * literal without it behaves as before (no dangling-link following).
   */
  isSymlink?: (p: string) => boolean;
  /** `fs.readlinkSync(p)`. Optional, paired with `isSymlink`. */
  readlink?: (p: string) => string;
}

export function defaultResolveEnv(): ResolveEnv {
  return {
    path: nodePath,
    platform: process.platform,
    homeDir: os.homedir(),
    realpathSync: (p) => fs.realpathSync(p),
    exists: (p) => {
      try {
        fs.accessSync(p, fs.constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    isDirectory: (p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    },
    isSymlink: (p) => {
      try {
        return fs.lstatSync(p).isSymbolicLink();
      } catch {
        return false;
      }
    },
    readlink: (p) => fs.readlinkSync(p),
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

/**
 * What pi's `read` actually opens: `resolveReadPath` tries the literal name, then —
 * only when it does not exist — an AM/PM narrow-no-break-space variant, an NFD
 * variant, a curly-quote variant and the NFD+curly combination (final name only,
 * same directory). The gate must decide on THAT path: an in-root variant that is a
 * symlink to an outside file would otherwise pass as the missing literal name.
 * `write` / `edit` use plain `resolveToCwd` (no fallback) and never call this.
 * Parity-tested against pi's own helper.
 */
export function resolveReadTarget(resolved: string, env: ResolveEnv = defaultResolveEnv()): string {
  if (env.exists(resolved)) return resolved;
  const amPm = resolved.replace(/ (AM|PM)\./gi, "\u202F$1.");
  if (amPm !== resolved && env.exists(amPm)) return amPm;
  const nfd = resolved.normalize("NFD");
  if (nfd !== resolved && env.exists(nfd)) return nfd;
  const curly = resolved.replace(/'/g, "\u2019");
  if (curly !== resolved && env.exists(curly)) return curly;
  const nfdCurly = nfd.replace(/'/g, "\u2019");
  if (nfdCurly !== resolved && env.exists(nfdCurly)) return nfdCurly;
  return resolved;
}

/** Matches common `SYMLOOP_MAX`; shared across restarts within one canonicalisation. */
const MAX_SYMLINK_HOPS = 40;

/**
 * Resolve a symlink's text the way the kernel does: component by component from
 * the link's REAL parent (relative text) or from its own root (absolute text).
 * `..` is taken from the already-real prefix, so a symlinked intermediate
 * directory is followed first (a lexical `resolve(dirname, text)` would collapse
 * `..` as text — a bypass under a symlinked directory).
 */
function resolveLinkText(linkPath: string, text: string, env: ResolveEnv): string {
  const p = env.path;
  const root = p.isAbsolute(text) ? p.parse(text).root : "";
  let base = root || env.realpathSync(p.dirname(linkPath));
  const parts = text.slice(root.length).split(env.platform === "win32" ? /[\\/]+/ : "/");
  for (const part of parts) {
    if (part !== "" && part !== ".") base = part === ".." ? p.dirname(base) : realOrSelf(p.join(base, part), env);
  }
  return base;
}

/** `realpath` when the path exists, else the path itself (it may still be a dangling link). */
function realOrSelf(next: string, env: ResolveEnv): string {
  return tryRealpath(next, env) ?? next;
}

function tryRealpath(p: string, env: ResolveEnv): string | undefined {
  try {
    return env.realpathSync(p);
  } catch {
    return undefined;
  }
}

/** Re-append the collected (leaf-first) tail below `base`. */
function joinTail(env: ResolveEnv, base: string, tail: readonly string[]): string {
  return tail.length ? env.path.join(base, ...[...tail].reverse()) : base;
}

/**
 * Real-path the nearest existing ancestor, re-appending the missing tail. A
 * dangling symlink on the walk is followed to its target (restarting from there,
 * hop-bounded; throws when exceeded or when its parent cannot be resolved).
 */
export function canonicalizeTarget(absPath: string, env: ResolveEnv = defaultResolveEnv()): string {
  const p = env.path;
  const tail: string[] = [];
  let cur = absPath;
  let hops = 0;
  for (;;) {
    const real = tryRealpath(cur, env);
    if (real !== undefined) return joinTail(env, real, tail);
    if (env.isSymlink?.(cur) && env.readlink) {
      if (++hops > MAX_SYMLINK_HOPS) throw new Error(`too many symbolic links resolving ${absPath}`);
      cur = joinTail(env, resolveLinkText(cur, env.readlink(cur), env), tail);
      tail.length = 0;
      continue;
    }
    const parent = p.dirname(cur);
    if (parent === cur) return joinTail(env, cur, tail);
    tail.push(p.basename(cur));
    cur = parent;
  }
}

function fold(s: string, ci: boolean): string {
  const nfc = s.normalize("NFC");
  return ci ? nfc.toLowerCase() : nfc;
}

/**
 * Whether the volume holding `canonical` compares case-insensitively. PROBED from
 * the volume on a real host (a case-sensitive APFS volume on macOS must not fold);
 * on an injected foreign flavour (tests) the platform default stands.
 */
function defaultVolumeProbe(canonical: string, env: ResolveEnv): boolean {
  const realHost = env.path === nodePath && env.platform === process.platform;
  if (realHost) return volumeCaseInsensitive(canonical);
  return env.platform === "win32" || env.platform === "darwin";
}

/** Component-wise containment on already-canonical paths (never a string prefix). */
export function isWithinRoot(candidate: string, root: string, env: ResolveEnv, ci: boolean): boolean {
  const p = env.path;
  const c = fold(candidate, ci);
  const r = fold(root, ci);
  if (c === r) return true;
  const rel = p.relative(r, c);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel);
}

export interface WithinRootsOptions {
  env?: ResolveEnv;
  /** Force volume case sensitivity (tests). Default: probed from the volume. */
  caseInsensitive?: boolean;
  /** Injectable volume probe (path → folds case?). Default: the shared probe on a real host. */
  volumeCaseProbe?: (existingPathOrAncestor: string) => boolean;
}

/**
 * Whether `canonical` lies inside any of `roots` (all already canonical). Exact
 * (case-sensitive) match is valid on every volume, so the in-root hot path never
 * probes; only when it fails is the volume asked whether case folds.
 */
export function isPathWithinRoots(canonical: string, roots: readonly string[], opts: WithinRootsOptions = {}): boolean {
  const env = opts.env ?? defaultResolveEnv();
  const containedBy = (ci: boolean): boolean => roots.some((root) => isWithinRoot(canonical, root, env, ci));
  if (containedBy(false)) return true;
  const ci =
    opts.caseInsensitive ??
    (opts.volumeCaseProbe ? opts.volumeCaseProbe(canonical) : defaultVolumeProbe(canonical, env));
  return ci ? containedBy(true) : false;
}
