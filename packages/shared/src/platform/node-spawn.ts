/**
 * Canonical helper for spawning `node --import <loader> <entry>` argv.
 *
 * Node ≥ 20's ESM loader parses BOTH the `--import` loader position AND
 * the entry-script position as URLs. Raw Windows paths like
 * `B:\Dev\foo.ts` URL-parse to scheme `b:`, which is not in the ESM
 * loader's allowlist (file, data, node) → the process crashes with
 * `ERR_UNSUPPORTED_ESM_URL_SCHEME` before any filesystem access.
 *
 * Node's internal drive-letter heuristic catches the common cases
 * (`C:\`, `D:\`) but has known gaps for `A:`, `B:`, and other letters.
 * Rather than relying on the heuristic, we wrap the loader position
 * with `file://` unconditionally.
 *
 * The entry-script position needs a more nuanced rule. Node's default
 * resolver AND jiti's ESM hook both accept `file://` URL entries. But
 * **tsx's ESM hook rejects `file://` URLs as entries** — tsx's resolver
 * treats the entry as a user-typed specifier and attempts bare-import
 * / relative-path resolution, producing `<cwd>/file:/...` errors.
 * Since tsx is used as the jiti fallback on dev machines without pi
 * installed (the most common Linux dev path), we must NOT URL-wrap
 * the entry when the loader is tsx. Detection: the loader path
 * contains `/tsx/` (every tsx install ships its hook under a `tsx/`
 * directory; jiti's hook is under `jiti/`).
 *
 * This module is the canonical chokepoint. The repo-level lint test
 * `no-raw-node-import.test.ts` refuses any other call site that
 * passes a raw path to `--import` / `--loader`.
 *
 * See change: fix-windows-entry-script-url.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SpawnOptions, ChildProcess } from "node:child_process"; // ban:child_process-ok — types only
import { spawn as execSpawn } from "./exec.js";

export interface SpawnNodeScriptOptions {
  /** Path to node.exe / node (raw OS path — binary, not ESM-loaded). */
  nodeBin?: string;

  /** Path to the script Node will run. Raw path OR file:// URL. */
  entry: string;

  /** Optional ESM loader for --import. Raw path OR file:// URL. */
  loader?: string;

  /** Arguments passed to the script (after entry). */
  args?: string[];

  /** Standard spawn options (cwd, env, stdio, detached, etc.). */
  spawnOptions?: SpawnOptions;
}

/**
 * Detect whether a loader (file:// URL or raw path) is tsx.
 *
 * tsx's ESM hook rejects `file://` URLs at the entry-script position,
 * so the caller must pass a raw OS path for the entry when this
 * returns true. jiti and Node's default resolver both accept URL
 * entries.
 *
 * Heuristic: every tsx install places its hook under a `tsx/` package
 * directory (e.g. `.../node_modules/tsx/dist/esm/index.mjs`). The
 * check is tolerant of `file://` URLs, raw POSIX paths, and raw
 * Windows paths with either slash direction.
 */
export function isTsxLoader(loader: string | null | undefined): boolean {
  if (!loader) return false;
  // Normalize backslashes so the `/tsx/` probe works on Windows paths.
  const normalized = loader.replace(/\\/g, "/");
  return /\/tsx\//i.test(normalized);
}

/**
 * Convert a path-or-url string to a file:// URL.
 *
 * Pure and idempotent. Safe to call on strings that are already
 * file:// URLs — returns them unchanged.
 *
 * Handles Windows-style input (drive letter + backslash) regardless of
 * host OS, so unit tests on Linux/macOS can exercise the Windows path
 * contract. Mirrors the pattern in
 * `packages/shared/src/resolve-jiti.ts::buildJitiRegisterUrl`.
 */
export function toFileUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("file:")) return pathOrUrl;

  const isWindowsStyle = /^[A-Za-z]:[\\/]/.test(pathOrUrl);
  if (isWindowsStyle) {
    // pathToFileURL on POSIX hosts URL-encodes backslashes rather than
    // treating them as separators. Build the URL manually so tests on
    // Linux produce the same result a Windows host would.
    return `file:///${pathOrUrl.replace(/\\/g, "/")}`;
  }

  // Use path.resolve to ensure absolute path on the host OS, then
  // let Node's pathToFileURL handle any host-specific quirks.
  const absolute = path.isAbsolute(pathOrUrl) ? pathOrUrl : path.resolve(pathOrUrl);
  return pathToFileURL(absolute).href;
}

