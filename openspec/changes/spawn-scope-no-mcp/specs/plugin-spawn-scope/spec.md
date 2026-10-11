## MODIFIED Requirements

### Requirement: `PluginSpawnOptions` exposes a typed `scope` block

`PluginSpawnOptions` (in `dashboard-plugin-runtime`) SHALL expose an optional `scope` block that lets a spawning plugin declare the spawned session's tool, skill, extension, and system-prompt surface. The block SHALL carry these optional fields:

- `tools?: string[]` — tool allowlist
- `excludeTools?: string[]` — tool denylist
- `noBuiltinTools?: boolean` — disable built-in tools only
- `noTools?: boolean` — disable all tools
- `skills?: string[]` — explicit skill paths to load
- `noSkills?: boolean` — disable skill discovery
- `extensions?: string[]` — explicit extension paths to load (additive; discovery still runs)
- `extensionConfig?: Record<string, Record<string, string | string[]>>` — per-extension config (scalar or array values; arrays are JSON-encoded at the env boundary)
- `appendSystemPrompt?: string[]` — absolute paths of files appended to the system prompt
- `noContextFiles?: boolean` — disable `AGENTS.md` / `CLAUDE.md` context-file discovery
- `noProjectTrust?: boolean` — ignore trust-gated project-local configuration and resources for the spawned process
- `sessionDir?: string` — absolute directory the spawned session's file is written to
- `noMcp?: boolean` — disable pi's built-in MCP support for the spawned process (no server connects, no MCP tool is registered)

The block SHALL NOT expose a `noExtensions` / `--no-extensions` toggle: disabling extension discovery would prevent the dashboard bridge extension from loading, severing the spawned session's control channel (see the control-channel requirement below).

The `scope` block and every field within it SHALL be optional.

#### Scenario: Scope block is omitted
- **WHEN** a plugin calls `spawnSession` without a `scope` block
- **THEN** the spawned pi argv SHALL be byte-identical to the argv produced before this capability existed
- **AND** the spawned process env SHALL contain no `PI_EXT_*` variables introduced by this capability

#### Scenario: Partial scope block
- **WHEN** a plugin sets only `scope.tools` and leaves every other `scope` field absent
- **THEN** only the `--tools` flag SHALL be added to the argv
- **AND** no skill, extension, built-in-tool, system-prompt, context-file, project-trust, session-dir or MCP flags SHALL be emitted

#### Scenario: A tools allowlist alone does not remove MCP tools
- **WHEN** a plugin sets `scope.tools` to `["read"]` and leaves `scope.noMcp` absent
- **THEN** the argv SHALL contain `--tools read` and SHALL NOT contain `--no-mcp` (on pi ≥ 1.0.4 that session keeps pi's MCP tools; a plugin that needs none sets `scope.noMcp: true`)

### Requirement: Scope fields map 1:1 to pi CLI capability flags

The spawn chain SHALL forward every `scope.*` field through `pluginSpawnToSessionOptions` → `SessionOptions` → `SessionFlags` → `sessionFlagsToArgv` to the spawned pi argv, using the following mapping:

| scope field | pi flag | argv shape |
|---|---|---|
| `tools` | `--tools` | single comma-joined argument |
| `excludeTools` | `--exclude-tools` | single comma-joined argument |
| `noBuiltinTools` | `--no-builtin-tools` | boolean flag |
| `noTools` | `--no-tools` | boolean flag |
| `skills` | `--skill <path>` | repeated once per path |
| `noSkills` | `--no-skills` | boolean flag |
| `extensions` | `-e <path>` | repeated once per path |
| `appendSystemPrompt` | `--append-system-prompt <path>` | repeated once per path |
| `noContextFiles` | `--no-context-files` | boolean flag |
| `noProjectTrust` | `--no-approve` | boolean flag |
| `sessionDir` | `--session-dir <path>` | single flag/value pair |
| `noMcp` | `--no-mcp` | boolean flag |

Each scope field SHALL be emitted only when present (non-empty for array fields, `true` for boolean fields). An empty array SHALL emit no flag. `appendSystemPrompt`, `noContextFiles`, `noProjectTrust`, `sessionDir` and `noMcp` SHALL NOT be read or changed by cwd-policy composition (as with `extensions`).

#### Scenario: Allowlist fields are comma-joined
- **WHEN** `scope.tools` is `["read", "grep", "ls"]`
- **THEN** the argv SHALL contain `--tools` immediately followed by the single argument `read,grep,ls`

#### Scenario: Repeatable fields emit one flag per path
- **WHEN** `scope.skills` is `["/a/skill.md", "/b/skill.md"]`
- **THEN** the argv SHALL contain `--skill /a/skill.md` and `--skill /b/skill.md` as separate flag/value pairs

#### Scenario: Extension paths repeat the `-e` flag
- **WHEN** `scope.extensions` is `["/x/ext.js", "/y/ext.js"]`
- **THEN** the argv SHALL contain `-e /x/ext.js` and `-e /y/ext.js` as separate flag/value pairs

#### Scenario: Appended prompt files repeat the flag
- **WHEN** `scope.appendSystemPrompt` is `["/t/persona.md"]`
- **THEN** the argv SHALL contain `--append-system-prompt /t/persona.md`

#### Scenario: Boolean toggles emit bare flags
- **WHEN** `scope.noTools`, `scope.noSkills`, `scope.noContextFiles` and `scope.noProjectTrust` are `true`
- **THEN** the argv SHALL contain `--no-tools`, `--no-skills`, `--no-context-files` and `--no-approve`

#### Scenario: Empty array emits no flag
- **WHEN** `scope.tools` is `[]`
- **THEN** no `--tools` flag SHALL be added to the argv

#### Scenario: Conflicting fields are both forwarded
- **WHEN** `scope.noTools` is `true` and `scope.tools` is `["read"]`
- **THEN** both `--no-tools` and `--tools read` SHALL be forwarded to pi
- **AND** the mapper SHALL NOT reject or silently drop either field

#### Scenario: noMcp emits the bare flag
- **WHEN** `scope.noMcp` is `true`
- **THEN** the argv SHALL contain `--no-mcp`

#### Scenario: noMcp false or non-boolean emits nothing
- **WHEN** `scope.noMcp` is `false`, `"true"` or `1`
- **THEN** the argv SHALL NOT contain `--no-mcp`
