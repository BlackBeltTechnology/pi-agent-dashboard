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

The block SHALL NOT expose a `noExtensions` / `--no-extensions` toggle: disabling extension discovery would prevent the dashboard bridge extension from loading, severing the spawned session's control channel (see the control-channel requirement below).

The `scope` block and every field within it SHALL be optional.

#### Scenario: Scope block is omitted
- **WHEN** a plugin calls `spawnSession` without a `scope` block
- **THEN** the spawned pi argv SHALL be byte-identical to the argv produced before this capability existed
- **AND** the spawned process env SHALL contain no `PI_EXT_*` variables introduced by this capability

#### Scenario: Partial scope block
- **WHEN** a plugin sets only `scope.tools` and leaves every other `scope` field absent
- **THEN** only the `--tools` flag SHALL be added to the argv
- **AND** no skill, extension, built-in-tool, system-prompt, context-file, project-trust or session-dir flags SHALL be emitted

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

Each scope field SHALL be emitted only when present (non-empty for array fields, `true` for boolean fields). An empty array SHALL emit no flag. `appendSystemPrompt`, `noContextFiles`, `noProjectTrust` and `sessionDir` SHALL NOT be read or changed by cwd-policy composition (as with `extensions`).

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

### Requirement: The mapper is total and sanitizes untrusted input

`pluginSpawnToSessionOptions` SHALL be total — it SHALL NOT throw for any input a plugin can supply at runtime (plugin code is JavaScript; TypeScript types are not enforced at runtime), including malformed containers (`scope`, or any array/record field, supplied as `null`, an array, or a non-object primitive). It SHALL defensively sanitize:
- Every string it forwards to **argv** (`tools`, `excludeTools`, `skills`, `extensions`, `appendSystemPrompt` entries, `sessionDir`) SHALL be dropped if it is not a non-empty string OR contains a NUL character (a NUL in any argv element crashes `spawn`). An `appendSystemPrompt` entry SHALL additionally be dropped unless it is an absolute path, because pi treats a non-existent path argument as literal prompt text. A `sessionDir` that is not an absolute path SHALL be treated as absent.
- Every `extensionConfig` entry SHALL be dropped if the outer/inner container is not a plain object, or the value is neither a string nor an array of strings, or the name/value contains a NUL character. Within a `string[]` value, individual elements that are not non-empty strings or that contain a NUL SHALL be dropped; if no valid elements remain, the entry SHALL be dropped.
- A non-array array-field or non-object record-field SHALL be treated as absent rather than iterated; a non-boolean boolean field SHALL be treated as absent.

The `spawnSession` hook SHALL call `pluginSpawnToSessionOptions` BEFORE enqueuing any `automationRun` stamp, so a malformed-input rejection cannot strand a pending stamp keyed by `cwd`.

#### Scenario: Non-string allowlist entries are dropped
- **WHEN** `scope.tools` contains a non-string or empty-string entry alongside valid tool names
- **THEN** the mapper SHALL drop the invalid entries and emit `--tools` with only the valid names, without throwing

#### Scenario: NUL in an argv-bound string is dropped
- **WHEN** a `skills`, `extensions`, `tools` or `appendSystemPrompt` entry contains a NUL character
- **THEN** that entry SHALL be dropped and the spawn SHALL proceed without it, rather than crashing

#### Scenario: Session directory is forwarded
- **WHEN** `scope.sessionDir` is `"/s/--repo--"`
- **THEN** the argv SHALL contain `--session-dir /s/--repo--`
- **AND** a relative or empty `sessionDir` SHALL emit no `--session-dir`

#### Scenario: Relative prompt path is dropped
- **WHEN** `scope.appendSystemPrompt` is `["persona.md"]`
- **THEN** no `--append-system-prompt` flag SHALL be emitted

#### Scenario: Env value with NUL is dropped
- **WHEN** an `extensionConfig` value contains a NUL character
- **THEN** that entry SHALL be dropped and the spawn SHALL proceed without it, rather than crashing

#### Scenario: Malformed container is treated as absent
- **WHEN** `scope.extensionConfig` is `null`, an array, or a primitive (not a plain object)
- **THEN** the mapper SHALL treat it as absent and SHALL NOT throw

#### Scenario: Mapping precedes automationRun enqueue
- **WHEN** the `spawnSession` hook processes options carrying both `automationRun` and a `scope` block
- **THEN** it SHALL compute the `SessionOptions` via `pluginSpawnToSessionOptions` before enqueuing the `automationRun` stamp
