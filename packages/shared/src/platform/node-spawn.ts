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
 * Detect whether a loader (file:// URL or raw path) is jiti.
 *
 * Mirrors `isTsxLoader`. jiti's hook ships under `jiti/lib/`. Used so
 * `shouldUrlWrapEntry` can refuse to URL-wrap the entry when jiti is
 * the loader on Windows — see the JITI VERSION CONTRACT below.
 */
export function isJitiLoader(loader: string | null | undefined): boolean {
  if (!loader) return false;
  const normalized = loader.replace(/\\/g, "/");
  return /\/jiti\//i.test(normalized);
}

/**
 * Decide whether the entry-script position needs `file://` URL wrapping.
 *
 * Rule:
 *   - tsx loader: always raw path (tsx rejects file:// entries on every OS)
 *   - jiti loader: always raw path (jiti misnormalises file:// URL
 *     entries on Windows — see the JITI VERSION CONTRACT below)
 *   - any loader on POSIX: raw path (no drive-letter / URL-scheme collision)
 *   - other / default Node resolver on Windows: file:// URL
 *     (Node parses drive letters like `B:` / `A:` as URL schemes in argv
 *      before loaders run, throwing ERR_UNSUPPORTED_ESM_URL_SCHEME.
 *      Wrapping with `file://` sidesteps the parse. The drive-letter
 *      heuristic in Node catches `C:\…` / `D:\…` etc., which is what
 *      jiti relies on for the standalone install layout.)
 *
 * Keeps a `platform` parameter for testability so unit tests on a POSIX
 * host can exercise the Windows branch without mutating `process.platform`.
 *
 * !! JITI VERSION CONTRACT !!
 * jiti — at every version verified on Windows so far, including the
 * current pin `jiti@^2.7.0` shipped under
 * `@earendil-works/pi-coding-agent@0.74.x` — MISHANDLES `file:///`
 * triple-slash URL entries on Windows. Symptom: the entry is rewritten
 * to single-slash `file:/C:/…` and then re-resolved relative to cwd,
 * yielding `Cannot find module 'file:///<cwd>/file:/C:/…/cli.ts'`.
 *
 * This was verified live in a Windows 11 standalone install
 * (Node 22.18.0 + jiti 2.7.0) and is the reason the Windows branch of
 * this function now returns `false` for jiti loaders. Node's own
 * drive-letter heuristic accepts raw `C:\…` argv entries, so the URL
 * wrap is unnecessary for the common standalone-install layout where
 * pi + the dashboard live under `C:\Users\<u>\.pi-dashboard\…`.
 *
 * Earlier baselines (`@mariozechner/pi-coding-agent@0.70.x`,
 * `jiti@2.6.5` in `pi-coding-agent@0.71.x`) exhibited the same or
 * worse breakage; we no longer attempt to special-case any single
 * jiti version. If a future jiti release fixes file:/// handling and
 * we want to URL-wrap again (e.g. to cover `B:` / `A:` drives outside
 * Node's heuristic), narrow the rule here and add a per-version
 * branch — re-verify on real Windows before changing.
 *
 * Locked by `node-spawn-jiti-contract.test.ts`.
 */
export function shouldUrlWrapEntry(
  loader: string | null | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (isTsxLoader(loader)) return false;
  if (isJitiLoader(loader)) return false;
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
/**
 * Pure helper: build the bare argv chunk for `node --import <loader>
 * <entry> [...args]` with correct URL-wrapping at both positions.
 *
 * Single source of truth for the `--import` argv shape — used by
 * `spawnNodeScript` (runtime spawn) and by
 * `packages/server/src/restart-helper.ts buildOrchestratorScript`
 * (which embeds the argv into a `node -e` orchestrator script that
 * executes in a fresh process and therefore cannot call
 * `spawnNodeScript` directly).
 *
 * No I/O. The `platform` parameter is passed through to
 * `shouldUrlWrapEntry` for testability.
 *
 * Loader is always URL-wrapped. Entry is URL-wrapped per
 * `shouldUrlWrapEntry(loader, platform)`.
 */
export function buildNodeImportArgvParts(opts: {
  loader: string;
  entry: string;
  args?: readonly string[];
  platform?: NodeJS.Platform;
}): string[] {
  const wrapEntry = shouldUrlWrapEntry(opts.loader, opts.platform);
  const parts: string[] = [
    "--import", toFileUrl(opts.loader),
    wrapEntry ? toFileUrl(opts.entry) : opts.entry,
  ];
  if (opts.args && opts.args.length > 0) parts.push(...opts.args);
  return parts;
}

export function spawnNodeScript(opts: SpawnNodeScriptOptions): ChildProcess {
  const nodeBin = opts.nodeBin ?? process.execPath;

  let argv: string[];
  if (opts.loader) {
    argv = buildNodeImportArgvParts({
      loader: opts.loader,
      entry: opts.entry,
      args: opts.args,
    });
  } else {
    const wrapEntry = shouldUrlWrapEntry(opts.loader);
    argv = [wrapEntry ? toFileUrl(opts.entry) : opts.entry];
    if (opts.args) argv.push(...opts.args);
  }

  return execSpawn(nodeBin, argv, opts.spawnOptions ?? {});
}
