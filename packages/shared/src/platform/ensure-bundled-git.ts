/**
 * ensureBundledGitOnPath — prepend the bundled `resources/git/` tree to
 * `env.PATH` (and set `GIT_EXEC_PATH` / `SSL_CERT_FILE`) when the active
 * git source is "bundled" on Windows. Sibling to ensureWindowsSystemPath.
 *
 * Layout verified by the R1 CI spike (dugite-native v2.53.0-3):
 *   cmd/git.exe              git launcher
 *   usr/bin/sh.exe           POSIX shell (GNU bash under the name `sh`;
 *                            dugite-native ships NO bash.exe).
 *   usr/bin/bash.exe         byte copy of sh.exe added by the build step
 *                            (download-git-windows.mjs). pi's getShellConfig()
 *                            (bash tool, `!`, `!cmd`) resolves only a file named
 *                            bash.exe — never sh.exe — so this is the file pi
 *                            picks when usr/bin precedes System32 on PATH.
 *   <libdir>/bin             git core libs + DLLs. <libdir> is
 *                            arch-specific: `mingw64` on win32-x64,
 *                            `clangarm64` on win32-arm64.
 *   <libdir>/libexec/git-core   GIT_EXEC_PATH target
 *
 * sh.exe is a real copied binary (not a symlink), so it survives ZIP
 * extraction — also confirmed by the spike.
 *
 * This module is the ONLY place allowed to reference bundled-git paths
 * (enforced by no-hardcoded-bundled-git-paths.test.ts).
 *
 * See change: embed-git-bash-on-windows, fix-windows-bundled-bash-exe.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { GitSource, WindowsBashSourceSetting } from "./select-git-source.js";

/** Arch-specific MinGW/Clang library dir names, in probe order. */
const GIT_LIBDIRS = ["mingw64", "clangarm64"] as const;

/** Relative path to the git launcher — the bundle's presence marker. */
const GIT_LAUNCHER_REL = path.win32.join("cmd", "git.exe");

export interface ResolveBundledGitDirOpts {
  /** Override `process.platform` for tests. */
  platform?: NodeJS.Platform;
  /** `process.resourcesPath` (Electron). Undefined outside Electron. */
  resourcesPath?: string;
  /** Extra candidate roots (e.g. a standalone server bundle dir). */
  candidates?: string[];
  /** Override `fs.existsSync` for tests. */
  exists?: (p: string) => boolean;
}

/**
 * Locate the bundled `resources/git/` directory. Returns the absolute
 * path when it exists and contains `cmd/git.exe`, else `null` (dev tree,
 * non-electron server, or mac/linux bundle with no git).
 */
export function resolveBundledGitDir(opts: ResolveBundledGitDirOpts = {}): string | null {
  const exists = opts.exists ?? existsSync;
  const join = path.win32.join;

  const roots: string[] = [];
  if (opts.resourcesPath) roots.push(join(opts.resourcesPath, "git"));
  for (const c of opts.candidates ?? []) roots.push(c);

  for (const root of roots) {
    if (exists(join(root, GIT_LAUNCHER_REL))) return root;
  }
  return null;
}

/**
 * Pick the arch-specific lib dir (`mingw64` / `clangarm64`) under the
 * bundled git root, or `null` when neither exists.
 */
function resolveLibDir(gitDir: string, exists: (p: string) => boolean): string | null {
  for (const name of GIT_LIBDIRS) {
    if (exists(path.win32.join(gitDir, name))) return name;
  }
  return null;
}

export interface EnsureBundledGitOpts {
  /** Override `process.platform` for tests. */
  platform?: NodeJS.Platform;
  /**
   * Resolved active source. No-op unless "bundled". Callers pass the
   * cached `getActiveGitSource()` value.
   */
  source?: GitSource;
  /**
   * Bundled git root (…/resources/git). When omitted, resolved via
   * {@link resolveBundledGitDir} using `resourcesPath`. `null` → no-op.
   */
  gitDir?: string | null;
  /** Forwarded to resolveBundledGitDir when `gitDir` omitted. */
  resourcesPath?: string;
  candidates?: string[];
  /** Override `fs.existsSync` for tests. */
  exists?: (p: string) => boolean;
  /**
   * Where `usr/bin` (the bundled bash) sits on PATH. "bundled" (default) →
   * prepended ahead of System32; "host" → appended last so pi resolves the
   * host's first `bash.exe`. See change: fix-windows-bundled-bash-exe.
   */
  bashSource?: WindowsBashSourceSetting;
}

