/**
 * Registered tool definitions.
 *
 * Each definition declares an ordered strategy chain. Individual
 * strategies are responsible for validating their own resolved paths
 * (they use the injected `exists` from StrategyDeps), so tests can
 * inject fakes without triggering real `fs.existsSync` lookups.
 *
 * See change: consolidate-tool-resolution.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { ToolDefinition, Source } from "./types.js";
import type { ToolRegistry } from "./registry.js";
import {
  type StrategyDeps,
  bareImportStrategy,
  managedBinStrategy,
  managedModuleStrategy,
  npmGlobalStrategy,
  overrideStrategy,
  whereStrategy,
} from "./strategies.js";
import type { Strategy } from "./types.js";

// ── Classifier ──────────────────────────────────────────────────────────────

/** Classifier: strategies → Source. Shared across binary and module tools. */
function classify(strategyName: string): Source {
  if (strategyName === "override") return "override";
  if (strategyName === "managed") return "managed";
  if (strategyName === "npm-global") return "npm-global";
  if (strategyName === "bare-import") return "bare-import";
  // `where` and anything else — resolved via PATH — classifies as system.
  return "system";
}

// ── Binary definitions ──────────────────────────────────────────────────────

function binaryDef(binaryName: string, deps?: StrategyDeps): ToolDefinition {
  return {
    name: binaryName,
    kind: "binary",
    strategies: [
      overrideStrategy(binaryName, deps),
      managedBinStrategy(binaryName, deps),
      whereStrategy(binaryName, deps),
    ],
    classify,
  };
}

// ── Module definitions ──────────────────────────────────────────────────────

/** Sibling probe for an aliased package name (pi: `@mariozechner/*` + `@oh-my-pi/*`). */
function moduleDefWithAliases(
  canonicalName: string,
  pkgNames: readonly string[],
  entry: string,
  deps?: StrategyDeps,
): ToolDefinition {
  const strategies = [overrideStrategy(canonicalName, deps)];
  for (const pkg of pkgNames) strategies.push(bareImportStrategy(pkg));
  for (const pkg of pkgNames) strategies.push(managedModuleStrategy(pkg, entry, deps));
  for (const pkg of pkgNames) strategies.push(npmGlobalStrategy(pkg, entry, deps));
  return { name: canonicalName, kind: "module", strategies, classify };
}

// ── Build-time module definitions (electron, node-pty) ────────────────────

/**
 * Bare-import strategy that resolves `<pkg>/package.json` and returns the
 * containing directory. Used for build-time tools whose useful artifact is
 * a sibling file of `package.json` (e.g. `electron/install.js`,
 * `node-pty/prebuilds/`). Mirrors the semantics that build-time consumers
 * (`publish.yml`, `Dockerfile.build`, `scripts/fix-pty-permissions.cjs`)
 * need — see change: register-build-time-tools.
 *
 * `searchPaths` are passed to Node's resolver as the `paths` option,
 * making the lookup work whether the package is hoisted to the repo root
 * or nested under a workspace.
 */
function bareImportPackageDirStrategy(
  pkgName: string,
  searchPaths?: readonly string[],
  deps?: StrategyDeps,
): Strategy {
  const fallbackResolve = (id: string, from: string): string | null => {
    try {
      if (searchPaths && searchPaths.length > 0) {
        const req = createRequire(from) as unknown as {
          resolve(id: string, opts?: { paths?: readonly string[] }): string;
        };
        return req.resolve(id, { paths: searchPaths });
      }
      return createRequire(from).resolve(id);
    } catch {
      return null;
    }
  };
  const resolveModule = deps?.resolveModule ?? fallbackResolve;
  return {
    name: "bare-import",
    run() {
      const pkgJson = resolveModule(`${pkgName}/package.json`, import.meta.url);
      if (!pkgJson) {
        return { ok: false, reason: `cannot resolve ${pkgName}/package.json` };
      }
      return { ok: true, path: path.dirname(pkgJson) };
    },
  };
}

