/**
 * openspec-cli-shim — make bare `openspec` resolvable inside a pi session.
 *
 * The generated `openspec-*` skills invoke the CLI by bare name. A pi bash
 * child inherits `getShellEnv()`, which reads LIVE `process.env` per call. On a
 * machine with no global `openspec`, bare `openspec` does not resolve and the
 * agent silently degrades to hand-editing artifacts. The only in-session lever
 * is `process.env.PATH`: at bridge init we drop an `openspec` shim into a
 * dedicated dir and prepend that dir to `process.env.PATH`.
 *
 * Design: a DEDICATED dir holding only `openspec` (never `.bin`, which would
 * shadow unrelated binaries); an EXTENSIONLESS `#!/bin/sh` script (Git Bash
 * `bash.exe -c` ignores PATHEXT, so a `.cmd` would not resolve bare `openspec`);
 * the shim invokes the pinned bin via an ABSOLUTE node path (`process.execPath`)
 * so it survives a stripped system PATH; written atomically (temp + rename) and
 * RE-POINTED every init so an extension upgrade refreshes the target. Fail-soft:
 * on any error, log + emit a `missingTool`-style signal, never throw.
 *
 * See change: provision-openspec-cli-in-sessions.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

/** The single-source pinned CLI (see `openspec-cli-version-single-source`; 1.6.0). */
const OPENSPEC_PKG = "@fission-ai/openspec";

export interface ProvisionDeps {
  /** Resolve the pinned openspec bin path. Default: real package resolution. */
  resolveBin?: () => string;
  /** Base dir the shim dir lives under. Default: `~/.pi/dashboard`. */
  baseDir?: string;
  /** Absolute node used in the shim shebang line. Default: `process.execPath`. */
  execPath?: string;
  /** Env object whose PATH is prepended in place. Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Diagnostic logger. Default: `console.warn`. */
  log?: (msg: string, err?: unknown) => void;
  /** Hard-failure surface (bridge injects a dashboard `missingTool` emit). */
  onMissingTool?: (reason: string) => void;
}

export interface ProvisionResult {
  ok: boolean;
  shimDir?: string;
  binPath?: string;
  reason?: string;
}

/**
 * Resolve the pinned `openspec` bin. `@fission-ai/openspec` exports only `"."`,
 * so `require.resolve("@fission-ai/openspec/bin/openspec.js")` (and even
 * `.../package.json`) throw `ERR_PACKAGE_PATH_NOT_EXPORTED`. Resolve the main
 * entry (the `"."` export) then walk up to the package root and join `bin`.
 */
export function resolveOpenspecBin(
  resolveEntry: (spec: string) => string = (spec) => require.resolve(spec),
  fileExists: (p: string) => boolean = fs.existsSync,
  readFile: (p: string) => string = (p) => fs.readFileSync(p, "utf8"),
): string {
  let dir = path.dirname(resolveEntry(OPENSPEC_PKG));
  for (let i = 0; i < 10; i++) {
    const pj = path.join(dir, "package.json");
    if (fileExists(pj)) {
      const pkg = JSON.parse(readFile(pj)) as { name?: string; bin?: string | Record<string, string> };
      if (pkg.name === OPENSPEC_PKG) {
        const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.openspec;
        if (!rel) throw new Error(`${OPENSPEC_PKG} package.json has no bin.openspec`);
        return path.join(dir, rel);
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate ${OPENSPEC_PKG} package root`);
}

/** Ensure `dir` exists, owner-only (`0700`) so a world-writable path can't hijack the shim. */
export function ensureShimDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // recursive mkdir does not chmod an existing dir; enforce perms explicitly.
  fs.chmodSync(dir, 0o700);
}

/**
 * Write the extensionless `openspec` shim to `shimDir`, atomically (temp +
 * rename) and RE-POINTED to `binPath` every call. Mode `0755` (executable).
 * `execPath` is the absolute node the shim `exec`s, so it needs no node on PATH.
 */
export function writeShim(shimDir: string, binPath: string, execPath: string): string {
  const shimPath = path.join(shimDir, "openspec");
  // Single-quote both paths so a path containing `$`, a backtick, whitespace, or
  // a quote cannot expand or break the `exec` line (defense-in-depth: the paths
  // are trusted — require.resolve'd bin + process.execPath — but shell-safe by
  // construction). POSIX single-quote escaping: close, emit \', reopen.
  const script = `#!/bin/sh\nexec ${shSingleQuote(execPath)} ${shSingleQuote(binPath)} "$@"\n`;
  const tmp = path.join(shimDir, `.openspec.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, script, { mode: 0o755 });
  fs.chmodSync(tmp, 0o755); // writeFileSync mode is umask-masked; enforce explicitly.
  fs.renameSync(tmp, shimPath); // atomic replace
  return shimPath;
}

/**
 * Prepend `dir` to `env.PATH` idempotently, comparing CANONICAL (realpath)
 * forms so `/reload` does not duplicate the entry. Returns true if it prepended.
 */
export function prependDirToPath(dir: string, env: NodeJS.ProcessEnv): boolean {
  const canonical = canonicalize(dir);
  const current = env.PATH ?? "";
  const entries = current.split(path.delimiter).filter((e) => e.length > 0);
  const already = entries.some((e) => canonicalize(e) === canonical);
  if (already) return false;
  env.PATH = current.length > 0 ? `${canonical}${path.delimiter}${current}` : canonical;
  return true;
}

/** POSIX single-quote a string for safe embedding in a `/bin/sh` script. */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function canonicalize(p: string): string {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

/**
 * Provision the session so bare `openspec` resolves. Idempotent + fail-soft.
 * Mutates `env.PATH` in place (default `process.env`). Never throws.
 */
export function provisionOpenspecCli(deps: ProvisionDeps = {}): ProvisionResult {
  const {
    resolveBin = () => resolveOpenspecBin(),
    baseDir = path.join(os.homedir(), ".pi", "dashboard"),
    execPath = process.execPath,
    env = process.env,
    log = (msg, err) => console.warn(msg, err ?? ""),
    onMissingTool,
  } = deps;

  let binPath: string;
  try {
    binPath = resolveBin();
  } catch (err) {
    const reason = `[dashboard] openspec CLI provisioning failed: cannot resolve ${OPENSPEC_PKG}`;
    log(reason, err);
    onMissingTool?.(reason);
    return { ok: false, reason };
  }

  const shimDir = path.join(baseDir, "openspec-shim");
  try {
    ensureShimDir(shimDir);
    writeShim(shimDir, binPath, execPath);
    prependDirToPath(shimDir, env);
  } catch (err) {
    const reason = `[dashboard] openspec CLI provisioning failed: cannot write shim in ${shimDir}`;
    log(reason, err);
    onMissingTool?.(reason);
    return { ok: false, reason };
  }

  return { ok: true, shimDir, binPath };
}
