# tool-registry Specification

## Purpose

Single-source resolver for every external binary, module, and directory the dashboard depends on. The registry replaces ad-hoc `which`/`require.resolve`/hardcoded-path lookups across the codebase with a unified `ToolRegistry` service that runs an ordered strategy chain per tool, caches the result, records a diagnostic trail of attempted strategies, and supports user-supplied per-tool path overrides.

## Requirements

### Requirement: Central tool registry service
The dashboard SHALL expose a single `ToolRegistry` service in `@blackbelt-technology/pi-dashboard-shared/tool-registry` that resolves every external binary, module, and directory the dashboard depends on. The registry SHALL expose `resolve(name)`, `resolveModule(name)`, `rescan(name?)`, `list()`, `setOverride(name, path)`, and `clearOverride(name)` operations.

#### Scenario: Resolve a registered binary
- **WHEN** a caller invokes `registry.resolve("pi")`
- **THEN** the registry SHALL return a `Resolution` object containing `{ name, ok, path, source, tried, resolvedAt }`
- **AND** for path-kind tools (`binary`/`module`/`directory`) `path` SHALL be absolute when `ok` is `true`, else `null`
- **AND** for non-path probe kinds (`env`/`docker-image`/`pw-browser`) `path` MAY be `null` (env) or a non-filesystem reference such as an image ref (docker-image) when `ok` is `true`

#### Scenario: Resolve an unregistered name
- **WHEN** a caller invokes `registry.resolve("nonexistent-tool")`
- **THEN** the registry SHALL throw a typed `UnknownToolError` naming the requested tool

#### Scenario: Resolve returns same cached Resolution within a process
- **WHEN** `registry.resolve(name)` is called twice in the same process with no intervening `rescan`
- **THEN** both calls SHALL return the same `Resolution` object (referentially equal) without re-running strategies

#### Scenario: rescan() invalidates cache for one tool
- **WHEN** `registry.rescan("pi")` is called
- **THEN** the cached Resolution for `"pi"` SHALL be cleared
- **AND** the next `registry.resolve("pi")` SHALL re-run every strategy and populate a fresh `tried[]` list

#### Scenario: rescan() without argument invalidates all tools
- **WHEN** `registry.rescan()` is called with no argument
- **THEN** every cached Resolution SHALL be cleared

### Requirement: Ordered strategy chain with diagnostic trail
Each registered tool SHALL declare an ordered list of resolution strategies. On resolution, the registry SHALL try strategies in order and record each attempt in `Resolution.tried` with a short machine-readable reason. The first successful strategy determines `path` and `source`; subsequent strategies SHALL NOT be executed.

#### Scenario: First strategy wins
- **WHEN** the `override` strategy for `"pi"` returns `{ ok: true, path: "C:\\custom\\pi.cmd" }`
- **THEN** `Resolution.path` SHALL equal `"C:\\custom\\pi.cmd"`
- **AND** `Resolution.source` SHALL equal `"override"`
- **AND** `Resolution.tried` SHALL contain exactly one entry with `result: "ok"`

#### Scenario: Failing strategies are recorded and iteration continues
- **WHEN** the `override` strategy returns `{ ok: false, reason: "no override set" }` and the `managed` strategy returns `{ ok: false, reason: "missing: C:\\Users\\u\\.pi-dashboard\\..." }` and the `npm-global` strategy succeeds
- **THEN** `Resolution.tried` SHALL contain three entries in order: override (reason: "no override set"), managed (reason: "missing: ..."), npm-global (result: "ok")
- **AND** `Resolution.source` SHALL equal `"npm-global"`

#### Scenario: All strategies fail
- **WHEN** every strategy returns `{ ok: false, reason: <string> }`
- **THEN** `Resolution.ok` SHALL be `false`
- **AND** `Resolution.path` SHALL be `null`
- **AND** `Resolution.source` SHALL be `null`
- **AND** `Resolution.tried` SHALL contain one entry per attempted strategy, each with its reason

### Requirement: Module resolution returns loaded ES module
The registry SHALL expose `resolveModule(name)` for tools with `kind: "module"`. It SHALL execute the strategy chain, dynamically import the resolved entry path via `pathToFileURL`, and return the loaded module alongside the `Resolution`.

#### Scenario: Resolve pi-coding-agent module
- **WHEN** `registry.resolveModule("pi-coding-agent")` is called and any strategy resolves a valid `dist/index.js`
- **THEN** the registry SHALL `await import(pathToFileURL(path).href)`
- **AND** return `{ resolution, module }` where `module.DefaultPackageManager` is defined

#### Scenario: Resolve fails when no strategy succeeds
- **WHEN** `registry.resolveModule("pi-coding-agent")` is called and every strategy returns `{ ok: false }`
- **THEN** the registry SHALL throw a typed `ModuleResolutionError` whose `.message` includes the `Resolution.tried` trail
- **AND** SHALL NOT attempt any `import()`

#### Scenario: Loaded modules are cached alongside Resolution
- **WHEN** `registry.resolveModule("pi-coding-agent")` succeeds and is called again without intervening `rescan`
- **THEN** the second call SHALL return the same module reference without re-importing

### Requirement: Override persistence in `~/.pi/dashboard/tool-overrides.json`
The registry SHALL read user-supplied per-tool path overrides from `~/.pi/dashboard/tool-overrides.json` on first access and cache them in memory. The file SHALL use the schema `{ version: 1, overrides: { [toolName]: { path: string } } }`. Writes SHALL go through the atomic `json-store` helper.

#### Scenario: Override file absent
- **WHEN** the registry loads overrides and `~/.pi/dashboard/tool-overrides.json` does not exist
- **THEN** the in-memory override map SHALL be empty
- **AND** no error SHALL be raised

#### Scenario: setOverride writes file and invalidates cache
- **WHEN** `registry.setOverride("pi", "C:\\custom\\pi.cmd")` is called
- **THEN** the registry SHALL write the updated override object to `~/.pi/dashboard/tool-overrides.json` atomically
- **AND** SHALL invalidate the cached Resolution for `"pi"`
- **AND** the next `registry.resolve("pi")` SHALL return `source: "override"` when the path validates

#### Scenario: clearOverride removes entry
- **WHEN** `registry.clearOverride("pi")` is called and an override for `"pi"` exists
- **THEN** the override entry for `"pi"` SHALL be removed from the file
- **AND** the cached Resolution for `"pi"` SHALL be invalidated

#### Scenario: Invalid override falls through
- **WHEN** an override points to a path that fails the tool's `validate()` check (e.g., file does not exist)
- **THEN** the `override` strategy SHALL record `{ ok: false, reason: "invalid: <validation error>" }`
- **AND** the registry SHALL continue to the next strategy
- **AND** `Resolution.source` SHALL NOT equal `"override"` unless validation passes

#### Scenario: Malformed overrides file
- **WHEN** `~/.pi/dashboard/tool-overrides.json` exists but cannot be parsed as JSON matching the schema
- **THEN** the registry SHALL log a warning and treat the override map as empty
- **AND** SHALL NOT crash or block resolution

### Requirement: Registered tool set

The registry SHALL ship with definitions for at minimum: `pi` (binary), `pi-coding-agent` (module), `openspec` (binary), `npm` (binary), `npx` (binary), `node` (binary), `tsx` (binary), `git` (binary), `zrok` (binary), `gh` (binary), AND `bash` (binary). Each definition SHALL declare an ordered strategy chain and a `classify` function mapping resolved paths to `source` values.

The `node`, `npm`, and `npx` tools are members of ONE Node distribution and SHALL each
probe the managed Node runtime root, so an installed managed runtime is visible to
every member of the family rather than to a subset of it. Their chains are NOT
otherwise required to be identical — `npm` has no `managedBin` step, and `npm` on
`win32` has an additional `npmCliBesideNode` step.

#### Scenario: node strategy chain

- **WHEN** `registry.resolve("node")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bundled-node` (`<resourcesPath>/node/bin/node` Unix / `\node\node.exe` Windows), `managedRuntime` (`<managedDir>/node/bin/node` Unix / `\node\node.exe` Windows), `managedBin` (`<managedDir>/node_modules/.bin/node`), `where` (delegating to `ToolResolver.which("node")`)

