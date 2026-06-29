# tool-registry Specification

## Purpose

Single-source resolver for every external binary, module, and directory the dashboard depends on. The registry replaces ad-hoc `which`/`require.resolve`/hardcoded-path lookups across the codebase with a unified `ToolRegistry` service that runs an ordered strategy chain per tool, caches the result, records a diagnostic trail of attempted strategies, and supports user-supplied per-tool path overrides.
## Requirements
### Requirement: Central tool registry service
The dashboard SHALL expose a single `ToolRegistry` service in `@blackbelt-technology/pi-dashboard-shared/tool-registry` that resolves every external binary, module, and directory the dashboard depends on. The registry SHALL expose `resolve(name)`, `resolveModule(name)`, `rescan(name?)`, `list()`, `setOverride(name, path)`, and `clearOverride(name)` operations.

#### Scenario: Resolve a registered binary
- **WHEN** a caller invokes `registry.resolve("pi")`
- **THEN** the registry SHALL return a `Resolution` object containing `{ name, ok, path, source, tried, resolvedAt }`
- **AND** `path` SHALL be absolute when `ok` is `true`, else `null`

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

#### Scenario: node strategy chain

- **WHEN** `registry.resolve("node")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bundled-node` (`<resourcesPath>/node/bin/node` Unix / `\node\node.exe` Windows), `managedRuntime` (`<managedDir>/node/bin/node` Unix / `\node\node.exe` Windows), `managedBin` (`<managedDir>/node_modules/.bin/node`), `where` (delegating to `ToolResolver.which("node")`)

#### Scenario: npm strategy chain

- **WHEN** `registry.resolveExecutor("npm")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bundled-node` (`<resourcesPath>/node/bin/npm` Unix / `\node\npm.cmd` Windows), `managedRuntime`, `managedBin`, `where`

#### Scenario: npx strategy chain

- **WHEN** `registry.resolve("npx")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bundled-node` (`<resourcesPath>/node/bin/npx` Unix / `\node\npx.cmd` Windows), `managed` (`MANAGED_BIN/npx`), `where` (delegating to `ToolResolver.which("npx")`)

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
Each `Resolution.source` SHALL be one of: `"override"`, `"managed"`, `"system"`, `"npm-global"`, `"bare-import"`, `"bundled"`, or `null`. The value SHALL be determined by the strategy that succeeded, not by re-analyzing the resolved path.

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

**Already registered — not in this delta**: `npx` is already a registered binary tool (`npxBinaryDef`) with a bundled-Node-aware chain (`override → bundledNode → managedBin → where`), landed by the archived `fix-node-resolution-under-electron` change. This proposal does not modify the `npx` registration.

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

