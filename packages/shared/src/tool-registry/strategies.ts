/**
 * Reusable resolution strategies shared across tool definitions.
 *
 * Strategies are pure functions over their `StrategyCtx` — filesystem
 * access (`existsSync`) is the only side effect. They never spawn; PATH
 * search delegates to `ToolResolver.which()` which is injectable for
 * tests via the `lookup` parameter.
 *
 * See change: consolidate-tool-resolution (design §2).
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ToolResolver, isAppImageSelfHit } from "../platform/binary-lookup.js";
import { resolveBundledGitDir } from "../platform/ensure-bundled-git.js";
import { getManagedBin, getManagedDir } from "../managed-paths.js";
import { getManagedNodeBinDir } from "../platform/managed-node-path.js";
import * as npm from "../platform/npm.js";
import type { Strategy, StrategyCtx, StrategyResult } from "./types.js";

/**
 * Injectable surfaces used by strategies.
 *
 * - `exists` — fs existence probe (memfs in tests).
 * - `which` — PATH search.
 * - `npmRootGlobal` — result of `npm root -g` (tests inject to avoid spawn).
 * - `resolveModule` — node-module resolution (id, from) → absolute path.
 *   Production uses `createRequire(from).resolve(id)`; tests walk fake
 *   node_modules trees.
 */
export interface StrategyDeps {
  exists?(p: string): boolean;
  which?(name: string): string | null;
  npmRootGlobal?(): string;
  resolveModule?(id: string, from: string): string | null;
}

/**
 * Default module resolver used by `bareImportStrategy`.
 *
 * Order of strategies:
 *   1. `createRequire(from).resolve(id)` — fast CJS resolver; succeeds
 *      for packages that ship either a `"require"` exports condition
 *      or no exports map at all.
 *   2. ESM-aware fallback: `import.meta.resolve(id)` honours the
 *      `"import"` condition. Available synchronously and stably on
 *      every supported Node version (engines: >=22.12).
 *      Anchored at this module's URL; the `from` argument is ignored
 *      in this branch because the synchronous `import.meta.resolve`
 *      signature does not take a parent specifier. In practice every
 *      production caller uses the default anchor (this file), so this
 *      is a no-op.
 *   3. Filesystem dir-walk: locate `node_modules/<id>/package.json`
 *      starting at `from`, read the manifest, and compute the entry
 *      path from `exports["."]` (`"import"` / `"default"` conditions)
 *      or `"main"`. Required when the package ships only an `"import"`
 *      condition AND the host Node refuses `import.meta.resolve` for
 *      some other reason (e.g. exports map present but with no `"."`
 *      key). Mirrors the same dir-walk-around-exports-map pattern
 *      already used by `findPackageJsonByDirWalk` in `definitions.ts`.
 *
 * See change: fix-node-resolution-under-electron (follow-up: live
 * `/api/packages/installed` failure on `@earendil-works/pi-coding-agent`
 * exports-map regression).
 */
function defaultResolveModule(id: string, from: string): string | null {
  // 1. CJS createRequire.
  try {
    return createRequire(from).resolve(id);
  } catch {
    // Fall through.
  }
  // 2. ESM import.meta.resolve. Synchronous since Node 20.6 GA; on
  // the dashboard's engines floor (>=22.12) it's always available.
  const metaResolve = (import.meta as unknown as { resolve?: (s: string) => string }).resolve;
  if (typeof metaResolve === "function") {
    try {
      const url = metaResolve(id);
      if (typeof url === "string" && url.startsWith("file:")) {
        return fileURLToPath(url);
      }
    } catch {
      // Fall through.
    }
  }
  // 3. Filesystem dir-walk for exports-map-incomplete packages.
  return resolvePackageEntryByDirWalk(id, from);
}

/**
 * Walk up from `fromUrl`'s directory looking for
 * `node_modules/<pkgName>/package.json`; read it, compute the entry
 * path from exports map or `main`, return the absolute path.
 *
 * Used as a last-resort resolver when both `createRequire().resolve`
 * and `import.meta.resolve` fail. Self-contained — does not import
 * helpers from `definitions.ts` to avoid a circular dependency.
 */
