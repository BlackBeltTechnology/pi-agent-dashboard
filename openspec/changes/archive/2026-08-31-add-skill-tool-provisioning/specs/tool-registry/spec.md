## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Skill-package tool manifest ingestion

The registry SHALL ingest a `pi.tools` array declared in a skill package's
`package.json` (additive sibling to `pi.skills`/`pi.extensions`). Each entry SHALL
be `{ id, probe, optional? }` — a tool id, a probe kind, and an optional flag
(default `false`). An entry SHALL NOT carry any install command or shell string;
install recipes remain first-party `installHints` on the registry definition. Each
`id` SHALL be validated against `^[A-Za-z0-9_][A-Za-z0-9._-]*$` (uppercase +
underscore permitted so an `env`-kind id is the environment-variable name). When
`id` matches an existing `ToolDefinition` it is referenced; otherwise a definition
is synthesized from the probe kind plus a catalog `installHints` lookup.

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
a per-invocation confirmation even under opt-in.

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