/** Module def that returns the package directory (containing package.json). */
function packageDirModuleDef(
  toolName: string,
  pkgName: string,
  options: { searchPaths?: readonly string[]; includeManaged?: boolean },
  deps?: StrategyDeps,
): ToolDefinition {
  const strategies: Strategy[] = [
    overrideStrategy(toolName, deps),
    bareImportPackageDirStrategy(pkgName, options.searchPaths, deps),
  ];
  if (options.includeManaged) {
    strategies.push(managedModuleStrategy(pkgName, "package.json", deps));
  }
  return { name: toolName, kind: "module", strategies, classify };
}

// ── Registration ─────────────────────────────────────────────────

// Tools intentionally NOT registered:
//   - `tsx` — a TypeScript *loader* used via `node --import tsx`,
//     not a tool the dashboard spawns. When pi is installed, pi ships
//     jiti which the server prefers; otherwise tsx is co-installed
//     as a dev dep of the server package.
//   - `pi-dashboard` — that's the package this code is part of.
//     "Is it installed" is a bootstrap concern handled directly in
//     `packages/electron/src/lib/dependency-detector.ts`.
//
// Build-time tools (see change: register-build-time-tools):
//   - `electron`   — module, returns the package directory containing
//                    `install.js`. Resolved with paths anchored at
//                    `packages/electron` to handle hoisted vs. nested
//                    layouts uniformly.
//   - `node-pty`   — module, returns the package directory containing
//                    `prebuilds/`. Standard module resolution suffices.
// See change: consolidate-tool-resolution (follow-up).

/**
 * Shared `toArgv` for Node-script executors (pi, openspec, npm).
 *
 * On Windows + `.js` resolved path → prepend node.exe to bypass the
 * `.cmd` shim entirely (no cmd.exe in the spawn chain → no console
 * flash). Elsewhere → direct invocation.
 *
 * This is the heart of the "no cmd flash" story: every CLI that ships
 * as `.cmd` on Windows and is actually a Node script should be
 * registered with this `toArgv` so the spawn becomes
 * `node.exe <script.js>` (pure console-subsystem inherit, no new
 * window ever).
 */
const nodeScriptToArgv: ToolDefinition["toArgv"] = (resolvedPath, { platform, registry }) => {
  if (platform === "win32" && /\.js$/i.test(resolvedPath)) {
    const node = registry.resolve("node");
    if (node.ok && node.path) return [node.path, resolvedPath];
  }
  return [resolvedPath];
};

/**
 * Executor definition for `pi` — ONE tool, OS dispatch inside.
 *
 * On Windows, the strategy chain finds pi-coding-agent's `dist/cli.js`
 * (managed → bare-import → npm-global), and `toArgv` wraps it with
 * `node.exe` to produce `[node.exe, cli.js]`. Falls back to `pi.cmd`
 * on PATH when the cli.js is nowhere to be found.
 *
 * On Unix, the chain finds `pi` on PATH; argv = [pi].
 */
function piExecutorDef(deps?: StrategyDeps): ToolDefinition {
  const piPkgAliases = ["@mariozechner/pi-coding-agent", "@oh-my-pi/pi-coding-agent"];
  const cliEntry = path.join("dist", "cli.js");

  const winStrategies = [
    overrideStrategy("pi", deps),
    ...piPkgAliases.map((pkg) => bareImportCliStrategy(pkg, cliEntry, deps)),
    ...piPkgAliases.map((pkg) => managedModuleStrategy(pkg, cliEntry, deps)),
    ...piPkgAliases.map((pkg) => npmGlobalStrategy(pkg, cliEntry, deps)),
    managedBinStrategy("pi", deps),
    whereStrategy("pi", deps),
  ];

  const unixStrategies = [
    overrideStrategy("pi", deps),
    managedBinStrategy("pi", deps),
    whereStrategy("pi", deps),
  ];

  return {
    name: "pi",
    kind: "executor",
    strategies: unixStrategies,
    platformStrategies: { win32: winStrategies },
    toArgv: nodeScriptToArgv,
    classify,
  };
}

