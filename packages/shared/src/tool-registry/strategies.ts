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
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ToolResolver } from "../platform/binary-lookup.js";
import { MANAGED_BIN, MANAGED_DIR } from "../managed-paths.js";
import * as npm from "../platform/npm.js";
import type { Strategy, StrategyResult } from "./types.js";

/** Injectable filesystem + PATH lookup surface (tests pass fakes). */
export interface StrategyDeps {
  exists?(p: string): boolean;
  which?(name: string): string | null;
  npmRootGlobal?(): string;
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
      const candidate = path.join(MANAGED_BIN, binaryName + ext);
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
    run(): StrategyResult {
      const candidate = path.join(MANAGED_DIR, "node_modules", pkgName, entryRelative);
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
 */
export function whereStrategy(binaryName: string, deps?: StrategyDeps): Strategy {
  const { which } = d(deps);
  return {
    name: "where",
    run(): StrategyResult {
      const p = which(binaryName);
      if (p) return { ok: true, path: p };
      return { ok: false, reason: `not found on PATH` };
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
): Strategy {
  // `createRequire` can throw for malformed anchors; guard defensively.
  let resolver: ((id: string) => string) | null = null;
  try {
    resolver = createRequire(anchor).resolve;
  } catch {
    resolver = null;
  }
  return {
    name: "bare-import",
    run(): StrategyResult {
      if (!resolver) return { ok: false, reason: "no module resolver available" };
      try {
        const resolved = resolver(pkgName);
        return { ok: true, path: resolved };
      } catch (err) {
        const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
        return { ok: false, reason: msg };
      }
    },
  };
}
