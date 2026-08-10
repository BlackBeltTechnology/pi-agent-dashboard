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
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolRegistry } from "./registry.js";
import {
  bareImportStrategy,
  bundledGitBashStrategy,
  bundledNodeStrategy,
  managedBinStrategy,
  managedModuleStrategy,
  managedRuntimeStrategy,
  npmGlobalStrategy,
  overrideStrategy,
  type StrategyDeps,
  whereStrategy,
} from "./strategies.js";
import type { InstallHints, Source, Strategy, ToolDefinition } from "./types.js";

// ── Classifier ──────────────────────────────────────────────────────────────

/** Classifier: strategies → Source. Shared across binary and module tools. */
function classify(strategyName: string): Source {
  if (strategyName === "override") return "override";
  if (strategyName === "managed") return "managed";
  if (strategyName === "npm-global") return "npm-global";
  if (strategyName === "bare-import") return "bare-import";
  if (strategyName === "bundled-node") return "bundled";
  if (strategyName === "bundled-git-bash") return "bundled";
  // `where` and anything else — resolved via PATH — classifies as system.
  return "system";
}

// ── Binary definitions ──────────────────────────────────────────────────────

/**
 * Per-OS install guidance, keyed by tool name. Opaque to resolution —
 * attached to definitions and surfaced only by `list()` / REST so the
 * Settings → Tools UI can render an `[Install ▾]` dropdown on missing
 * rows. Only user-installable binaries appear here; platform utilities
 * (powershell, tasklist, ps, pgrep, …) ship with the OS and have no entry.
 *
 * `docsAnchor` values MUST match an `<h2>`/`<h3>` anchor in docs/faq.md
 * (enforced by install-hints.test.ts). Commands sourced from vendor docs.
 *
 * See change: register-bash-and-tool-install-help.
 */
