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
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import { spawnSync } from "../platform/exec.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getManagedBin, getManagedDir } from "../managed-paths.js";
import { isAppImageSelfHit, ToolResolver } from "../platform/binary-lookup.js";
import { resolveBundledGitDir } from "../platform/ensure-bundled-git.js";
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
 * - `execPath` — interpreter path used by `makeNodeScriptToArgv`'s fallback
 *   when `registry.resolve("node")` misses. Default `process.execPath`;
 *   tests inject a fake so executor argv assembly stays deterministic
 *   and never leaks the host's managed node (`~/.pi-dashboard/node`).
 * - `realpath` — JS-entry symlink deref used by `resolveJsScript`.
 *   Default real `realpathSync`; tests inject a fake so a mocked
 *   `BUNDLED_*` path cannot dereference to a real on-disk script
 *   (`/Applications/PI-Dashboard.app/.../npm-cli.js`).
 *   See change: fix-node-electron-resolution-test-isolation.
 */
export interface StrategyDeps {
  exists?(p: string): boolean;
  which?(name: string): string | null;
  npmRootGlobal?(): string;
  resolveModule?(id: string, from: string): string | null;
  execPath?: string;
  realpath?(p: string): string;
  /** Env-var reader for the `env` probe (injectable; default process.env). */
  readEnv?(name: string): string | undefined;
  /** Directory lister for the `pw-browser` probe (injectable for tests). */
  readDir?(p: string): string[];
  /**
   * CJS require for the `static-npm` strategy — returns the package's
   * export VALUE (a binary path string or `{ path }`), injectable so
   * tests never touch the host node_modules. Throws on unresolvable ids.
   */
  requireModule?(id: string): unknown;
  /**
   * Image-availability probe for the `docker-image` strategy. Default
   * shells `docker image inspect <ref>` via spawnSync; never assumes
   * the daemon exists.
   */
  dockerImageInspect?(ref: string): { ok: true } | { ok: false; reason: string };
  /**
   * Home directory for the `pw-browser` default cache path. Default
   * `os.homedir()`; ctx.env.homedir (when the registry provides one)
   * takes precedence.
   */
  homedir?(): string;
}

/**
 * Default module resolver used by `bareImportStrategy`.
 *
 * Order of strategies:
 *   1. `createRequire(from).resolve(id)` — fast CJS resolver; succeeds
 *      for packages that ship either a `"require"` exports condition
 *      or no exports map at all.
 *   2. Filesystem dir-walk: locate `node_modules/<id>/package.json`
 *      starting at `from`, read the manifest, and compute the entry
 *      path from `exports["."]` (`"import"` / `"default"` conditions)
 *      or `"main"`. Mirrors the dir-walk-around-exports-map pattern
 *      already used by `findPackageJsonByDirWalk` in `definitions.ts`.
 *   3. `import.meta.resolve(id)` — an **INERT GUARD**, not an expected
 *      code path. Retained for shape-correctness and defence in depth.
 *
 * ── Why the ESM step is LAST, and why the obvious order is dangerous ──
 *
 * The obvious order puts the ESM resolver at step 2. Do NOT "restore"
 * it. This module is itself loaded through jiti, whose native-ESM
 * fallback evaluates it from a `data:` URL, where
 * `import.meta.resolve(<bare id>)` throws
 * `ERR_UNSUPPORTED_RESOLVE_REQUEST`. **The ESM step has therefore never
 * produced a value in production**, and the dir-walk has silently
 * carried every step-1 miss since both landed together in `43a730368`.
 * Behaviour preservation holds *because step 2 was already dead* — not
 * because the dir-walk is authoritative. Promoting the (now repaired)
 * ESM step ahead of the dir-walk would hand every lookup to a resolver
 * that has never run, and the two demonstrably disagree on package
 * shape: no `exports` but a `module` field → `main` under ESM vs
 * `module` under the dir-walk; `exports["."]` nesting `node`/`default`
 * → the `node` entry vs the `default` entry; `exports` with subpaths
 * but no `"."` → throws under ESM vs resolves via `main` here.
 *
 * In last position the guard is not merely safe, it is **unreachable**
 * for the ids this registry actually uses: `bareImportStrategy` anchors
 * both steps at the same URL (its `anchor` defaults to this module's),
 * and `readEntryFromPackageJson` returns a string for every manifest it
 * can parse, so the dir-walk answers whenever the package is present.
 * Unreachability is CONTINGENT, not structural — it holds only for bare
 * (not subpath) specifiers, with the default `anchor`, a `file:` anchor,
 * and a package that ships a `package.json`. Registering a subpath id or
 * passing a non-default anchor makes the guard live; re-evaluate this
 * comment and the capability spec before doing either.
 *
 * A pre-existing defect this change does NOT fix: the entry falls back
 * to `"index.js"` with no existence check, so the dir-walk can return a
 * path that is not on disk. The inert guard is not its mitigation.
 *
 * Two claims previously asserted here were false and are corrected: the
 * synchronous `import.meta.resolve` **does** accept a parent specifier
 * (Node 20.6+), so declining to pass `from` is a deliberate choice and
 * not an API limit; and there is no `>=22.12` engines floor (the repo
 * root declares `>=22.19.0 <27`; `packages/shared` and
 * `packages/extension` declare none).
 *
 * See change: fix-node-resolution-under-electron (follow-up: live
 * `/api/packages/installed` failure on `@earendil-works/pi-coding-agent`
 * exports-map regression).
 * See change: fix-jiti-cjs-transpile-safety.
 */