/**
 * Executor definition for `openspec`.
 *
 * On Windows: finds `@fission-ai/openspec/bin/openspec.js` via managed
 * → bare-import → npm-global. `toArgv` wraps with node.exe.
 * On Unix: finds `openspec` binary on PATH.
 */
function openspecExecutorDef(deps?: StrategyDeps): ToolDefinition {
  const pkgName = "@fission-ai/openspec";
  const cliEntry = path.join("bin", "openspec.js");

  const winStrategies = [
    overrideStrategy("openspec", deps),
    bareImportCliStrategy(pkgName, cliEntry),
    managedModuleStrategy(pkgName, cliEntry, deps),
    npmGlobalStrategy(pkgName, cliEntry, deps),
    managedBinStrategy("openspec", deps),
    whereStrategy("openspec", deps),
  ];

  const unixStrategies = [
    overrideStrategy("openspec", deps),
    managedBinStrategy("openspec", deps),
    whereStrategy("openspec", deps),
  ];

  return {
    name: "openspec",
    kind: "executor",
    strategies: unixStrategies,
    platformStrategies: { win32: winStrategies },
    toArgv: nodeScriptToArgv,
    classify,
  };
}

/**
 * Executor definition for `npm`.
 *
 * npm is bundled with Node itself, not a standalone npm install. On
 * Windows: find `<node-dir>/node_modules/npm/bin/npm-cli.js` by
 * looking beside the resolved `node.exe`. Fallback: PATH lookup
 * (which returns npm.cmd).
 * On Unix: find `npm` on PATH.
 *
 * Motivation: npm.cmd internally runs `node.exe npm-cli.js`, and the
 * inner node.exe can allocate a new console (Node issue #21825). By
 * resolving to npm-cli.js directly + spawning via node.exe ourselves,
 * we bypass cmd.exe + npm.cmd entirely.
 */