const INSTALL_HINTS: Record<string, InstallHints> = {
  bash: {
    docsAnchor: "install-bash",
    darwin: {
      manual: "Pre-installed at /bin/bash. For a newer version: brew install bash.",
      commands: { brew: "brew install bash" },
    },
    win32: {
      manual: "bash ships inside Git for Windows — install Git, then use its bundled bash. (WSL bash also works but must be set as an override.)",
      commands: {
        winget: "winget install --id Git.Git -e",
        choco: "choco install git",
        scoop: "scoop install git",
      },
      url: "https://gitforwindows.org/",
    },
    linux: {
      manual: "Pre-installed on virtually every distribution.",
      commands: { apt: "sudo apt install bash", dnf: "sudo dnf install bash" },
    },
  },
  git: {
    docsAnchor: "install-git",
    darwin: {
      manual: "Bundled with the Xcode Command Line Tools (xcode-select --install).",
      commands: { brew: "brew install git" },
      url: "https://git-scm.com/download/mac",
    },
    win32: {
      commands: {
        winget: "winget install --id Git.Git -e",
        choco: "choco install git",
        scoop: "scoop install git",
      },
      url: "https://git-scm.com/download/win",
    },
    linux: {
      commands: { apt: "sudo apt install git", dnf: "sudo dnf install git" },
      url: "https://git-scm.com/download/linux",
    },
  },
  node: {
    docsAnchor: "install-node",
    darwin: {
      commands: { brew: "brew install node" },
      url: "https://nodejs.org/en/download",
    },
    win32: {
      commands: {
        winget: "winget install --id OpenJS.NodeJS -e",
        choco: "choco install nodejs",
        scoop: "scoop install nodejs",
      },
      url: "https://nodejs.org/en/download",
    },
    linux: {
      manual: "Prefer a version manager (nvm, fnm) or your distro package.",
      commands: { apt: "sudo apt install nodejs npm" },
      url: "https://nodejs.org/en/download/package-manager",
    },
  },
  gh: {
    docsAnchor: "install-gh",
    darwin: {
      commands: { brew: "brew install gh" },
      url: "https://cli.github.com/",
    },
    win32: {
      commands: {
        winget: "winget install --id GitHub.cli -e",
        choco: "choco install gh",
        scoop: "scoop install gh",
      },
      url: "https://cli.github.com/",
    },
    linux: {
      commands: { apt: "sudo apt install gh", dnf: "sudo dnf install gh" },
      url: "https://github.com/cli/cli/blob/trunk/docs/install_linux.md",
    },
  },
  zrok: {
    docsAnchor: "install-zrok",
    // zrok v2: Homebrew still ships the binary as `zrok`; the tarball, Windows,
    // and Linux packages install `zrok2`. Both names resolve at runtime.
    // See change: support-zrok-v2.
    darwin: {
      commands: { brew: "brew install zrok" },
      url: "https://docs.zrok.io/docs/getting-started/",
    },
    win32: {
      manual: "Download the zrok v2 Windows release and add `zrok2` to PATH.",
      url: "https://github.com/openziti/zrok/releases/latest",
    },
    linux: {
      commands: {
        brew: "brew install zrok",
        script: "curl -sSLf https://get.openziti.io/install.bash | sudo bash -s zrok",
      },
      url: "https://docs.zrok.io/docs/getting-started/",
    },
  },
  ngrok: {
    docsAnchor: "install-ngrok",
    darwin: {
      commands: { brew: "brew install ngrok" },
      url: "https://ngrok.com/download",
    },
    win32: {
      commands: { choco: "choco install ngrok", scoop: "scoop install ngrok" },
      url: "https://ngrok.com/download",
    },
    linux: {
      commands: {
        snap: "sudo snap install ngrok",
        script: "curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && echo 'deb https://ngrok-agent.s3.amazonaws.com buster main' | sudo tee /etc/apt/sources.list.d/ngrok.list && sudo apt update && sudo apt install ngrok",
      },
      url: "https://ngrok.com/download",
    },
  },
  tailscale: {
    docsAnchor: "install-tailscale",
    darwin: {
      commands: { brew: "brew install tailscale" },
      url: "https://tailscale.com/download/macos",
    },
    win32: {
      commands: { winget: "winget install --id Tailscale.Tailscale -e", choco: "choco install tailscale" },
      url: "https://tailscale.com/download/windows",
    },
    linux: {
      commands: { script: "curl -fsSL https://tailscale.com/install.sh | sh" },
      url: "https://tailscale.com/download/linux",
    },
  },
  "zerotier-cli": {
    docsAnchor: "install-zerotier",
    darwin: {
      commands: { brew: "brew install --cask zerotier-one" },
      url: "https://www.zerotier.com/download/",
    },
    win32: {
      commands: { choco: "choco install zerotier-one" },
      url: "https://www.zerotier.com/download/",
    },
    linux: {
      commands: { script: "curl -s https://install.zerotier.com | sudo bash" },
      url: "https://www.zerotier.com/download/",
    },
  },
};

function binaryDef(binaryName: string, deps?: StrategyDeps): ToolDefinition {
  // The `node` binary gets two Node-specific strategies prepended after
  // override:
  //   1. `bundled-node` — Electron-packaged Node at <resourcesPath>/node/
  //      (see change: fix-node-resolution-under-electron).
  //   2. `managedRuntime` — persistent install under <managedDir>/node/
  //      (see change: embed-managed-node-runtime).
  // Both fast-fail when their root is absent, so non-Electron / non-managed
  // callers fall straight through to PATH lookup without extra fs cost.
  const isNode = binaryName === "node";
  const isBash = binaryName === "bash";
  const strategies = [
    overrideStrategy(binaryName, deps),
    ...(isNode
      ? [
          bundledNodeStrategy("node", deps),
          managedRuntimeStrategy("node", deps),
        ]
      : []),
    // bash resolves the Windows bundled git shell (sh.exe == GNU bash)
    // before PATH lookup. No-op on Unix. See change:
    // resolve-bundled-bash-on-windows.
    ...(isBash ? [bundledGitBashStrategy(deps)] : []),
    managedBinStrategy(binaryName, deps),
    whereStrategy(binaryName, deps),
  ];
  return {
    name: binaryName,
    kind: "binary",
    strategies,
    classify,
    // Opaque UX metadata; undefined for tools with no install story.
    installHints: INSTALL_HINTS[binaryName],
  };
}