function resolvePackageEntryByDirWalk(
  pkgName: string,
  fromUrl: string,
): string | null {
  let startDir: string;
  try {
    startDir = path.dirname(fileURLToPath(fromUrl));
  } catch {
    return null;
  }
  let dir = startDir;
  for (let i = 0; i < 64; i += 1) {
    const pkgJson = path.join(dir, "node_modules", pkgName, "package.json");
    if (existsSync(pkgJson)) {
      const entry = readEntryFromPackageJson(pkgJson);
      return entry;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Read `package.json`, derive the `"."`/main entry honouring the
 * `"import"` and `"default"` conditions of an exports map. Returns
 * absolute path; null when the manifest is unparseable or no entry
 * field exists.
 */
function readEntryFromPackageJson(pkgJsonPath: string): string | null {
  try {
    const json = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
      exports?: unknown;
      main?: string;
      module?: string;
    };
    const pkgDir = path.dirname(pkgJsonPath);
    const fromExports = pickExportsDot(json.exports);
    const rel = fromExports ?? json.module ?? json.main ?? "index.js";
    if (typeof rel !== "string") return null;
    return path.join(pkgDir, rel);
  } catch {
    return null;
  }
}

/** Walk an exports map looking for the `"."` entry's import/default file. */
function pickExportsDot(exp: unknown): string | null {
  if (!exp) return null;
  if (typeof exp === "string") return exp;
  if (typeof exp !== "object") return null;
  const obj = exp as Record<string, unknown>;
  const dot = "." in obj ? obj["."] : obj;
  return pickConditional(dot);
}

function pickConditional(node: unknown): string | null {
  if (!node) return null;
  if (typeof node === "string") return node;
  if (typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  // Conditions tried in order: import (ESM), default, node, require.
  // Skip `types` (TS-only) and any other condition until exhausted.
  for (const cond of ["import", "default", "node", "require"]) {
    if (cond in obj) {
      const recursed = pickConditional(obj[cond]);
      if (recursed) return recursed;
    }
  }
  return null;
}

function defaults(): Required<StrategyDeps> {
  const resolver = new ToolResolver({
    processExecPath: process.execPath,
    useLoginShell: true,
  });
  return {
    exists: existsSync,
    which: (name) => resolver.which(name),
    npmRootGlobal: () => npm.rootGlobalOr(""),
    resolveModule: defaultResolveModule,
  };
}

/** Merge caller-supplied deps over the live defaults. */
function d(deps?: StrategyDeps): Required<StrategyDeps> {
  const base = defaults();
  if (!deps) return base;
  return {
    exists: deps.exists ?? base.exists,
    which: deps.which ?? base.which,
    npmRootGlobal: deps.npmRootGlobal ?? base.npmRootGlobal,
    resolveModule: deps.resolveModule ?? base.resolveModule,
  };
}

// ── Strategies ──────────────────────────────────────────────────────────────

/**
 * Look up a registered path override by tool name. Existence is checked
 * here so invalid overrides fall through with reason `invalid: <...>`
 * without requiring callers to wire a separate validator.
 */
export function overrideStrategy(toolName: string, deps?: StrategyDeps): Strategy {
  const { exists } = d(deps);
  return {
    name: "override",
    run(ctx): StrategyResult {
      const p = ctx.overrides[toolName];
      if (!p) return { ok: false, reason: "no override set" };
      if (!exists(p)) return { ok: false, reason: `invalid: path does not exist: ${p}` };
      return { ok: true, path: p };
    },
  };
}

/**
 * Managed Node runtime: `<managedDir>/node/{node.exe,npm.cmd,npx.cmd}`
 * on Windows or `<managedDir>/node/bin/{node,npm,npx}` on Unix.
 *
 * Lets `ToolRegistry.resolve("node")` and `resolve("npm")` prefer the
 * persistent runtime under `~/.pi-dashboard/node/` (installed by
 * `installManagedNode`) over the system PATH lookup, while still
 * deferring to `tool-overrides.json`.
 *
 * Returns `null` when the managed Node runtime is not present, so the
 * standalone-CLI / no-Electron-resources case falls through cleanly to
 * the existing `where`/PATH strategy.
 *
 * See change: embed-managed-node-runtime (spec: managed-node-runtime,
 * Requirement: ToolRegistry resolves managed runtime first).
 */
export function managedRuntimeStrategy(
  toolName: "node" | "npm" | "npx",
  deps?: StrategyDeps,
): Strategy {
  const { exists } = d(deps);
  return {
    name: "managed",
    run(ctx): StrategyResult {
      const dir = getManagedNodeBinDir(ctx.env, ctx.platform);
      const isWin = ctx.platform === "win32";
      const fileName =
        toolName === "node"
          ? isWin
            ? "node.exe"
            : "node"
          : isWin
            ? `${toolName}.cmd`
            : toolName;
      const candidate = path.join(dir, fileName);
      if (exists(candidate)) return { ok: true, path: candidate };
      return { ok: false, reason: `missing: ${candidate}` };
    },
  };
}

/**
 * Electron-bundled Node runtime:
 *   Unix:    `<resourcesPath>/node/bin/{node,npm,npx}`
 *   Windows: `<resourcesPath>/node/node.exe`
 *            `<resourcesPath>/node/{npm,npx}.cmd`
 *
 * The Electron installer ships a real Node tarball under
 * `Resources/node/` (see `packages/electron/forge.config.ts` extraResource).
 * The `pickNodeForServer` helper already special-cases that path for the
 * server-spawn bootstrap; this strategy makes the same artifact visible
 * to the tool registry so `registry.resolve("node" | "npm" | "npx")`
 * returns the bundled binary on a packaged Electron install.
 *
 * Reads `resourcesPath` from `ctx.env.resourcesPath`. Returns
 * `{ ok: false, reason: "no resourcesPath" }` when unset (standalone
 * CLI / non-Electron host) so the next strategy in the chain runs.
 *
 * Strategy name: `"bundled-node"` — `classify()` maps this to
 * `Source = "bundled"`.
 *
 * See change: fix-node-resolution-under-electron.
 */
export function bundledNodeStrategy(
  toolName: "node" | "npm" | "npx",
  deps?: StrategyDeps,
): Strategy {
  const { exists } = d(deps);
  return {
    name: "bundled-node",
    run(ctx): StrategyResult {
      const resourcesPath = ctx.env?.resourcesPath;
      if (!resourcesPath) return { ok: false, reason: "no resourcesPath" };
      const isWin = ctx.platform === "win32";
      const root = path.join(resourcesPath, "node");
      let candidate: string;
      if (isWin) {
        // Windows: node.exe lives at root; npm/npx are .cmd shims at root.
        candidate =
          toolName === "node"
            ? path.join(root, "node.exe")
            : path.join(root, `${toolName}.cmd`);
      } else {
        // Unix: everything lives under bin/.
        candidate = path.join(root, "bin", toolName);
      }
      if (exists(candidate)) return { ok: true, path: candidate };
      return { ok: false, reason: `missing: ${candidate}` };
    },
  };
}

/**
 * Windows-only: resolve `bash` to the bundled dugite-native shell at
 * `<resourcesPath>/git/usr/bin/sh.exe`. dugite-native ships GNU bash under
 * the name `sh` (no `bash.exe`), so `where bash` misses even though the
 * shell is on PATH. This strategy surfaces it as a `bundled` hit so the
 * Tools panel shows bash ✓ instead of "not found".
 *
 * Fast-fails on non-win32 → chain falls through to `where` (finds
 * /bin/bash on Unix). Uses {@link resolveBundledGitDir} (cmd/git.exe
 * marker) for the bundle root.
 *
 * See change: resolve-bundled-bash-on-windows.
 */
export function bundledGitBashStrategy(deps?: StrategyDeps): Strategy {
  const { exists } = d(deps);
  return {
    name: "bundled-git-bash",
    run(ctx): StrategyResult {
      if (ctx.platform !== "win32") return { ok: false, reason: "not win32" };
      const gitDir = resolveBundledGitDir({
        platform: ctx.platform,
        resourcesPath: ctx.env?.resourcesPath,
        exists,
      });
      if (!gitDir) return { ok: false, reason: "no bundled git tree" };
      const sh = path.win32.join(gitDir, "usr", "bin", "sh.exe");
      if (exists(sh)) return { ok: true, path: sh };
      return { ok: false, reason: `missing: ${sh}` };
    },
  };
}

/**
 * Managed install: `~/.pi-dashboard/node_modules/.bin/<name>(.cmd)` for
 * binaries, or any explicit relative path under `MANAGED_DIR` for
 * modules/directories.
 */
export function managedBinStrategy(
  binaryName: string,
  deps?: StrategyDeps,
): Strategy {
  const { exists } = d(deps);
  return {
    name: "managed",
    run(ctx): StrategyResult {
      const ext = ctx.platform === "win32" ? ".cmd" : "";
      const candidate = path.join(getManagedBin(ctx.env), binaryName + ext);
      if (exists(candidate)) return { ok: true, path: candidate };
      return { ok: false, reason: `missing: ${candidate}` };
    },
  };
}

/**
 * Managed module entry: `~/.pi-dashboard/node_modules/<pkg>/dist/index.js`
 * (or a caller-specified relative entry).
 */
export function managedModuleStrategy(
  pkgName: string,
  entryRelative: string = path.join("dist", "index.js"),
  deps?: StrategyDeps,
): Strategy {
  const { exists } = d(deps);
  return {
    name: "managed",
    run(ctx: StrategyCtx): StrategyResult {
      const candidate = path.join(getManagedDir(ctx.env), "node_modules", pkgName, entryRelative);
      if (exists(candidate)) return { ok: true, path: candidate };
      return { ok: false, reason: `missing: ${candidate}` };
    },
  };
}

/**
 * Global npm install: `<npm root -g>/<pkg>/<entry>`. Falls back to
 * `{ ok: false }` when `npm root -g` fails or the file is absent.
 */
export function npmGlobalStrategy(
  pkgName: string,
  entryRelative: string = path.join("dist", "index.js"),
  deps?: StrategyDeps,
): Strategy {
  const { exists, npmRootGlobal } = d(deps);
  return {
    name: "npm-global",
    run(): StrategyResult {
      const root = npmRootGlobal();
      if (!root) return { ok: false, reason: "npm root -g failed" };
      const candidate = path.join(root, pkgName, entryRelative);
      if (exists(candidate)) return { ok: true, path: candidate };
      return { ok: false, reason: `missing: ${candidate}` };
    },
  };
}

/**
 * PATH search via `ToolResolver.which()`. This is the plain-old "is it
 * on PATH" strategy and should appear last in most chains.
 *
 * Filters AppImage self-hits via `isAppImageSelfHit` — when the host
 * runs as a Linux AppImage with `executableName: "pi-dashboard"`, the
 * AppImage runtime prepends its squashfs mount to PATH, so the first
 * `which pi-dashboard` hit can be the Electron launcher itself.
 * Trusting that result spawns the Electron app recursively as if it
 * were the dashboard CLI, which never opens the dashboard port and
 * causes the loading screen to hang. Every tool registered via
 * `whereStrategy` inherits this guard transparently.
 *
 * See change: fix-electron-appimage-cli-self-detection (D2).
 */
export function whereStrategy(binaryName: string, deps?: StrategyDeps): Strategy {
  const { which } = d(deps);
  return {
    name: "where",
    run(): StrategyResult {
      const p = which(binaryName);
      if (!p) return { ok: false, reason: `not found on PATH` };
      if (isAppImageSelfHit(p)) {
        return { ok: false, reason: `appimage-self-hit: ${p}` };
      }
      return { ok: true, path: p };
    },
  };
}

/**
 * Bare `import("<pkg>")` — succeeds when the package is reachable from
 * the caller's node_modules tree. We probe synchronously via
 * `createRequire(import.meta.url).resolve(pkgName)`, which follows the
 * same module-resolution algorithm as `import()` but returns a path.
 *
 * The returned path is the resolved entry file; `resolveModule()` then
 * dynamically imports it via `pathToFileURL`. This keeps strategies
 * uniformly sync and keeps the diagnostic trail honest (if the package
 * isn't resolvable, we record the reason here instead of letting it
 * surface as an opaque `import()` throw later).
 *
 * `anchor` determines which node_modules tree we search. Default is
 * this file's URL (i.e. the shared package) — which is typically what
 * callers want: "is pi a dependency of the dashboard?"
 */
export function bareImportStrategy(
  pkgName: string,
  anchor: string = import.meta.url,
  deps?: StrategyDeps,
): Strategy {
  const { resolveModule } = d(deps);
  return {
    name: "bare-import",
    run(): StrategyResult {
      const resolved = resolveModule(pkgName, anchor);
      if (!resolved) return { ok: false, reason: `cannot resolve ${pkgName} from ${anchor}` };
      return { ok: true, path: resolved };
    },
  };
}