/** Trailing-separator-trimmed, case-folded PATH entry key. */
const entryKey = (e: string): string => e.trim().replace(/[\\/]+$/, "").toLowerCase();

/**
 * Prepend bundled git/sh dirs to `env.PATH` and set git env vars when the
 * active source is "bundled" on Windows. Idempotent. No-op when:
 *   - platform is not win32,
 *   - `source` is provided and !== "bundled",
 *   - no bundled git tree is resolvable.
 *
 * Idempotence invariant:
 *   ensureBundledGitOnPath(ensureBundledGitOnPath(env)) deep-equals
 *   ensureBundledGitOnPath(env).
 */
export function ensureBundledGitOnPath(
  env: NodeJS.ProcessEnv,
  opts: EnsureBundledGitOpts = {},
): NodeJS.ProcessEnv {
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32") return env;
  if (opts.source && opts.source !== "bundled") return env;

  const exists = opts.exists ?? existsSync;
  const gitDir =
    opts.gitDir !== undefined
      ? opts.gitDir
      : resolveBundledGitDir({
          platform,
          resourcesPath: opts.resourcesPath,
          candidates: opts.candidates,
          exists,
        });
  if (!gitDir) return env;

  const join = path.win32.join;
  const libDir = resolveLibDir(gitDir, exists);

  // Placement. `cmd` + `<libdir>/bin` always precede the inherited PATH.
  // `usr/bin` (bash.exe + MSYS coreutils) precedes it in "bundled" mode and
  // follows it in "host" mode. Existing entries for these dirs are stripped
  // first (case/trailing-slash-insensitive) so switching mode MOVES usr/bin
  // and re-applying is idempotent. Operates on the already-normalised `PATH`
  // key (callers run normalizeEnvPathKey first).
  const bashSource = opts.bashSource === "host" ? "host" : "bundled";
  const front: string[] = [join(gitDir, "cmd")];
  const usrBin = join(gitDir, "usr", "bin");
  if (bashSource === "bundled") front.push(usrBin);
  if (libDir) front.push(join(gitDir, libDir, "bin"));
  const back: string[] = bashSource === "host" ? [usrBin] : [];

  const ours = new Set([...front, ...back].map(entryKey));
  const rest = (env.PATH ?? "")
    .split(";")
    .filter((e) => e.trim() !== "" && !ours.has(entryKey(e)));

  const place = (dirs: string[]): string[] => {
    const seen = new Set<string>();
    return dirs.filter((dir) => {
      const k = entryKey(dir);
      if (!exists(dir) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const frontOk = place(front);
  const backOk = place(back);

  const DELIM = ";";
  const newPath = [...frontOk, ...rest, ...backOk].join(DELIM);
  let out = env;
  if (newPath !== (env.PATH ?? "")) {
    out = { ...out, PATH: newPath };
  }

  // GIT_EXEC_PATH → <libdir>/libexec/git-core (idempotent: same value).
  if (libDir) {
    const execPath = join(gitDir, libDir, "libexec", "git-core");
    if (exists(execPath) && out.GIT_EXEC_PATH !== execPath) {
      out = { ...out, GIT_EXEC_PATH: execPath };
    }
  }

  // SSL_CERT_FILE → CA bundle, guarded by existence (path varies; only
  // set when actually present so a wrong guess is a no-op).
  if (libDir) {
    const caBundle = join(gitDir, libDir, "ssl", "certs", "ca-bundle.crt");
    if (exists(caBundle) && out.SSL_CERT_FILE !== caBundle) {
      out = { ...out, SSL_CERT_FILE: caBundle };
    }
  }

  return out;
}