/**
 * Definition for `npx` — registered as a binary, not an executor.
 *
 * Chain (per spec `tool-registry` requirement "npx strategy chain"):
 *   override → bundled-node → managed-bin → where
 *
 * The bundled-node strategy hits the Electron-packaged npx at
 * `<resourcesPath>/node/bin/npx` (Unix) or `<resourcesPath>\node\npx.cmd`
 * (Windows). Managed-bin probes `~/.pi-dashboard/node_modules/.bin/npx`
 * (a no-op post-`eliminate-electron-runtime-install` for clean Electron
 * installs, but kept for standalone-CLI callers that may have one).
 *
 * See change: fix-node-resolution-under-electron (task 3.3).
 *
 * Note: `register-bash-and-tool-install-help` deliberately does NOT attach
 * `installHints` to `npx` — npx ships with Node, so a user who needs it
 * installs Node (see the `node` install hints / FAQ `#install-node`).
 */
function npxBinaryDef(deps?: StrategyDeps): ToolDefinition {
  const strategies: Strategy[] = [
    overrideStrategy("npx", deps),
    bundledNodeStrategy("npx", deps),
    managedBinStrategy("npx", deps),
    whereStrategy("npx", deps),
  ];
  return { name: "npx", kind: "binary", strategies, classify };
}

// ── Module definitions ──────────────────────────────────────────────────────

/** Sibling probe for an aliased package name (pi: `@earendil-works/*` + `@mariozechner/*`). */
function moduleDefWithAliases(
  canonicalName: string,
  pkgNames: readonly string[],
  entry: string,
  deps?: StrategyDeps,
): ToolDefinition {
  const strategies = [overrideStrategy(canonicalName, deps)];
  // Pass deps so tests can inject a `resolveModule` that returns null
  // (or a fake path) and keep chain-order assertions deterministic.
  // Without this the production resolver — which now includes a
  // dir-walk fallback over the host's real node_modules — would
  // succeed against the live disk and bypass managed/npm-global probes.
  // See change: fix-node-resolution-under-electron (follow-up:
  // bare-import exports-map fallback).
  for (const pkg of pkgNames) strategies.push(bareImportStrategy(pkg, undefined, deps));
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
      const pkgJson =
        resolveModule(`${pkgName}/package.json`, import.meta.url)
        ?? findPackageJsonByDirWalk(pkgName, import.meta.url, searchPaths, deps?.exists);
      if (!pkgJson) {
        return { ok: false, reason: `cannot resolve ${pkgName} package directory` };
      }
      return { ok: true, path: path.dirname(pkgJson) };
    },
  };
}

/**
 * Helper: walks up from `fromUrl`'s directory looking for
 * `node_modules/<pkgName>/package.json` directly on the filesystem.
 *
 * Exports-map-immune: required because both `@earendil-works/pi-coding-agent`
 * and `@fission-ai/openspec` declare `exports` blocks that omit
 * `./package.json`, so `createRequire(from).resolve("<pkg>/package.json")`
 * returns `ERR_PACKAGE_PATH_NOT_EXPORTED` in modern Node. This walk is
 * a deliberate end-run around the resolver — we already know the file
 * we want and just need its absolute path.
 *
 * Honors the injected `exists` predicate so tests with mocked
 * filesystems stay deterministic; falls back to `existsSync` when
 * none is injected.
 *
 * See change: eliminate-electron-runtime-install (F9 follow-on).
 */