#### Scenario: npm strategy chain

- **WHEN** `registry.resolveExecutor("npm")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bundled-node` (`<resourcesPath>/node/bin/npm` Unix / `\node\npm.cmd` Windows), `managedRuntime` (`<managedDir>/node/bin/npm` Unix / `\node\npm.cmd` Windows), then on `win32` only `npmCliBesideNode`, then `where`
- **AND** the chain SHALL NOT include a `managedBin` step, which is not implemented for `npm` on any platform

#### Scenario: npx strategy chain

- **WHEN** `registry.resolve("npx")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bundled-node` (`<resourcesPath>/node/bin/npx` Unix / `\node\npx.cmd` Windows), `managedRuntime` (`<managedDir>/node/bin/npx` Unix / `\node\npx.cmd` Windows), `managedBin` (`MANAGED_BIN/npx`), `where` (delegating to `ToolResolver.which("npx")`)

#### Scenario: an installed managed Node runtime is visible to every family member

- **WHEN** a managed Node runtime is installed at `<managedDir>/node/` providing all three binaries, and no override or bundled runtime is present
- **THEN** `resolve("node")`, `resolve("npm")`, and `resolve("npx")` SHALL each resolve into that managed runtime
- **AND** no family member SHALL fall through to `where`/PATH while the managed runtime provides that member

#### Scenario: pi strategy chain

- **WHEN** `registry.resolve("pi")` runs
- **THEN** strategies SHALL be tried in order: `override`, `managed` (`MANAGED_BIN/pi.cmd` on Windows, `MANAGED_BIN/pi` elsewhere), `where` (delegating to `ToolResolver.which("pi")`)

#### Scenario: pi-coding-agent strategy chain

- **WHEN** `registry.resolveModule("pi-coding-agent")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bare-import` (`import("@mariozechner/pi-coding-agent")`), `managed` (`~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent/dist/index.js`), `npm-global` (`<npm root -g>/@mariozechner/pi-coding-agent/dist/index.js`)
- **AND** a sibling strategy SHALL also probe `@oh-my-pi/pi-coding-agent` under both managed and npm-global paths

#### Scenario: bash strategy chain

- **WHEN** `registry.resolve("bash")` runs
- **THEN** strategies SHALL be tried in order: `override`, `managed` (`MANAGED_BIN/bash`), `where` (delegating to `ToolResolver.which("bash")`)
- **AND** the `managed` slot SHALL be retained for chain uniformity with other binary tools even though `bash` is not currently npm-installable (the archived `fix-doctor-stale-managed-install-check` already deprecated the false "managed install incomplete" Doctor advisory)

### Requirement: Source classification
Each `Resolution.source` SHALL be one of: `"override"`, `"managed"`, `"system"`, `"npm-global"`, `"bare-import"`, `"bundled"`, `"static-npm"`, `"probe"`, or `null`. The value SHALL be determined by the strategy that succeeded, not by re-analyzing the resolved path. The `"static-npm"` source SHALL denote a binary path exported by an npm package (e.g. `ffmpeg-static`); the `"probe"` source SHALL denote a non-path presence strategy (`env`/`docker-image`/`pw-browser`).

#### Scenario: Managed install classifies as managed
- **WHEN** the `managed` strategy succeeds for any tool
- **THEN** `Resolution.source` SHALL equal `"managed"`

#### Scenario: PATH resolution classifies as system
- **WHEN** the `where` strategy (backed by `ToolResolver.which`) succeeds and the resolved path does not start with `MANAGED_BIN`
- **THEN** `Resolution.source` SHALL equal `"system"`

#### Scenario: Bundled Node classifies as bundled
- **WHEN** the bundled-node strategy succeeds for `node`, `npm`, or `npx`
- **THEN** `Resolution.source` SHALL equal `"bundled"`
- **AND** the Settings → Tools UI SHALL render this as a distinct source badge

#### Scenario: static-npm and probe strategies classify distinctly
- **WHEN** the `static-npm` strategy succeeds (e.g. `ffmpeg` via `ffmpeg-static`)
- **THEN** `Resolution.source` SHALL equal `"static-npm"`
- **AND** WHEN a non-path probe strategy (`env`/`docker-image`/`pw-browser`) succeeds, `Resolution.source` SHALL equal `"probe"` and SHALL NOT be misclassified as `"system"`

### Requirement: Bundled-Node strategy resolves Electron-bundled runtime

The registry SHALL ship with a `bundledNodeStrategy(toolName: "node" | "npm" | "npx")` strategy that probes the Electron-bundled Node.js runtime under `process.resourcesPath/node/`. The strategy SHALL be wired into the strategy chains for `node`, `npm`, and `npx` immediately after `override` and BEFORE `managedRuntime`.

#### Scenario: bundled Node resolves on macOS packaged install
- **WHEN** the dashboard runs from a packaged macOS Electron app
- **AND** `process.resourcesPath/node/bin/node` exists
- **AND** no override for `"node"` is set
- **THEN** `registry.resolve("node")` SHALL return `{ ok: true, path: <resourcesPath>/node/bin/node, source: "bundled" }`

#### Scenario: bundled Node resolves on Windows packaged install
- **WHEN** the dashboard runs from a packaged Windows Electron app
- **AND** `process.resourcesPath\node\node.exe` exists
- **AND** no override for `"node"` is set
- **THEN** `registry.resolve("node")` SHALL return `{ ok: true, path: <resourcesPath>\node\node.exe, source: "bundled" }`

#### Scenario: bundled npm resolves with platform-correct extension
- **WHEN** the dashboard runs from a packaged Electron app
- **AND** the bundled `npm` exists at `<resourcesPath>/node/bin/npm` (Unix) or `<resourcesPath>\node\npm.cmd` (Windows)
- **THEN** `registry.resolveExecutor("npm")` SHALL include the bundled path in its `argv`
- **AND** `Resolution.source` SHALL equal `"bundled"`

#### Scenario: bundled npx resolves with platform-correct extension
- **WHEN** the dashboard runs from a packaged Electron app
- **AND** the bundled `npx` exists at `<resourcesPath>/node/bin/npx` (Unix) or `<resourcesPath>\node\npx.cmd` (Windows)
- **THEN** `registry.resolve("npx")` SHALL return `{ ok: true, source: "bundled", path: <bundled-npx-path> }`

#### Scenario: bundled strategy fast-fails when not under Electron
- **WHEN** `process.resourcesPath` is undefined or absent from `ctx.env`
- **THEN** the bundled-node strategy SHALL return `{ ok: false, reason: "no resourcesPath" }` without performing any filesystem probe
- **AND** the next strategy in the chain SHALL run

#### Scenario: bundled strategy falls through when bundled dir missing
- **WHEN** `process.resourcesPath` is set but `<resourcesPath>/node/` does not exist on disk
- **THEN** the bundled-node strategy SHALL return `{ ok: false, reason: "missing: <candidate-path>" }`
- **AND** the next strategy in the chain SHALL run
- **AND** the final `Resolution.tried` array SHALL include an entry naming the bundled strategy with its reason

#### Scenario: override wins over bundled
- **WHEN** an override is set for `"node"` pointing at an existing file at `/usr/local/bin/node`
- **AND** a bundled Node also exists at `<resourcesPath>/node/bin/node`
- **THEN** `registry.resolve("node")` SHALL return `{ ok: true, path: "/usr/local/bin/node", source: "override" }`
- **AND** the bundled-node strategy SHALL NOT run

### Requirement: `StrategyCtx.env.resourcesPath` is the injectable input

`StrategyCtx.env` SHALL include an optional `resourcesPath?: string` field. The `ToolRegistry` constructor SHALL populate it from `process.resourcesPath` by default; callers (and tests) SHALL be able to override it.

#### Scenario: production registry reads process.resourcesPath
- **WHEN** `new ToolRegistry()` is constructed without an `env` argument
- **THEN** `ctx.env.resourcesPath` SHALL equal `process.resourcesPath` (which may be `undefined` outside Electron)

