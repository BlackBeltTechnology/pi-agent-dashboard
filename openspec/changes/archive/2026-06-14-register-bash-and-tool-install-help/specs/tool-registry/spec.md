## ADDED Requirements

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
- **THEN** the definitions for `bash`, `jj`, `gh`, `zrok`, `git`, AND `node` SHALL each include `installHints` for `darwin`, `win32`, AND `linux`
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

## MODIFIED Requirements

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