function findPackageJsonByDirWalk(
  pkgName: string,
  fromUrl: string,
  searchPaths?: readonly string[],
  exists?: StrategyDeps["exists"],
): string | null {
  const check = exists ?? existsSync;
  const candidates: string[] = [];
  try {
    candidates.push(path.dirname(fileURLToPath(fromUrl)));
  } catch {
    // fromUrl might not be a file: URL in synthetic test contexts.
  }
  for (const sp of searchPaths ?? []) candidates.push(sp);
  for (const start of candidates) {
    let dir = start;
    // Bound the walk: stop at filesystem root or once dirname is
    // unchanged. Defensive cap at 64 levels covers any plausible
    // workspace nesting without an infinite-loop risk on broken paths.
    for (let i = 0; i < 64; i += 1) {
      const candidate = path.join(dir, "node_modules", pkgName, "package.json");
      if (check(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
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
 * Resolve a Node-script executor's resolved path to a `.js` entry point
 * suitable for node-wrapping, or null when it is not a Node script.
 *
 * - Already a `.js` path → return it verbatim (Windows `.js` entry, or a
 *   unix `bare-import`/`managedModule` hit like `bin/openspec.js`).
 * - Unix only: the `managedBin` strategy resolves `.bin/openspec` — a
 *   `#!/usr/bin/env node` shebang SYMLINK whose real target is the
 *   package's `bin/openspec.js`. Dereference it so we can node-wrap the
 *   real `.js` and stop depending on the shebang finding `node` on PATH.
 *   Windows managed-bin resolves a `.cmd` shim (not a symlink), so the
 *   deref is skipped there — preserving the Windows branch byte-for-byte.
 *
 * The `realpath` seam defaults to real `realpathSync`; tests inject a fake
 * so a mocked `BUNDLED_*` path cannot dereference to a real on-disk script.
 * See change: fix-node-electron-resolution-test-isolation.
 */
function resolveJsScript(
  resolvedPath: string,
  platform: NodeJS.Platform,
  realpath: (p: string) => string = realpathSync,
): string | null {
  if (/\.js$/i.test(resolvedPath)) return resolvedPath;
  if (platform !== "win32") {
    try {
      const real = realpath(resolvedPath);
      if (/\.js$/i.test(real)) return real;
    } catch {
      // Not a symlink / missing on disk — fall through to shebang path.
    }
  }
  return null;
}

/**
 * Shared `toArgv` for Node-script executors (pi, openspec, npm).
 *
 * When the resolved path is (or dereferences to) a `.js` entry, prepend a
 * real `node` interpreter so the spawn becomes `[<node>, <script>.js]`.
 * This runs on unix AND Windows:
 *
 * - Windows: bypasses the `.cmd` shim entirely (no cmd.exe → no console
 *   flash). See change: fix-windows-standalone-spawn.
 * - Unix: removes the dependency on the `#!/usr/bin/env node` shebang
 *   finding a binary named `node` on the child's PATH — the exact gap
 *   that breaks a GUI-launched (Electron) server with a stripped PATH
 *   (exit 127 / `env: node: No such file`). See change:
 *   fix-openspec-config-read-bundled-node.
 *
 * Node resolution order:
 *   1. `registry.resolve("node")` when it returns ok with a non-null path
 *      (the strategy chain has already validated existence via its
 *      injected `exists` dep) — the deterministic, PATH-independent path.
 *   2. `execPath` (default `process.execPath`) — the dashboard server's
 *      own interpreter — as a guaranteed-well-formed fallback. Under
 *      Electron this is the Electron binary; the runner sets
 *      `ELECTRON_RUN_AS_NODE=1` on that child spawn so it still executes
 *      as node. The `execPath`/`realpath` seams come from injected
 *      `StrategyDeps` (default = live process/fs), so executor argv
 *      assembly is deterministic under test and never leaks host machine
 *      state. See change: fix-node-electron-resolution-test-isolation.
 */
function makeNodeScriptToArgv(deps?: StrategyDeps): ToolDefinition["toArgv"] {
  const execPath = deps?.execPath ?? process.execPath;
  const realpath = deps?.realpath ?? realpathSync;
  return (resolvedPath, { platform, registry }) => {
    const scriptPath = resolveJsScript(resolvedPath, platform, realpath);
    if (scriptPath) {
      const node = registry.resolve("node");
      if (node.ok && node.path) return [node.path, scriptPath];
      return [execPath, scriptPath];
    }
    return [resolvedPath];
  };
}

/**
 * Executor definition for `pi` — ONE tool, OS dispatch inside.
 *
 * On Windows, the strategy chain finds pi-coding-agent's `dist/cli.js`
 * (managed → bare-import → npm-global), and `toArgv` wraps it with
 * `node.exe` to produce `[node.exe, cli.js]`. Falls back to `pi.cmd`
 * on PATH when the cli.js is nowhere to be found.
 *
 * On Unix, the chain first tries `bare-import` so a bundled
 * `<server>/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`
 * wins over a system install. This is load-bearing for the Electron
 * immutable-bundle architecture (see openspec change
 * `eliminate-electron-runtime-install` finding F9). On a clean machine
 * with no system `pi` and no managed `~/.pi-dashboard/node/bin/`,
 * bare-import resolves the bundled cli.js (`#!/usr/bin/env node`
 * shebang, executable) and `nodeScriptToArgv` returns `[cli.js]`
 * directly. Without this strategy, the server falls into
 * `bootstrapInstall(...)` and writes to `~/.pi-dashboard/` — the
 * exact failure mode the immutable-bundle architecture eliminates.
 */
function piExecutorDef(deps?: StrategyDeps): ToolDefinition {
  const piPkgAliases = ["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent"];
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
    ...piPkgAliases.map((pkg) => bareImportCliStrategy(pkg, cliEntry, deps)),
    managedBinStrategy("pi", deps),
    whereStrategy("pi", deps),
  ];

  return {
    name: "pi",
    kind: "executor",
    strategies: unixStrategies,
    platformStrategies: { win32: winStrategies },
    toArgv: makeNodeScriptToArgv(deps),
    classify,
  };
}

/**
 * Executor definition for `openspec`.
 *
 * On Windows: finds `@fission-ai/openspec/bin/openspec.js` via managed
 * → bare-import → npm-global. `toArgv` wraps with node.exe.
 * On Unix: tries bare-import first (bundled
 * `<server>/node_modules/@fission-ai/openspec/bin/openspec.js`), then
 * managed-bin, then PATH. Symmetric with pi; same Electron
 * immutable-bundle rationale (F9).
 */
function openspecExecutorDef(deps?: StrategyDeps): ToolDefinition {
  const pkgName = "@fission-ai/openspec";
  const cliEntry = path.join("bin", "openspec.js");

  const winStrategies = [
    overrideStrategy("openspec", deps),
    bareImportCliStrategy(pkgName, cliEntry, deps),
    managedModuleStrategy(pkgName, cliEntry, deps),
    npmGlobalStrategy(pkgName, cliEntry, deps),
    managedBinStrategy("openspec", deps),
    whereStrategy("openspec", deps),
  ];

  const unixStrategies = [
    overrideStrategy("openspec", deps),
    bareImportCliStrategy(pkgName, cliEntry, deps),
    managedBinStrategy("openspec", deps),
    whereStrategy("openspec", deps),
  ];

  return {
    name: "openspec",
    kind: "executor",
    strategies: unixStrategies,
    platformStrategies: { win32: winStrategies },
    toArgv: makeNodeScriptToArgv(deps),
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

  // Bundled npm under Electron at <resourcesPath>/node/bin/npm (Unix)
  // or <resourcesPath>\node\npm.cmd (Windows). Runs BEFORE managedRuntime
  // because installing the Electron app implicitly opts the user into
  // its bundled Node toolchain.
  // See change: fix-node-resolution-under-electron.
  const bundledNpm = bundledNodeStrategy("npm", deps);

  // Managed-Node runtime: prefer <managedDir>/node/{npm.cmd,bin/npm}
  // when the runtime is installed. See change: embed-managed-node-runtime.
  const managedNpm = managedRuntimeStrategy("npm", deps);

  const winStrategies = [
    overrideStrategy("npm", deps),
    bundledNpm,
    managedNpm,
    npmCliBesideNodeStrategy,
    whereStrategy("npm", deps),
  ];

  const unixStrategies = [
    overrideStrategy("npm", deps),
    bundledNpm,
    managedNpm,
    whereStrategy("npm", deps),
  ];

  return {
    name: "npm",
    kind: "executor",
    strategies: unixStrategies,
    platformStrategies: { win32: winStrategies },
    toArgv: makeNodeScriptToArgv(deps),
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
  // Fallback to a filesystem walk because both pi-coding-agent and
  // openspec declare exports maps that omit ./package.json (modern Node
  // resolver returns ERR_PACKAGE_PATH_NOT_EXPORTED). See change:
  // eliminate-electron-runtime-install (F9 follow-on).
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
      const pkgJson =
        resolveModule(`${pkgName}/package.json`, import.meta.url)
        ?? findPackageJsonByDirWalk(pkgName, import.meta.url, undefined, deps?.exists);
      if (!pkgJson) {
        return { ok: false, reason: `cannot locate ${pkgName} package directory` };
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
  // bash — resolved by the bridge's `!`/`!!` chat-escape. Registered on
  // every platform; the `where` strategy finds /bin/bash (Unix) or
  // Git-for-Windows / WSL bash on PATH (Windows). The `managed` slot is
  // vestigial (bash is never on npm) but kept for chain uniformity.
  // See change: register-bash-and-tool-install-help.
  registry.register(binaryDef("bash", deps));
  registry.register(binaryDef("node", deps));
  // npx — registered as a binary with bundled-node prepended so the
  // Electron-bundled npx is found on packaged installs.
  // See change: fix-node-resolution-under-electron (task 3.3).
  registry.register(npxBinaryDef(deps));
  registry.register(binaryDef("git", deps));
  registry.register(binaryDef("zrok", deps));
  // Alternative tunnel/gateway providers. Optional; each provider's
  // detectBinary()/isEnrolled() gate whether it can be selected.
  // See change: add-tunnel-providers.
  registry.register(binaryDef("ngrok", deps));
  registry.register(binaryDef("tailscale", deps));
  registry.register(binaryDef("zerotier-cli", deps));
  // GitHub CLI — used by the worktree-lifecycle `pr` endpoint.
  // Optional; if missing the endpoint returns code `gh_not_found`.
  // See change: add-worktree-lifecycle-actions.
  registry.register(binaryDef("gh", deps));

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
  // `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`) and spawn
  // directly — no PATHEXT resolution, no cmd.exe wrapping, windowsHide:true
  // honored all the way down. wmic NOT registered: removed by default on
  // Win 11 22H2+, all introspection now uses PowerShell Get-CimInstance.
  // See change: replace-wmic-with-powershell.
  if (registry.getPlatform() === "win32") {
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
      ["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent"],
      path.join("dist", "index.js"),
      deps,
    ),
  );

  // pi-ai module — used by model-proxy to call upstream LLM providers.
  // Aliases: @earendil-works/pi-ai (preferred) + @mariozechner/pi-ai (legacy fallback).
  // See change: add-dashboard-model-proxy.
  registry.register(
    moduleDefWithAliases(
      "pi-ai",
      ["@earendil-works/pi-ai", "@mariozechner/pi-ai"],
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