function defaultResolveModule(id: string, from: string): string | null {
  // 1. CJS createRequire.
  try {
    return createRequire(from).resolve(id);
  } catch {
    // Fall through.
  }
  // 2. Filesystem dir-walk for exports-map-incomplete packages. This is the
  // step that answers in production today; keeping it here preserves behaviour.
  const byDirWalk = resolvePackageEntryByDirWalk(id, from);
  if (byDirWalk !== null) return byDirWalk;
  // 3. Inert ESM guard. The call MUST stay a direct `import.meta.resolve(id)`:
  // jiti erases `import.meta` only when the member expression's `object.type`
  // is `MetaProperty`, and a TypeScript cast makes it `TSAsExpression`, which
  // defeats the erasure and forces jiti's `data:`-URL ESM fallback — fatal on
  // hosts whose resolver rejects `data:` specifiers (issue #408). No `typeof`
  // probe either: the `catch` below already routes a missing or throwing
  // resolver to the same `null`.
  try {
    const url = import.meta.resolve(id);
    if (typeof url === "string" && url.startsWith("file:")) {
      return fileURLToPath(url);
    }
  } catch {
    // Fall through.
  }
  return null;
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
    execPath: process.execPath,
    realpath: realpathSync,
    readEnv: (name) => process.env[name],
    readDir: (p) => readdirSync(p),
    requireModule: (id) => createRequire(import.meta.url)(id),
    homedir: () => os.homedir(),
    dockerImageInspect: (ref) => {
      const probe = spawnSync("docker", ["image", "inspect", ref], {
        encoding: "utf8",
        timeout: 10_000,
      });
      if (probe.error) {
        // ENOENT → docker CLI not installed; any spawn failure → treat the
        // daemon as unavailable. NEVER assume docker is present.
        const code = (probe.error as NodeJS.ErrnoException).code;
        return { ok: false, reason: `docker not available (${code ?? probe.error.message})` };
      }
      if (probe.status !== 0) {
        return { ok: false, reason: `image ${ref} not found` };
      }
      return { ok: true };
    },
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
    execPath: deps.execPath ?? base.execPath,
    realpath: deps.realpath ?? base.realpath,
    readEnv: deps.readEnv ?? base.readEnv,
    readDir: deps.readDir ?? base.readDir,
    requireModule: deps.requireModule ?? base.requireModule,
    dockerImageInspect: deps.dockerImageInspect ?? base.dockerImageInspect,
    homedir: deps.homedir ?? base.homedir,
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

// ── Probe strategies (see change: add-skill-tool-provisioning) ─────────────

/**
 * Credential-presence probe: is the env var SET? Boolean only — the value
 * is never read into the result, so `Resolution` and every log line stay
 * free of secrets. `path` is `null` when ok (non-path kind).
 *
 * See change: add-skill-tool-provisioning (design D2).
 */
export function envProbeStrategy(envVarName: string, deps?: StrategyDeps): Strategy {
  const { readEnv } = d(deps);
  return {
    name: "env",
    run(): StrategyResult {
      const value = readEnv(envVarName);
      if (value === undefined || value === "") {
        return { ok: false, reason: `env ${envVarName} not set` };
      }
      return { ok: true, path: null };
    },
  };
}

/**
 * Docker-image presence probe. Probes via the injectable
 * `dockerImageInspect` (default: `docker image inspect`) and NEVER
 * assumes the daemon exists — unavailability is just a failed attempt
 * carrying its reason. `path` is the image ref (non-filesystem).
 *
 * See change: add-skill-tool-provisioning (design D2).
 */
export function dockerImageProbeStrategy(imageRef: string, deps?: StrategyDeps): Strategy {
  const { dockerImageInspect } = d(deps);
  return {
    name: "docker-image",
    run(): StrategyResult {
      const probe = dockerImageInspect(imageRef);
      if (!probe.ok) return { ok: false, reason: probe.reason };
      return { ok: true, path: imageRef };
    },
  };
}

/** Per-OS default Playwright browsers cache dir under `homedir`. */
function playwrightCacheDir(platform: NodeJS.Platform, homedir: string): string {
  switch (platform) {
    case "darwin":
      return path.join(homedir, "Library", "Caches", "ms-playwright");
    case "win32":
      return path.join(homedir, "AppData", "Local", "ms-playwright");
    default:
      return path.join(homedir, ".cache", "ms-playwright");
  }
}

/**
 * Playwright-browser presence probe: reads the documented browsers cache
 * (`PLAYWRIGHT_BROWSERS_PATH` or the per-OS default) and matches entries
 * like `chromium-<rev>` / `chromium_headless_shell-<rev>`. `path` is the
 * matched browser directory.
 *
 * See change: add-skill-tool-provisioning (design D2).
 */
export function pwBrowserProbeStrategy(browserName: string, deps?: StrategyDeps): Strategy {
  const { readEnv, readDir, homedir, resolveModule } = d(deps);
  return {
    name: "pw-browser",
    run(ctx): StrategyResult {
      // Production registries construct without env.homedir — fall back to
      // the injected/live homedir so the DEFAULT cache dir is probed.
      const home = ctx.env?.homedir ?? homedir();
      let base: string | undefined;
      const envPath = readEnv("PLAYWRIGHT_BROWSERS_PATH");
      if (envPath && envPath !== "0") {
        base = envPath;
      } else {
        if (envPath === "0") {
          // Playwright sentinel "0": hermetic installs live under
          // playwright-core/.local-browsers, not the user cache.
          try {
            const entry = resolveModule("playwright-core/package.json", import.meta.url);
            if (entry) base = path.join(path.dirname(entry), ".local-browsers");
          } catch {
            // fall through to the default cache dir
          }
        }
        base = base ?? (home ? playwrightCacheDir(ctx.platform, home) : undefined);
      }
      if (!base) {
        return { ok: false, reason: `no browsers cache dir (set PLAYWRIGHT_BROWSERS_PATH)` };
      }
      let entries: string[];
      try {
        entries = readDir(base);
      } catch {
        return { ok: false, reason: `browser ${browserName} not found (no cache dir ${base})` };
      }
      const match = entries.find(
        (e) => e === browserName || e.startsWith(`${browserName}-`) || e.startsWith(`${browserName}_`),
      );
      if (!match) {
        return { ok: false, reason: `browser ${browserName} not found in ${base}` };
      }
      return { ok: true, path: path.join(base, match) };
    },
  };
}

/**
 * Binary path read out of an npm package's export. Media packages ship
 * the binary LOCATION as their export: a bare string (`ffmpeg-static`)
 * or `{ path }` (`@ffprobe-installer/ffprobe`). Distinct from
 * `bare-import`, which returns the package dir / JS entry.
 *
 * See change: add-skill-tool-provisioning (design D3).
 */
export function staticNpmStrategy(pkgName: string, deps?: StrategyDeps): Strategy {
  const { requireModule, exists } = d(deps);
  return {
    name: "static-npm",
    run(): StrategyResult {
      let exported: unknown;
      try {
        exported = requireModule(pkgName);
      } catch (e) {
        return { ok: false, reason: `cannot require ${pkgName}: ${(e as Error).message}` };
      }
      let binaryPath: string | null = null;
      if (typeof exported === "string" && exported.length > 0) {
        binaryPath = exported;
      } else if (
        exported &&
        typeof exported === "object" &&
        typeof (exported as { path?: unknown }).path === "string" &&
        ((exported as { path: string }).path).length > 0
      ) {
        binaryPath = (exported as { path: string }).path;
      } else if (
        exported &&
        typeof exported === "object" &&
        typeof (exported as { default?: unknown }).default === "string" &&
        ((exported as { default: string }).default).length > 0
      ) {
        binaryPath = (exported as { default: string }).default;
      }
      if (!binaryPath) {
        return { ok: false, reason: `${pkgName} exports no binary path` };
      }
      // The EXPORT alone is not proof: e.g. ffmpeg-static's tarball ships
      // no binary until its install script runs (gated by build policy).
      // A dead export path must fall through to the next strategy (where),
      // never shadow a working PATH binary with a nonexistent file.
      if (!exists(binaryPath)) {
        return { ok: false, reason: `${pkgName} exports ${binaryPath} which does not exist on disk` };
      }
      return { ok: true, path: binaryPath };
    },
  };
}
