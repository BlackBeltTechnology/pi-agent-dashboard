## ADDED Requirements

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
The registry SHALL ship with definitions for at minimum: `pi` (binary), `pi-coding-agent` (module), `openspec` (binary), `npm` (binary), `node` (binary), `tsx` (binary), `git` (binary), and `zrok` (binary). Each definition SHALL declare an ordered strategy chain and a `classify` function mapping resolved paths to `source` values.

#### Scenario: pi strategy chain
- **WHEN** `registry.resolve("pi")` runs
- **THEN** strategies SHALL be tried in order: `override`, `managed` (`MANAGED_BIN/pi.cmd` on Windows, `MANAGED_BIN/pi` elsewhere), `where` (delegating to `ToolResolver.which("pi")`)

#### Scenario: pi-coding-agent strategy chain
- **WHEN** `registry.resolveModule("pi-coding-agent")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bare-import` (`import("@mariozechner/pi-coding-agent")`), `managed` (`~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent/dist/index.js`), `npm-global` (`<npm root -g>/@mariozechner/pi-coding-agent/dist/index.js`)
- **AND** a sibling strategy SHALL also probe `@oh-my-pi/pi-coding-agent` under both managed and npm-global paths

### Requirement: Source classification
Each `Resolution.source` SHALL be one of: `"override"`, `"managed"`, `"system"`, `"npm-global"`, `"bare-import"`, or `null`. The value SHALL be determined by the strategy that succeeded, not by re-analyzing the resolved path.

#### Scenario: Managed install classifies as managed
- **WHEN** the `managed` strategy succeeds for any tool
- **THEN** `Resolution.source` SHALL equal `"managed"`

#### Scenario: PATH resolution classifies as system
- **WHEN** the `where` strategy (backed by `ToolResolver.which`) succeeds and the resolved path does not start with `MANAGED_BIN`
- **THEN** `Resolution.source` SHALL equal `"system"`