/**
 * Decide whether the entry-script position needs `file://` URL wrapping.
 *
 * Rule:
 *   - tsx loader: always raw path (tsx rejects file:// entries on every OS)
 *   - non-tsx (jiti / Node default) on POSIX: raw path
 *     (POSIX has no drive-letter / URL-scheme collision; jiti's resolver
 *      actively MISBEHAVES when handed `file://` URL entries — it
 *      normalises away the triple-slash and then treats `file:/...` as
 *      a relative specifier, producing `<cwd>/file:/...` ENOENT errors.)
 *   - non-tsx on Windows: file:// URL
 *     (Node parses drive letters like `B:` / `A:` as URL schemes in argv
 *      before loaders run, throwing ERR_UNSUPPORTED_ESM_URL_SCHEME.
 *      Wrapping with `file://` sidesteps the parse.)
 *
 * Keeps a `platform` parameter for testability so unit tests on a POSIX
 * host can exercise the Windows branch without mutating `process.platform`.
 *
 * !! JITI VERSION CONTRACT !!
 * The Windows-non-tsx arm assumes the jiti loader is from
 * `@mariozechner/pi-coding-agent@0.70.x` (jiti 2.x with the `file:///`
 * triple-slash URL handling fix). jiti 2.x correctly handles `file:///`
 * URL entries on Windows — it was the version we carved this contract
 * around in change `fix-windows-entry-script-url`.
 *
 * Newer jiti versions (e.g. jiti 2.6.5 in `pi-coding-agent@0.71.x`)
 * MISBEHAVE on `file:///` entries: they normalize triple-slash to
 * single-slash and prepend cwd as if the entry were a relative
 * specifier, producing `<cwd>/file:/...` ENOENT errors.
 *
 * The Electron Windows codepath defends against this version drift by
 * resolving jiti from the managed dir's `pi-coding-agent@0.70.0` (the
 * version pinned in `packages/electron/offline-packages.json` and
 * extracted into `~/.pi-dashboard/` by `installStandalone()` on first
 * launch — see Defect 1 of change
 * `fix-electron-windows-installer-and-server-bootstrap`). Since the
 * managed-dir tree is pinned, the contract holds regardless of what
 * jiti is on the user's PATH.
 *
 * If a future change bumps the offline-cacache `pi-coding-agent` pin to
 * a version with a different jiti, RE-VERIFY this contract on Windows
 * manually (run a packaged Electron app on Win10 + Win11) and either:
 *   1. Update the contract (fix the file:// URL handling expectation), OR
 *   2. Add a per-jiti-version branch here, OR
 *   3. Switch the bundled loader to tsx (which has its own contract).
 *
 * Locked by `node-spawn-jiti-contract.test.ts`.
 */
export function shouldUrlWrapEntry(
  loader: string | null | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (isTsxLoader(loader)) return false;
  return platform === "win32";
}

/**
 * Spawn `node` with an optional `--import` loader and a script entry.
 *
 * The loader position is always URL-wrapped (Node's ESM loader
 * requires `file://` on Windows drive letters outside the heuristic).
 *
 * The entry position follows `shouldUrlWrapEntry(loader, platform)` —
 * URL on Windows + non-tsx, raw everywhere else.
 *
 * Delegates actual spawning to `platform/exec.ts::spawn` so the
 * `windowsHide: true` default and other safe-spawn invariants are
 * preserved. Does not import `node:child_process` directly (the type
 * imports above are annotated with the opt-out marker).
 */
export function spawnNodeScript(opts: SpawnNodeScriptOptions): ChildProcess {
  const nodeBin = opts.nodeBin ?? process.execPath;
  const wrapEntry = shouldUrlWrapEntry(opts.loader);

  const argv: string[] = [];
  if (opts.loader) {
    argv.push("--import", toFileUrl(opts.loader));
  }
  argv.push(wrapEntry ? toFileUrl(opts.entry) : opts.entry);
  if (opts.args) argv.push(...opts.args);

  return execSpawn(nodeBin, argv, opts.spawnOptions ?? {});
}