#### Scenario: test registry accepts a fake resourcesPath
- **WHEN** `new ToolRegistry({ env: { resourcesPath: "/fake/Resources" } })` is constructed
- **THEN** every strategy SHALL receive `ctx.env.resourcesPath === "/fake/Resources"` regardless of the host's real `process.resourcesPath`

### Requirement: Build-time tool definitions

The registry SHALL ship with definitions for `electron` (kind: `module`) and `node-pty` (kind: `module`) in addition to the existing tool set defined by `2026-04-19-consolidate-tool-resolution`. Each definition SHALL declare an ordered strategy chain that resolves the package directory regardless of npm hoisting layout (nested under a workspace's `node_modules` OR hoisted to the workspace root).

#### Scenario: electron strategy chain

- **WHEN** `registry.resolveModule("electron")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bare-import`, `managed`
- **AND** the `bare-import` strategy SHALL invoke `require.resolve("electron/package.json", { paths: ["packages/electron"] })`
- **AND** on success, `Resolution.path` SHALL be the directory containing the resolved `package.json` (i.e., the directory containing `electron/install.js`)

#### Scenario: electron resolves under hoisted layout

- **WHEN** `electron/package.json` exists at `<repoRoot>/node_modules/electron/package.json`
- **AND** `electron/package.json` does NOT exist at `<repoRoot>/packages/electron/node_modules/electron/package.json`
- **THEN** the `bare-import` strategy SHALL succeed
- **AND** `Resolution.path` SHALL equal `<repoRoot>/node_modules/electron`
- **AND** `Resolution.source` SHALL equal `"bare-import"`

#### Scenario: electron resolves under nested workspace layout

- **WHEN** `electron/package.json` exists at `<repoRoot>/packages/electron/node_modules/electron/package.json`
- **THEN** the `bare-import` strategy SHALL prefer the nested path
- **AND** `Resolution.path` SHALL equal `<repoRoot>/packages/electron/node_modules/electron`
- **AND** `Resolution.source` SHALL equal `"bare-import"`

#### Scenario: electron not installed in any layout

- **WHEN** `electron/package.json` exists in neither location and no override is set and no managed install is present
- **THEN** every strategy SHALL record `{ ok: false, reason: <descriptive string> }`
- **AND** `Resolution.ok` SHALL be `false`
- **AND** `Resolution.path` SHALL be `null`

#### Scenario: node-pty strategy chain

- **WHEN** `registry.resolveModule("node-pty")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bare-import`
- **AND** the `bare-import` strategy SHALL invoke `require.resolve("node-pty/package.json")`
- **AND** on success, `Resolution.path` SHALL be the directory containing the resolved `package.json` (i.e., the directory containing `node-pty/prebuilds/`)

#### Scenario: node-pty missing in current workspace

- **WHEN** `registry.resolveModule("node-pty")` runs from a workspace context where `node-pty` is not resolvable via standard Node module lookup
- **AND** no override is set
- **THEN** the `bare-import` strategy SHALL record `{ ok: false, reason: "module not resolvable: node-pty" }`
- **AND** `Resolution.ok` SHALL be `false`
- **AND** callers SHALL treat this as a soft no-op (postinstall scripts MUST exit 0 without error)

### Requirement: Shell-callable tool resolver

The shared package SHALL expose a CommonJS shell-callable resolver at `packages/shared/bin/pi-dashboard-resolve-tool.cjs` so that build-time scripts (workflows, Dockerfiles) can resolve registered tools without depending on the shared package's TypeScript build output. The script SHALL be self-contained: it MUST NOT require `tsx`, `jiti`, or any other transpiler at invocation time.

#### Scenario: Resolver prints absolute path on success

- **WHEN** the resolver is invoked as `node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron` from the repo root
- **AND** electron resolves successfully
- **THEN** the resolver SHALL print the absolute path of the resolved package directory to stdout, followed by a newline
- **AND** the process SHALL exit with code 0

#### Scenario: Resolver fails on unknown tool

- **WHEN** the resolver is invoked with a tool name that is not registered
- **THEN** the resolver SHALL print an error message naming the unknown tool to stderr
- **AND** SHALL exit with code 1

#### Scenario: Resolver fails on unresolvable tool

- **WHEN** the resolver is invoked for a registered tool that no strategy can resolve
- **THEN** the resolver SHALL print a message to stderr including the tried trail
- **AND** SHALL exit with code 1

#### Scenario: Resolver --json flag

- **WHEN** the resolver is invoked with `--json` as a second argument
- **THEN** the resolver SHALL print a JSON object matching the `Resolution` shape (`{ name, ok, path, source, tried, resolvedAt }`) to stdout
- **AND** SHALL exit with code 0 even when `ok` is `false` (the resolution outcome is encoded in the JSON, not the exit code, when `--json` is present)

#### Scenario: Resolver consults override file

- **WHEN** `~/.pi/dashboard/tool-overrides.json` contains a valid override for the requested tool
- **AND** the override path passes existence validation
- **THEN** the resolver SHALL print the override path
- **AND** the equivalent `--json` invocation SHALL report `source: "override"`

### Requirement: Build-time consumers use the registry

Build-time scripts that previously hardcoded `node_modules/<dep>` paths SHALL resolve those paths through the registry (via the shell-callable resolver for non-Node consumers, or via the inline `bare-import` semantics where the resolver itself is unavailable). The migrated sites are: `.github/workflows/publish.yml` (linux/arm64 electron rebuild step), `packages/electron/scripts/Dockerfile.build` (Docker cross-platform electron rebuild step), and `scripts/fix-pty-permissions.cjs` (root postinstall).

#### Scenario: publish.yml resolves electron via the resolver

- **WHEN** the linux/arm64 matrix cell executes the "Rebuild native modules" step
- **THEN** the step SHALL invoke `node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron` to obtain the electron directory
- **AND** the step SHALL NOT contain a hardcoded `packages/electron/node_modules/electron` substring
- **AND** the step SHALL NOT contain an inline `node -e` invocation that hand-rolls `require.resolve` for electron

#### Scenario: Dockerfile.build resolves electron via the resolver

- **WHEN** the cross-platform Docker build runs `node install.js` for electron
- **THEN** the `RUN` step SHALL obtain the electron directory by invoking `node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron`
- **AND** the `RUN` step SHALL NOT contain a hardcoded `packages/electron/node_modules/electron` substring

#### Scenario: fix-pty-permissions resolves node-pty via require.resolve

- **WHEN** the root `postinstall` hook executes `scripts/fix-pty-permissions.cjs`
- **THEN** the script SHALL resolve `node-pty/package.json` via `require.resolve("node-pty/package.json")` (matching the registry's `bare-import` strategy semantics)
- **AND** SHALL chmod every `prebuilds/<dir>/spawn-helper` file under the resolved directory to mode `0o755`
- **AND** SHALL exit with code 0 with no error output when `node-pty` is not resolvable
- **AND** SHALL NOT contain a hardcoded `node_modules/node-pty/prebuilds` substring

### Requirement: Lint enforcement of registry usage

A repo-level vitest test SHALL exist at `packages/shared/src/__tests__/no-hardcoded-node-modules-paths.test.ts` that scans a defined set of source files for `node_modules/electron` and `node_modules/node-pty` substrings outside an explicit allowlist. The test SHALL fail with a `file:line:col` citation when any non-allowlisted occurrence is found. This test SHALL run as part of `npm test`.

#### Scenario: Test scopes scan to build-time files

- **WHEN** the test runs
- **THEN** it SHALL scan `.github/workflows/*.yml`, `packages/electron/scripts/Dockerfile.build`, `packages/electron/scripts/*.sh`, `scripts/*.cjs`, and `scripts/*.sh`
- **AND** it SHALL NOT scan generated files, `dist/`, or `node_modules/`

#### Scenario: New hardcoded path triggers lint failure

- **WHEN** a contributor adds `cd node_modules/electron && ...` to any in-scope file
- **THEN** `npm test` SHALL fail
- **AND** the failure message SHALL cite the file, line, and column of the violation
- **AND** the failure message SHALL reference the tool registry as the canonical replacement

#### Scenario: Allowlisted inline copy is permitted

- **WHEN** the scan encounters `scripts/fix-pty-permissions.cjs` (the bootstrap-friendly inline twin of the `bare-import` strategy)
- **THEN** the test SHALL NOT fail on its `node_modules/node-pty` substring (if any) due to its presence on the allowlist
- **AND** the allowlist SHALL be defined inside the test file itself with explanatory comments

#### Scenario: Comments and string-prefixed lines are not false positives

- **WHEN** the scan encounters `node_modules/electron` inside a comment line (e.g., `# Electron may be hoisted to root node_modules ...`)
- **THEN** the test SHALL NOT report it as a violation
- **AND** the comment-stripping logic SHALL handle YAML `#`, shell `#`, and JS `//` comment prefixes

### Requirement: `bash` is a registered binary tool

The registry SHALL ship with a `bash` definition of `kind: "binary"`. The definition SHALL be registered on every platform (`darwin`, `linux`, `win32`). `bash` is a meaningful concept on all three even when the resolved path differs (`/bin/bash`, `/opt/homebrew/bin/bash`, `C:\Program Files\Git\bin\bash.exe`). The definition SHALL use the stock binary strategy chain: `override`, `managed` (`MANAGED_BIN/bash`), `where` (delegating to `ToolResolver.which("bash")`).

#### Scenario: bash resolves via PATH on a system with Git-for-Windows

- **WHEN** `registry.resolve("bash")` runs on `win32`
- **AND** Git-for-Windows is installed so `bash.exe` is on PATH
- **THEN** the `where` strategy SHALL succeed
- **AND** `Resolution.path` SHALL be the absolute path returned by `ToolResolver.which("bash")`
- **AND** `Resolution.source` SHALL equal `"system"`

#### Scenario: bash resolves via PATH on macOS or Linux

- **WHEN** `registry.resolve("bash")` runs on `darwin` or `linux`
- **AND** `/bin/bash` (or a PATH entry resolving `bash`) exists
- **THEN** the `where` strategy SHALL succeed
- **AND** `Resolution.source` SHALL equal `"system"`

#### Scenario: bash not found on a host without Git-for-Windows or WSL on PATH

- **WHEN** `registry.resolve("bash")` runs on a host where no override is set, no managed install holds `bash`, and `bash` is not on PATH
- **THEN** every strategy SHALL record `{ ok: false, reason: <descriptive string> }`
- **AND** `Resolution.ok` SHALL be `false`
- **AND** `Resolution.path` SHALL be `null`

#### Scenario: bash override wins over PATH

- **WHEN** a user has registered an override for `"bash"` pointing to an existing file
- **THEN** the `override` strategy SHALL succeed
- **AND** `Resolution.source` SHALL equal `"override"`
- **AND** subsequent strategies SHALL NOT run

### Requirement: `ToolDefinition.installHints` carries OS-conditional install guidance
`ToolDefinition` SHALL accept an optional `installHints?: InstallHints` field. The registry SHALL treat `installHints` as opaque metadata — it SHALL NOT influence resolution. The field SHALL be surfaced verbatim by `registry.list()` and by any REST endpoint that exposes per-tool data.

The data model SHALL be:

```ts
interface InstallHints {
  darwin?: PlatformInstallHint;
  win32?:  PlatformInstallHint;
  linux?:  PlatformInstallHint;
  docsAnchor?: string;
}
interface PlatformInstallHint {
  commands?: Record<string, string>;
  manual?: string;
  url?: string;
  /** When true, an eligible auto-run of this hint requires per-invocation confirmation (network fetch / image build). */
  requiresConfirm?: boolean;
}
```

#### Scenario: bash registration ships install hints for every supported OS

- **WHEN** the registry exposes the `bash` definition via `list()` or `/api/tools`
- **THEN** the definition SHALL include `installHints` with non-empty entries for `darwin`, `win32`, AND `linux`
- **AND** the bash `win32` entry SHALL list at least one of `winget`, `choco`, `scoop` in `commands`
- **AND** the bash `darwin` entry MAY use `manual: "Pre-installed on macOS"` instead of `commands` (bash ships with macOS)
- **AND** the bash `linux` entry MAY use `manual` similarly (bash ships with all mainstream distributions)

#### Scenario: every user-installable binary tool ships install hints
- **WHEN** the registry exposes its definitions
- **THEN** the definitions for `bash`, `gh`, `zrok`, `git`, AND `node` SHALL each include `installHints` for `darwin`, `win32`, AND `linux`
- **AND** every populated `PlatformInstallHint` SHALL declare at least one of `commands`, `manual`, or `url`

#### Scenario: media tools ship install hints and mark network+exec hints
- **WHEN** the registry exposes the `ffmpeg`, `ffprobe`, `imagemagick`, and `chromium` definitions
- **THEN** each SHALL include `installHints` for the host OS
- **AND** a hint that performs a network fetch or image build (e.g. `chromium`'s `npx playwright install chromium`) MAY set `requiresConfirm: true`

#### Scenario: platform-utility tools do NOT ship install hints

- **WHEN** the registry exposes its definitions
- **THEN** the definitions for `wmic`, `powershell`, `tasklist`, `taskkill`, `ps`, `pgrep`, AND `wt` SHALL NOT include `installHints`
- **AND** the absence of `installHints` SHALL NOT cause UI errors — consumers MUST treat the field as optional

#### Scenario: installHints does not affect resolve()
- **WHEN** `registry.resolve(name)` is called for any tool with `installHints` set
- **THEN** the resulting `Resolution.ok`, `Resolution.path`, `Resolution.source`, and `Resolution.tried` SHALL be identical to what they would be for the same tool without `installHints` set
- **AND** `installHints` SHALL NOT appear in the `Resolution` shape (it is carried separately by `list()`)

### Requirement: `docsAnchor` references a real FAQ section

When a `ToolDefinition.installHints.docsAnchor` value is set, the project FAQ (`docs/faq.md`) SHALL contain a matching anchor.

#### Scenario: docsAnchor matches FAQ header anchors

- **WHEN** the lint test scans `definitions.ts` for `docsAnchor` values
- **THEN** every non-empty value SHALL correspond to a heading anchor present in `docs/faq.md`
- **AND** missing anchors SHALL cause the lint test to fail with the offending tool name and anchor

### Requirement: `!`/`!!` chat-escape resolves bash through the registry

The bridge extension's `!`/`!!` chat-escape (`packages/extension/src/command-handler.ts`) SHALL resolve the shell binary via `registry.resolve("bash")` instead of spawning the literal string `"sh"`.

#### Scenario: happy-path spawn uses the resolved absolute path

- **WHEN** the user types `!ls` and `registry.resolve("bash")` returns `{ ok: true, path: "/usr/bin/bash" }`
- **THEN** the handler SHALL invoke `pi.exec("/usr/bin/bash", ["-c", "ls"], …)` (or equivalent — the exact API call MUST use the absolute path)
- **AND** the handler SHALL NOT pass the literal string `"sh"` or `"bash"` to the spawn API

#### Scenario: missing bash emits a structured error, does not spawn

- **WHEN** the user types `!ls` and `registry.resolve("bash")` returns `{ ok: false }`
- **THEN** the handler SHALL emit a chat event with payload `{ kind: "missing-tool", toolName: "bash" }`
- **AND** the handler SHALL NOT invoke `pi.exec` (the spawn call SHALL be skipped, not attempted-then-caught)

#### Scenario: Unix-headless sh wrapper explicitly NOT migrated

- **WHEN** auditors review the proposal scope
- **THEN** the Unix-headless spawn that wraps `pi` in `sh -c "tail -f /dev/null | pi"` (built in the platform spawn machinery under `packages/shared/src/platform/`) SHALL retain the literal `"sh"`
- **AND** this exception SHALL be documented in `design.md` as a deliberate non-target (POSIX `/bin/sh` is the correct contract for that wrapper)

### Requirement: REST `/api/tools` includes `installHints`

The REST `/api/tools` endpoint SHALL include each tool's `installHints` (when set) in its response payload.

#### Scenario: tool list response carries installHints

- **WHEN** a client requests `GET /api/tools`
- **THEN** the response SHALL include per-row `installHints` for tools that declare it
- **AND** the field SHALL be omitted (not set to `null` or `{}`) for tools that do not declare it
- **AND** the absence of `installHints` SHALL NOT change any other field in the row

### Requirement: Settings → Tools renders an Install dropdown on missing rows

The Settings → Tools UI (`packages/client/src/components/ToolsSection.tsx`) SHALL render an `[Install ▾]` dropdown for any tool row where `Resolution.ok === false` AND the tool's `installHints` declares an entry for the host OS.

#### Scenario: missing tool with hints renders the dropdown

- **WHEN** a tool resolves with `ok: false` AND `installHints[hostOs]` is set
- **THEN** the row SHALL render an `[Install ▾]` button
- **AND** opening the dropdown SHALL list every `commands` entry, every `manual` text (display-only), and a `[Read more in docs ↗]` link when `docsAnchor` is set

#### Scenario: per-OS filtering

- **WHEN** the host OS is `win32`
- **THEN** the dropdown SHALL show entries from `installHints.win32` only
- **AND** SHALL NOT show entries from `installHints.darwin` or `installHints.linux`

#### Scenario: found tool does not render the dropdown

- **WHEN** a tool resolves with `ok: true`
- **THEN** the row SHALL NOT render the `[Install ▾]` dropdown regardless of `installHints` content

#### Scenario: copy-to-clipboard per command

- **WHEN** the user clicks the copy button next to a command entry
- **THEN** the command text SHALL be written to the clipboard via `navigator.clipboard.writeText`
- **AND** the UI SHALL provide a textarea fallback when the clipboard API is unavailable (non-secure context)

### Requirement: Missing-tool inline chat error renders a deep-link

A `MissingToolError` chat payload SHALL render via a `MissingToolInlineError` component that includes an actionable `[Install <toolName> →]` link.

#### Scenario: deep-link navigates and scrolls into view

- **WHEN** the user clicks `[Install bash →]` in an inline chat error
- **THEN** the application SHALL navigate to the Settings → Tools view
- **AND** the matching row (DOM id `tool-row-bash`) SHALL be scrolled into view
- **AND** the row's `[Install ▾]` dropdown SHALL open automatically

#### Scenario: payload contains only the tool name

- **WHEN** the bridge extension emits a `MissingToolError`
- **THEN** the payload SHALL include `kind: "missing-tool"` and `toolName: string` ONLY
- **AND** the payload SHALL NOT embed `installHints` (the client reads live hints via `/api/tools`)

### Requirement: Node-wrapped spawns to the Electron binary always run as Node

When a spawn's `argv[0]` is the host `process.execPath` and that interpreter is the Electron binary (the triply-degraded `execpath-fallback` topology: server on the Electron binary, no managed runtime `node`, no PATH `node`), **every** spawn-env builder that produces the env for that spawn SHALL set `ELECTRON_RUN_AS_NODE=1` on the child env. This SHALL hold for both node-wrapped executor argv (`[<electron-binary>, cli.js]` from `resolveExecutor("pi")`) and the RPC keeper's own launch argv (`[<electron-binary>, keeper.cjs]`). No spawn-env builder SHALL strip `ELECTRON_RUN_AS_NODE` for such an argv. When a real `node` resolves (bundled, managed, or on PATH), `argv[0]` is that real `node`, the requirement is inert, and the spawn path SHALL NOT add `ELECTRON_RUN_AS_NODE`.

Scope note: spawn sites that pass `pi` as a shell token (`spawnTmux`, `spawnWslTmux` via `buildTmuxCommand`) are NOT node-wrapped and are outside this requirement.

#### Scenario: spawnWt pi argv spawned as Node

- **WHEN** no real `node` is resolvable and `spawnWt` resolves the pi executor argv to `[<electron-binary>, cli.js]`, whose env is built by `process-manager.buildSpawnEnv`
- **THEN** the built child env SHALL contain `ELECTRON_RUN_AS_NODE=1`, so pi runs as Node instead of re-launching the Electron GUI and exiting on the single-instance lock

#### Scenario: spawnHeadless keeper and pi argv spawned as Node

- **WHEN** no real `node` is resolvable and `spawnHeadless` routes through the RPC keeper, which spawns its own `[<electron-binary>, keeper.cjs]` (`nodeBinary = process.execPath`) and forwards the pi argv `[<electron-binary>, cli.js]` via `PI_KEEPER_PI_CMD`, all under the `process-manager.buildSpawnEnv`-stripped env
- **THEN** the keeper's launch env AND the forwarded pi spawn env SHALL each contain `ELECTRON_RUN_AS_NODE=1`
- **AND** neither the keeper process nor the pi child SHALL re-launch the Electron GUI

#### Scenario: Env builders agree — no strip-without-readd divergence

- **WHEN** the same Electron-binary `argv[0]` is passed to `process-manager.buildSpawnEnv` (with argv) and to `runner.buildSpawnEnvForArgv`
- **THEN** both SHALL yield an env containing `ELECTRON_RUN_AS_NODE=1`, and neither SHALL leave it stripped for that argv

#### Scenario: Healthy install adds no Electron flag via the spawn path

- **WHEN** a real `node` (bundled, managed, or on PATH) resolves and the node-wrap yields `[<real node>, cli.js]`
- **THEN** the spawn path SHALL NOT add `ELECTRON_RUN_AS_NODE`, and the non-Electron spawn env SHALL be byte-identical to current behavior

### Requirement: Node-script executor argv assembly is fully injectable under test

The Node-script `toArgv` transform (`nodeScriptToArgv`) and its JS-entry resolution (`resolveJsScript`) SHALL be drivable entirely from injected dependencies. When a test supplies interpreter (`execPath`) and filesystem (`exists`/`realpath`) seams, `resolveExecutor(...)` SHALL NOT read live machine state — no `process.execPath` fallback and no `realpathSync` against the real filesystem. The runtime defaults SHALL remain `process.execPath` and real `realpathSync`, so production resolution behavior is unchanged on every platform. Executor resolution SHALL therefore be deterministic regardless of the host machine's installed applications (`/Applications/PI-Dashboard.app`) or `PATH` (`~/.pi-dashboard/node`).

#### Scenario: Executor argv under mocked packaged-Electron layout does not leak real paths

- **WHEN** a test resolves `resolveExecutor("npm")` against a mocked packaged-Electron registry (injected `exists` for `BUNDLED_NPM`, injected `execPath`/`realpath` seams) on a developer machine that has the packaged app installed and a managed `node` on `PATH`
- **THEN** the resolved `argv` SHALL equal `[BUNDLED_NPM]`
- **AND** the resolved `argv` SHALL contain no real-filesystem path (`/Applications/PI-Dashboard.app`, `~/.pi-dashboard/node`) sourced from `process.execPath` or `realpathSync`

#### Scenario: Runtime default interpreter and realpath preserved

- **WHEN** no `execPath` or `realpath` seam is injected (normal runtime)
- **THEN** `nodeScriptToArgv` SHALL fall back to `process.execPath` and `resolveJsScript` SHALL use real `realpathSync`, exactly as before this change
- **AND** healthy packaged-Electron resolution SHALL short-circuit at `bundledNodeStrategy("node")` before reaching the interpreter fallback, so the Electron spawn path is unaffected

### Requirement: Node-script executors spawn without shebang interpreter dependency

Managed Node-script executors (`openspec`, `pi`) SHALL be spawnable without relying on a `#!/usr/bin/env node` shebang finding a `node` binary on the child process's PATH. The registry's `toArgv` for these executors SHALL supply the Node interpreter explicitly (resolving the `.js` entry point plus a resolved `node`), OR the spawn environment SHALL be guaranteed to contain a real `node` bin directory. This behavior SHALL hold on unix (macOS/Linux) with parity to the existing Windows node-wrap, so a GUI-launched (Electron) server with a stripped PATH can still execute the CLI.

#### Scenario: Unix openspec spawn with a stripped child PATH

- **WHEN** the dashboard server spawns `openspec` on unix from a process whose PATH contains no binary named `node` (e.g. an Electron-launched server under `ELECTRON_RUN_AS_NODE`)
- **THEN** the resolved spawn argv SHALL invoke a real `node` interpreter against the resolved `bin/openspec.js` (not the bare `.bin/openspec` shebang symlink), OR the spawn env SHALL include a real `node` bin directory
- **AND** the CLI SHALL execute successfully instead of failing with exit 127 / `env: node: No such file or directory`

#### Scenario: Windows node-wrap parity preserved

- **WHEN** the same executor is resolved on Windows to a `.js` entry point
- **THEN** the existing `[node.exe, script.js]` node-wrap SHALL remain in effect with no regression

### Requirement: `defaultResolveModule` SHALL order its strategies `createRequire → dir-walk → ESM resolve`

`defaultResolveModule` — the default module resolver behind `bareImportStrategy`
— SHALL attempt resolution in this order, falling through on failure:

1. `createRequire(from).resolve(id)` — CJS resolver, `"require"` condition.
2. `resolvePackageEntryByDirWalk(id, from)` — filesystem walk for
   `node_modules/<id>/package.json`, entry derived from
   `exports["."]` (`"import"` / `"default"`) `?? module ?? main`.
3. `import.meta.resolve(id)` — ESM resolver, `"import"` condition, anchored at
   this module's URL. Only a `file:` result is accepted; anything else falls
   through to `null`.

The ESM step SHALL be **last**, and SHALL be understood as an **inert guard**:
retained for shape-correctness and defence in depth, not because it is expected
to fire. It is specified as unreachable-in-practice rather than as a live
fallback, and no requirement below depends on it producing a value.

Two independent facts make it unreachable today, both verified against source:

- **The dir-walk and the ESM step share an anchor.** The ESM step resolves
  against *this module's* `import.meta`, ignoring `from`; the dir-walk walks from
  `from`. They coincide because the **sole** production caller of
  `defaultResolveModule` — `bareImportStrategy` at `definitions.ts:290` — lets
  `anchor` default to `import.meta.url` (`strategies.ts:468`). Both steps
  therefore search the same `node_modules` chain from the same origin, and if the
  package is absent from that chain, both fail.
  (`definitions.ts:333` and `:697` also call something named `resolveModule`, but
  it is their own `createRequire` wrapper with no dir-walk and no ESM step — they
  never reach `defaultResolveModule`. An earlier draft cited them in support of
  this argument; they are irrelevant to it, and had they reached it they would
  have *broken* the shared anchor, since they pass `definitions.ts`'s
  `import.meta.url`.)
- **The dir-walk almost never returns `null`.**
  `readEntryFromPackageJson` computes
  `fromExports ?? json.module ?? json.main ?? "index.js"` (`strategies.ts:150`),
  so once the manifest is found the result is always a string and the following
  `typeof rel !== "string"` guard can never fire. The dir-walk yields `null` only
  for an unparseable manifest, a non-`file:` anchor, a package missing from the
  walk, or a package directory present **without** a `package.json`
  (`existsSync` at `strategies.ts:136` gates the read).

  Of those, only the first and third also defeat the ESM step. The requirement
  does **not** claim the ESM step fails in every case — an earlier draft did, and
  it was self-contradictory: the ESM step ignores `from`, so a non-`file:` anchor
  breaks the dir-walk while leaving the ESM step able to resolve. Likewise a
  package directory with no manifest resolves under Node's legacy index lookup
  but returns `null` from the dir-walk. Unreachability rests on the preconditions
  below, not on an exhaustive-failure claim.

Both facts are **contingent, not structural**, and the requirement records the
preconditions so a future change cannot silently void them:

- `bareImportStrategy` exports a public `anchor` parameter. A future caller
  passing a non-default anchor would make the dir-walk search that tree while the
  ESM step still searches this module's — the anchors diverge and unreachability
  no longer holds.
- The `from` anchor must be a valid `file:` URL. A non-`file:` anchor makes the
  dir-walk bail at `strategies.ts:119-123` while the ESM step, which ignores
  `from`, still resolves — the guard fires.
- The package must ship a `package.json`. A package directory without one is
  resolvable by Node's legacy index lookup but yields `null` from the dir-walk's
  `existsSync` gate — the guard fires.
- Unreachability holds for **bare package specifiers only**. For a subpath id
  (`pkg/sub`) the dir-walk's literal `node_modules/<id>/package.json` join does
  not exist, so it returns `null`, while `import.meta.resolve("pkg/sub")` can
  resolve a subpath export — a genuine case where the guard fires. Today every
  registered id is a bare package name, but this change's own reasoning leans on
  the registry being extensible, so the precondition is stated rather than
  assumed.

Any change that registers a subpath id, or passes a non-default `anchor`, SHALL
re-evaluate the inert-guard requirement and the preemption scenario below before
landing.

The order is therefore justified by **behaviour preservation**, not by capability:
the dir-walk already answers every step-1 miss in production today (the ESM step
has never executed, because this module is itself loaded through jiti's
`data:`-URL ESM fallback, where `import.meta.resolve` of a bare specifier throws
`ERR_UNSUPPORTED_RESOLVE_REQUEST`). Keeping the dir-walk ahead of the ESM step
preserves that exact behaviour. Placing the newly-repaired ESM step first would
hand every lookup to a resolver that has never run in production.

That caution is warranted because the two resolvers demonstrably disagree on
package shape: a package with no `exports` but a `module` field resolves to
`main` under ESM and to `module` under the dir-walk; a package whose
`exports["."]` nests `node` / `default` resolves to the `node` entry under ESM
and to the `default` entry under the dir-walk; a package whose `exports`
declares subpaths but no `"."` throws under ESM and resolves via `main` under
the dir-walk.

**Known pre-existing defect, deliberately not fixed here.** Because the entry
defaults to `"index.js"` with **no existence check**, the dir-walk can return a
path that is not on disk — specifically when a manifest declares neither a
usable `exports["."]`, nor `module`, nor `main`. (An earlier draft attributed
this to the `exports`-without-`"."` shape the current doc-comment cites; that is
imprecise — that shape falls through to `module ?? main` and usually resolves
correctly. The defect is the unchecked final fallback, not the missing `"."`.)
Correcting it changes live resolution behaviour and is out of scope for this
change, which is confined to making the module CJS-transpilable. It is recorded
so the next reader does not mistake the inert guard for its mitigation.

#### Scenario: No resolution that succeeds today changes value

- **GIVEN** any package that `defaultResolveModule` resolves to a path before
  this change
- **WHEN** `defaultResolveModule(id, from)` is called after the reorder
- **THEN** it SHALL return the identical path
- **AND** the assertion SHALL compare against paths captured from the
  pre-change chain, not against the post-change implementation's own output

#### Scenario: The inert ESM guard does not preempt a later strategy

- **GIVEN** `bareImportStrategy` runs ahead of `managedModuleStrategy` and
  `npmGlobalStrategy` in the chain assembled at `definitions.ts:290-292`
- **WHEN** `defaultResolveModule` returns a non-`null` path
- **THEN** `bareImportStrategy` SHALL report success and the managed-module and
  npm-global strategies SHALL NOT run
- **AND** therefore a `null` becoming a hit is NOT unconditionally an
  improvement — it suppresses strategies that would otherwise have been consulted
- **AND** because the ESM guard is unreachable (see above), this preemption
  SHALL NOT occur as a result of this change
- **AND** any future change that makes the ESM step reachable SHALL re-evaluate
  this scenario before landing

#### Scenario: Live registry packages resolve identically before and after

- **GIVEN** `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`, whose
  manifests expose `exports: { ".": { types, import } }` and therefore fail
  step 1
- **WHEN** `defaultResolveModule` is called for each
- **THEN** step 2 SHALL resolve `./dist/index.js` for both
- **AND** the resolved path SHALL equal the path resolved by the pre-change chain

#### Scenario: A throwing or non-`file:` ESM step is contained, not propagated

- **WHEN** step 3 throws, or returns a URL whose scheme is not `file:`
- **THEN** the error SHALL be caught at the call site
- **AND** `defaultResolveModule` SHALL return `null` to the caller
- **AND** SHALL NOT propagate the error
- **NOTE** the assertion of record is error containment; the `null` return is
  also the natural terminus of the chain, so a test that only asserts `null`
  would pass even if the guard were removed, and SHALL therefore assert that no
  exception escapes

### Requirement: The ESM step SHALL be written as a direct `import.meta.resolve(id)` call

Step 3 SHALL call `import.meta.resolve(id)` directly inside a `try`. It SHALL
NOT route the access through a TypeScript cast such as
`(import.meta as unknown as { resolve?: … }).resolve`, and SHALL NOT gate the
call behind a `typeof` probe.

The call shape is load-bearing, not stylistic: jiti erases `import.meta` only
when the member expression's `object.type` is `MetaProperty`. A cast makes it
`TSAsExpression`, the erasure is skipped, and the surviving `import.meta` forces
jiti's native-ESM fallback and its `data:` URL hand-off. See the
`jiti-cjs-transpile-safety` capability. Whether the property is *called* is
irrelevant — an uncalled `import.meta.resolve` is erased correctly; only the cast
defeats it.

A `typeof` probe is unnecessary because the surrounding `try` already routes a
missing or throwing resolver to the same `null` outcome. No workspace in this
repo declares an `engines` floor that guarantees `import.meta.resolve`
(`packages/shared` and `packages/extension` declare none; the repo root declares
`>=22.19.0 <27`), so the probe was never the thing providing safety — the
`catch` was.

The doc-comment at this call site SHALL record the constraint, and SHALL NOT
repeat two claims previously asserted there and since disproved: that the
synchronous `import.meta.resolve` cannot take a parent specifier (Node 20.6+
accepts a second argument; declining to pass `from` is a deliberate choice), and
that an engines floor of `>=22.12` applies.

#### Scenario: The module stays CJS-transpilable

- **WHEN** `strategies.ts` is passed through jiti's `transform()` in CommonJS mode
- **THEN** the emitted source SHALL contain `jitiESMResolve(`
- **AND** SHALL retain no `import.meta` in code position
- **AND** SHALL therefore not trigger jiti's native-ESM fallback

#### Scenario: Reintroducing the cast is caught

- **WHEN** the direct call is rewritten as a cast-wrapped member access
- **THEN** the `jiti-cjs-transpile-safety` gate SHALL fail naming this file

### Requirement: Skill-package tool manifest ingestion

The registry SHALL ingest a `pi.tools` array declared in a skill package's
`package.json` (additive sibling to `pi.skills`/`pi.extensions`). Each entry SHALL
be `{ id, probe, optional? }` — a tool id, a probe kind, and an optional flag
(default `false`). An entry SHALL NOT carry any install command or shell string;
install recipes remain first-party `installHints` on the registry definition. Each
`id` SHALL be validated against `^[A-Za-z0-9_][A-Za-z0-9._-]*$` (uppercase +
underscore permitted so an `env`-kind id is the environment-variable name). When
`id` matches an existing `ToolDefinition` it is referenced; otherwise a definition
is synthesized from the probe kind plus a catalog `installHints` lookup. A
manifest entry whose `probe` differs from the referenced definition's kind SHALL
be accepted as-is — the existing definition wins and the manifest probe is
documentation, not a re-classification.

#### Scenario: Skill tool referencing an existing definition

- **WHEN** a skill's `package.json` declares `pi.tools: [{ "id": "ffmpeg", "probe": "resolve", "optional": true }]`
- **AND** `ffmpeg` is a registered `ToolDefinition`
- **THEN** the entry resolves through that definition's strategy chain
- **AND** `optional` is carried as `true`.

#### Scenario: Manifest entry rejects an install string

- **WHEN** a `pi.tools` entry contains any key other than `id`/`probe`/`optional`
  (e.g. an inline command or `provide`)
- **THEN** ingestion SHALL reject the entry, naming it.

#### Scenario: Invalid tool id is rejected

- **WHEN** a `pi.tools` entry's `id` contains a character outside `^[A-Za-z0-9_][A-Za-z0-9._-]*$`
  (e.g. `npm:@scope/pkg` — the `:` and `@`)
- **THEN** ingestion SHALL reject the entry.

#### Scenario: Uppercase env-var id is accepted

- **WHEN** a `pi.tools` entry declares `{ "id": "SONIOX_API_KEY", "probe": "env" }`
- **THEN** the id SHALL pass validation (uppercase + underscore are permitted).

#### Scenario: Skill without pi.tools is untouched

- **WHEN** a skill package declares no `pi.tools`
- **THEN** no ingestion occurs and registry behavior is unchanged.

### Requirement: Credential (`env`) probe kind

The registry SHALL support a probe kind `env` that determines presence by whether
a named environment variable is set. The probe SHALL return only a boolean
presence in `Resolution.ok` and SHALL NOT read, print, or log the variable's
value. On absence the recommendation SHALL reference the variable name and any
`installHints.url`/`manual` only.

#### Scenario: Present env var resolves ok without exposing value

- **WHEN** a tool with `probe: "env"` for `SONIOX_API_KEY` is resolved and the
  variable is set
- **THEN** `Resolution.ok` SHALL be `true`
- **AND** the variable's value SHALL NOT appear in `Resolution` or any log.

#### Scenario: Missing env var recommends by name only

- **WHEN** the variable is unset
- **THEN** `Resolution.ok` SHALL be `false`
- **AND** the recommendation SHALL name the variable and SHALL NOT include a value.

#### Scenario: Presence is not asserted valid

- **WHEN** the variable is set
- **THEN** the registry SHALL record presence only and SHALL NOT claim the
  credential is valid.

### Requirement: Docker-image and Playwright-browser probe kinds

The registry SHALL support probe kinds `docker-image` (presence via image
availability, e.g. `docker image inspect`) and `pw-browser` (presence of a
Playwright-managed browser in its cache directory). Both SHALL be implemented as
strategies so each attempt is recorded in `Resolution.tried`, and both SHALL
degrade to the definition's `installHints` on absence. `docker-image` SHALL NOT
assume Docker is present — an unavailable Docker daemon yields
`{ ok: false, reason }` and the next strategy/hint applies.

#### Scenario: Missing docker image degrades to hint, does not assume docker

- **WHEN** a `docker-image` tool is resolved on a host where the image is absent
  or the Docker daemon is unavailable
- **THEN** `Resolution.ok` SHALL be `false` with a reason in `tried[]`
- **AND** the definition's `installHints` SHALL be the recommendation.

#### Scenario: Playwright browser present resolves ok

- **WHEN** a `pw-browser` tool for `chromium` is resolved and the browser exists
  in the Playwright cache directory
- **THEN** `Resolution.ok` SHALL be `true`.

### Requirement: Media tools registered with static-npm strategies

The registry SHALL register `ffmpeg`, `ffprobe`, `imagemagick`, and `chromium`
with `probe`/strategy chains and per-OS `installHints`. `ffmpeg` SHALL resolve via
a chain `override → static-npm(ffmpeg-static) → where`, where the NEW `static-npm`
strategy reads the binary path a package exports — either a bare string export
(`require("ffmpeg-static")`) or the `.path` of an object export
(`require("@ffprobe-installer/ffprobe").path`) — distinct from `bare-import`, which
returns a package dir / JS entry, so that `registry.resolve("ffmpeg")` — not a bare
PATH check — reports presence. `ffprobe` SHALL have its own `static-npm` strategy
sourced from a package that ships ffprobe (`ffmpeg-static` does not). `imagemagick`
and `chromium` SHALL be resolvable and carry `installHints`.

#### Scenario: ffmpeg resolves the static-npm path

- **WHEN** `ffmpeg-static` is installed and `registry.resolve("ffmpeg")` runs
- **THEN** `Resolution.ok` SHALL be `true`
- **AND** `Resolution.path` SHALL be the binary path exported by `require("ffmpeg-static")`
- **AND** `Resolution.source` SHALL equal `"static-npm"`.

#### Scenario: ffprobe has an independent resolution path

- **WHEN** `registry.resolve("ffprobe")` runs
- **THEN** it SHALL NOT depend on `ffmpeg-static` (which ships no ffprobe)
- **AND** SHALL resolve via its own strategy or fall through to `installHints`.

#### Scenario: ffmpeg absent falls through to hint

- **WHEN** neither `ffmpeg-static` nor a PATH `ffmpeg` is present
- **THEN** `Resolution.ok` SHALL be `false`
- **AND** the `ffmpeg` `installHints` SHALL be the recommendation.

### Requirement: `ensureTools` library and CLI `ensure` verb

The registry SHALL expose `ensureTools(tools, opts): Promise<EnsureReport>` where
`EnsureReport = { ok, tools: Array<Resolution & { optional, action }> }` and
`action ∈ { present, recommended, installed, degraded, blocked }`. A required
missing tool SHALL yield `action: "blocked"` and `ok: false` **without throwing**.
A TS-backed skill CLI SHALL expose an `ensure` verb that reads a package's
`pi.tools`, prints the report, and exits `0` when all required tools are
present/installed, non-zero when a required tool is missing; a `--json`
invocation SHALL always exit `0` with the outcome in the payload. This `ensure`
CLI SHALL be distinct from the build-time `pi-dashboard-resolve-tool.cjs` (which
remains self-contained, no-transpiler, path-only) because the
`env`/`docker-image`/`pw-browser` strategies are TypeScript registry code the
`.cjs` cannot execute.

#### Scenario: Required missing tool blocks without throwing

- **WHEN** `ensureTools` evaluates a required tool that is absent and no auto-install runs
- **THEN** the report SHALL contain that tool with `action: "blocked"`
- **AND** `EnsureReport.ok` SHALL be `false`
- **AND** no exception SHALL be thrown.

#### Scenario: Optional missing tool degrades

- **WHEN** an optional tool is absent
- **THEN** its report entry SHALL have `action: "degraded"`
- **AND** it SHALL NOT set `EnsureReport.ok` to `false`.

#### Scenario: CLI ensure exit code

- **WHEN** the TS `ensure` CLI runs against a package whose `pi.tools` has a missing required tool
- **THEN** the process SHALL exit non-zero
- **AND** the equivalent `--json` invocation SHALL exit `0` with the outcome encoded.

### Requirement: Opt-in auto-run executes first-party hints only

The registry SHALL default to recommend-only. Auto-run SHALL require an explicit
opt-in (`ensureTools(..., { autoInstall: true })` / CLI `--install`) and SHALL
execute ONLY a resolved `installHints.commands[pkgmgr]` value — a first-party,
code-reviewed string from the registry definition. A skill manifest SHALL NEVER
contribute the executed string. Hints that perform a network fetch or image build
SHALL be marked `PlatformInstallHint.requiresConfirm: true` on the first-party
definition (the registry SHALL NOT regex-sniff command strings) and SHALL require
a per-invocation confirmation even under opt-in. First-party definitions whose
network+exec hints live in `manual` (e.g. `chromium`, `pi-doc-engine`) SHALL
still set `requiresConfirm: true` so a future `commands` entry inherits the
gate.

#### Scenario: Default run never installs

- **WHEN** `ensureTools` runs without `autoInstall`
- **AND** a tool is missing
- **THEN** its entry SHALL be `action: "recommended"`
- **AND** no install command SHALL execute.

#### Scenario: Opt-in runs a first-party hint

- **WHEN** `autoInstall` is set and a missing tool has an `installHints.commands`
  entry for the host package manager
- **THEN** the registry MAY execute that first-party command
- **AND** the executed string SHALL originate from the registry definition, never
  from a skill manifest.

#### Scenario: Network+exec hint requires confirmation

- **WHEN** an eligible hint is marked `requiresConfirm: true`
- **AND** `autoInstall` is set
- **THEN** the registry SHALL require an explicit per-invocation confirmation
  before executing.

#### Scenario: requiresConfirm hint auto-denied in a non-interactive context

- **WHEN** `ensure --install` runs on a headless host (no TTY)
- **AND** a missing tool's eligible hint is marked `requiresConfirm: true`
- **THEN** the registry SHALL NOT execute the hint (auto-deny)
- **AND** the tool's report entry SHALL be `action: "blocked"` when required or
  `action: "degraded"` when optional
- **AND** the CLI SHALL exit non-zero when the tool was required.

### Requirement: Ingested skill tools surface through existing tool APIs and UI

A tool ingested from a skill's `pi.tools` SHALL be surfaced by the same
surfaces as a built-in tool once registered: `registry.list()`, `GET /api/tools`,
and the Settings→Tools UI (including the `[Install ▾]` dropdown on a missing row
with `installHints` for the host OS). No separate reporting path SHALL be
required.

#### Scenario: Ingested skill tool appears in list()/api

- **WHEN** a skill package with `pi.tools: [{ "id": "ffmpeg", "probe": "resolve" }]`
  is loaded and `registry.list()` (or `GET /api/tools`) is queried
- **THEN** the response SHALL include an `ffmpeg` row with its `Resolution` and
  `installHints`.

#### Scenario: Missing ingested skill tool renders the Install dropdown

- **WHEN** an ingested skill tool resolves `ok: false` AND declares
  `installHints[hostOs]`
- **THEN** the Settings→Tools row SHALL render the `[Install ▾]` dropdown,
  identically to a built-in missing tool.
### Requirement: A rejected override is indicated on unresolved rows

The Settings → Tools status badge SHALL indicate a rejected override on rows where
the tool did NOT resolve, not only on rows that resolved via a fallback strategy. A
row whose override was rejected SHALL be visually distinguishable from a row that was
never configured, without requiring the user to expand it.

Existing surfaces are unchanged and SHALL NOT be re-implemented: the inline expanded
warning, the full `tried[]` trail (which already carries the offending path), and the
`ToolListEntry` / `/api/tools` payload. Fall-through behaviour is likewise unchanged
(see "Invalid override falls through").

#### Scenario: rejected override on a not-found row is distinguishable

- **WHEN** a tool has an override that recorded `invalid: <reason>` AND no later strategy resolved the tool
- **THEN** the collapsed row's status badge SHALL render a THIRD state, distinct from BOTH the ordinary not-found state AND the existing rejected-but-fell-back state
- **AND** the indicator's tooltip SHALL name the rejected path
- **AND** the three states SHALL be mutually distinguishable without expanding the row

#### Scenario: indicator wording distinguishes fell-back from did-not-resolve

- **WHEN** the rejected-override indicator is rendered on a row that did NOT resolve
- **THEN** its tooltip SHALL NOT claim a fallback was used
- **AND** a row that DID resolve via a later strategy SHALL retain its existing fallback wording

#### Scenario: unparseable rejection reason still yields an indicator

- **WHEN** the `invalid:` reason recorded for the override does not contain an extractable path (the registry's `validate` demotion path records `invalid: <validator reason>`, which carries no path guarantee, unlike `overrideStrategy`'s `invalid: path does not exist: <p>`)
- **THEN** the badge SHALL still indicate a rejected override
- **AND** the tooltip SHALL degrade to the reason text rather than rendering an empty or malformed path

#### Scenario: rejected override on a resolved row keeps its existing indicator

- **WHEN** a tool has a rejected override AND a later strategy resolved it
- **THEN** the existing fallback indicator SHALL continue to be shown
- **AND** its behaviour SHALL NOT change

#### Scenario: not-found row without an override is unchanged

- **WHEN** a tool fails to resolve and no override entry exists for it
- **THEN** the badge SHALL render the ordinary not-found state
- **AND** SHALL NOT suggest an override was involved