function npmExecutorDef(deps?: StrategyDeps): ToolDefinition {
  const npmRelativeToNode = path.join("node_modules", "npm", "bin", "npm-cli.js");

  // Custom strategy: find npm-cli.js beside the resolved node.exe.
  // We can't pre-compute the node path at definition time (the registry
  // isn't fully constructed yet), so the strategy resolves node
  // lazily at run time via the global registry hook.
  const npmCliBesideNodeStrategy = {
    name: "managed", // classified as managed because it ships with node
    run(): { ok: true; path: string } | { ok: false; reason: string } {
      // Find node.exe from process.execPath or environment.
      const nodeExe = process.execPath;
      if (!nodeExe) return { ok: false, reason: "process.execPath unset" };
      const nodeDir = path.dirname(nodeExe);
      const candidate = path.join(nodeDir, npmRelativeToNode);
      try {
        if (existsSync(candidate)) return { ok: true, path: candidate };
        return { ok: false, reason: `missing: ${candidate}` };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const winStrategies = [
    overrideStrategy("npm", deps),
    npmCliBesideNodeStrategy,
    whereStrategy("npm", deps),
  ];

  const unixStrategies = [
    overrideStrategy("npm", deps),
    whereStrategy("npm", deps),
  ];

  return {
    name: "npm",
    kind: "executor",
    strategies: unixStrategies,
    platformStrategies: { win32: winStrategies },
    toArgv: nodeScriptToArgv,
    classify,
  };
}

/**
 * Helper: bare-import strategy that, on success, transforms the
 * resolved `package.json` into the sibling `<entry>` path. Used by
 * the pi executor to find pi-coding-agent's cli.js via the same
 * module-resolution algorithm as `import()`.
 */
function bareImportCliStrategy(
  pkgName: string,
  entryRelative: string,
  deps?: StrategyDeps,
) {
  // Default uses the real module resolver anchored to this file;
  // tests inject a fake via deps.resolveModule.
  const resolveModule: NonNullable<StrategyDeps["resolveModule"]> =
    deps?.resolveModule
    ?? ((id, from) => {
      try {
        return createRequire(from).resolve(id);
      } catch {
        return null;
      }
    });
  return {
    name: "bare-import",
    run(): { ok: true; path: string } | { ok: false; reason: string } {
      const pkgJson = resolveModule(`${pkgName}/package.json`, import.meta.url);
      if (!pkgJson) {
        return { ok: false, reason: `cannot resolve ${pkgName}/package.json` };
      }
      const entry = path.join(path.dirname(pkgJson), entryRelative);
      return { ok: true, path: entry };
    },
  };
}

/**
 * Register the standard set of dashboard tools. Idempotent — callers
 * may re-register to supply custom strategy deps (e.g. tests).
 */
export function registerDefaultTools(registry: ToolRegistry, deps?: StrategyDeps): void {
  // Executor-kind tools — Node scripts shipped as .cmd shims on
  // Windows. Each registers as [node.exe, <script>.js] to bypass
  // cmd.exe and the console-flash chain (Node issue #21825).
  registry.register(piExecutorDef(deps));
  registry.register(openspecExecutorDef(deps));
  registry.register(npmExecutorDef(deps));

  // Native binaries — no interpreter needed.
  registry.register(binaryDef("node", deps));
  registry.register(binaryDef("git", deps));
  registry.register(binaryDef("jj", deps));
  registry.register(binaryDef("zrok", deps));

  // Platform-conditional process-inspection utilities. These are only
  // called by `packages/shared/src/platform/process.ts` on their native
  // platform — registering the non-native tools would surface as red
  // "not found" rows in the Settings → Tools UI even though the code
  // never calls them there.
  //
  // Honours the registry's `platform` so tests that inject `platform:
  // "win32"` from a Linux host still exercise the Windows tool set.
  //
  // Windows system utilities used by the bridge's process scanner.
  // Registered so callers resolve to full `.exe` paths (e.g.
  // `C:\Windows\System32\wbem\wmic.exe`) and spawn directly — no
  // PATHEXT resolution, no cmd.exe wrapping, windowsHide:true honored
  // all the way down. See change: consolidate-windows-spawn-and-platform-handlers.
  if (registry.getPlatform() === "win32") {
    registry.register(binaryDef("wmic", deps));
    registry.register(binaryDef("powershell", deps));
    registry.register(binaryDef("tasklist", deps));
    registry.register(binaryDef("taskkill", deps));
  } else {
    // POSIX process-inspection utilities. Used by `isProcessRunning`,
    // `findPidByMarker`, `isProcessLikePi` in platform/process.ts.
    registry.register(binaryDef("ps", deps));
    registry.register(binaryDef("pgrep", deps));
  }
  // Windows Terminal — optional, override + where only (not part of
  // managed install, not on Unix).
  registry.register({
    name: "wt",
    kind: "binary",
    strategies: [
      overrideStrategy("wt", deps),
      whereStrategy("wt", deps),
    ],
    classify,
  });

  // Node module entry for pi-coding-agent — used by DefaultPackageManager
  // to IMPORT pi as a library (not spawn it as a process). Distinct from
  // the `pi` executor above.
  registry.register(
    moduleDefWithAliases(
      "pi-coding-agent",
      ["@mariozechner/pi-coding-agent", "@oh-my-pi/pi-coding-agent"],
      path.join("dist", "index.js"),
      deps,
    ),
  );

  // Build-time tools (see change: register-build-time-tools).
  registry.register(
    packageDirModuleDef(
      "electron",
      "electron",
      {
        searchPaths: [path.resolve("packages/electron")],
        includeManaged: true,
      },
      deps,
    ),
  );
  registry.register(
    packageDirModuleDef(
      "node-pty",
      "node-pty",
      { includeManaged: false },
      deps,
    ),
  );
}

/** Handy re-exports for callers that want raw definitions for testing. */
export const _internals = {
  binaryDef,
  moduleDefWithAliases,
};