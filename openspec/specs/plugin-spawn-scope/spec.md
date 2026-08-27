# plugin-spawn-scope Specification

## Purpose
TBD - created by archiving change add-plugin-spawn-scope. Update Purpose after archive.
## Requirements
### Requirement: `PluginSpawnOptions` exposes a typed `scope` block

`PluginSpawnOptions` (in `dashboard-plugin-runtime`) SHALL expose an optional `scope` block that lets a spawning plugin declare the spawned session's tool, skill, and extension surface. The block SHALL carry these optional fields:

- `tools?: string[]` — tool allowlist
- `excludeTools?: string[]` — tool denylist
- `noBuiltinTools?: boolean` — disable built-in tools only
- `noTools?: boolean` — disable all tools
- `skills?: string[]` — explicit skill paths to load
- `noSkills?: boolean` — disable skill discovery
- `extensions?: string[]` — explicit extension paths to load (additive; discovery still runs)
- `extensionConfig?: Record<string, Record<string, string | string[]>>` — per-extension config (scalar or array values; arrays are JSON-encoded at the env boundary)

The block SHALL NOT expose a `noExtensions` / `--no-extensions` toggle: disabling extension discovery would prevent the dashboard bridge extension from loading, severing the spawned session's control channel (see the control-channel requirement below).

The `scope` block and every field within it SHALL be optional.

#### Scenario: Scope block is omitted
- **WHEN** a plugin calls `spawnSession` without a `scope` block
- **THEN** the spawned pi argv SHALL be byte-identical to the argv produced before this capability existed
- **AND** the spawned process env SHALL contain no `PI_EXT_*` variables introduced by this capability

#### Scenario: Partial scope block
- **WHEN** a plugin sets only `scope.tools` and leaves every other `scope` field absent
- **THEN** only the `--tools` flag SHALL be added to the argv
- **AND** no skill, extension, or built-in-tool flags SHALL be emitted

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

Each scope field SHALL be emitted only when present (non-empty for array fields, `true` for boolean fields). An empty array SHALL emit no flag.

#### Scenario: Allowlist fields are comma-joined
- **WHEN** `scope.tools` is `["read", "grep", "ls"]`
- **THEN** the argv SHALL contain `--tools` immediately followed by the single argument `read,grep,ls`

#### Scenario: Repeatable fields emit one flag per path
- **WHEN** `scope.skills` is `["/a/skill.md", "/b/skill.md"]`
- **THEN** the argv SHALL contain `--skill /a/skill.md` and `--skill /b/skill.md` as separate flag/value pairs

#### Scenario: Extension paths repeat the `-e` flag
- **WHEN** `scope.extensions` is `["/x/ext.js", "/y/ext.js"]`
- **THEN** the argv SHALL contain `-e /x/ext.js` and `-e /y/ext.js` as separate flag/value pairs

#### Scenario: Boolean toggles emit bare flags
- **WHEN** `scope.noTools` is `true` and `scope.noSkills` is `true`
- **THEN** the argv SHALL contain `--no-tools` and `--no-skills`

#### Scenario: Empty array emits no flag
- **WHEN** `scope.tools` is `[]`
- **THEN** no `--tools` flag SHALL be added to the argv

#### Scenario: Conflicting fields are both forwarded
- **WHEN** `scope.noTools` is `true` and `scope.tools` is `["read"]`
- **THEN** both `--no-tools` and `--tools read` SHALL be forwarded to pi
- **AND** the mapper SHALL NOT reject or silently drop either field

### Requirement: Scope restrictions preserve the dashboard control channel

No `scope` field SHALL be able to prevent the spawned session's dashboard bridge extension from loading and registering. Because the bridge is loaded via pi's extension **discovery**, the `scope` block SHALL NOT offer a discovery-disable toggle (`--no-extensions`); the `extensions` allowlist is additive and leaves discovery — and therefore the bridge — intact. A spawned session SHALL remain dashboard-controllable (able to register and be aborted) under any combination of `scope` fields.

#### Scenario: Restricting tools leaves the session registrable
- **WHEN** a plugin spawns with `scope.noTools: true`
- **THEN** the spawned session SHALL still load the dashboard bridge and register with the server (the bridge control channel does not depend on model-facing tools)

#### Scenario: No discovery-disable toggle exists
- **WHEN** a plugin inspects the `scope` block type
- **THEN** there SHALL be no field that maps to pi's `--no-extensions`

### Requirement: `extensionConfig` is projected to namespaced env on the headless spawn

On the headless plugin-spawn mechanism (the only mechanism `spawnSession` uses), the host SHALL project each `scope.extensionConfig[name][key]` entry into the spawned process env as a variable named `PI_EXT_<NAME>_<KEY>`, where `<NAME>` and `<KEY>` are the extension name and config key normalized to a valid POSIX env-var identifier by uppercasing and replacing every character outside `[A-Z0-9_]` with `_`.

A config value MAY be a `string` or a `string[]`. A `string` value SHALL be projected **verbatim** as the env value. A `string[]` value SHALL be projected as its **JSON encoding** (`JSON.stringify(value)`) as the env value; the consuming extension `JSON.parse`s the value for keys it knows to be array-typed. This encoding SHALL be lossless for values containing characters unsafe for a delimiter-join convention (filesystem paths, commas, spaces): a `string[]` round-tripped through the env and `JSON.parse` SHALL deep-equal the original array. `extensionConfig` SHALL NOT contribute any pi argv element. Routing `scope` through a tmux mechanism would require per-window `-e` env injection (as the spawn-token already does) and is out of scope for this change, since plugin spawns are headless-only.

#### Scenario: Config entry becomes a namespaced env var
- **WHEN** `scope.extensionConfig` is `{ "myext": { "token": "abc" } }`
- **THEN** the spawned process env SHALL contain `PI_EXT_MYEXT_TOKEN=abc`
- **AND** no argv element SHALL be derived from `extensionConfig`

#### Scenario: Names and keys are normalized to valid env identifiers
- **WHEN** `scope.extensionConfig` is `{ "my-ext": { "api.key": "v" } }`
- **THEN** the spawned process env SHALL contain `PI_EXT_MY_EXT_API_KEY=v`

#### Scenario: Array value is JSON-encoded into env
- **WHEN** `scope.extensionConfig` is `{ "guard": { "allowedRoots": ["/a", "/b,c", " /d "] } }`
- **THEN** the spawned process env SHALL contain `PI_EXT_GUARD_ALLOWED_ROOTS` whose value is `JSON.stringify(["/a", "/b,c", " /d "])`
- **AND** `JSON.parse` of that value SHALL deep-equal the original array (lossless round-trip, no delimiter ambiguity for paths)

#### Scenario: Scalar and array values coexist under one extension
- **WHEN** `scope.extensionConfig` is `{ "guard": { "token": "abc", "allowedRoots": ["/a"] } }`
- **THEN** the env SHALL contain `PI_EXT_GUARD_TOKEN=abc` (scalar verbatim) and `PI_EXT_GUARD_ALLOWED_ROOTS=["/a"]` (array JSON-encoded)

#### Scenario: extensionConfig absent leaves env untouched
- **WHEN** `scope.extensionConfig` is absent
- **THEN** the spawned process env SHALL contain no `PI_EXT_*` variable introduced by this capability

### Requirement: `PluginSpawnOptions → SessionOptions` mapping is an extractable pure function

The inline `PluginSpawnOptions → SessionOptions` mapping in the `spawnSession` hook SHALL be extracted into an exported pure function `pluginSpawnToSessionOptions(opts: PluginSpawnOptions): SessionOptions` so the field forwarding is unit-testable in isolation, and the `spawnSession` hook SHALL delegate to it.

#### Scenario: Mapper forwards existing fields unchanged
- **WHEN** `pluginSpawnToSessionOptions` receives `{ cwd, model }` with no `scope`
- **THEN** the returned `SessionOptions` SHALL carry the same `model` and produce the same argv as the prior inline literal

#### Scenario: Mapper forwards scope fields
- **WHEN** `pluginSpawnToSessionOptions` receives a `scope` block
- **THEN** the returned `SessionOptions` SHALL carry each `scope.*` field through to `sessionFlagsToArgv` (argv fields) and `buildSpawnEnv` (`extensionConfig`)

### Requirement: The mapper is total and sanitizes untrusted input

`pluginSpawnToSessionOptions` SHALL be total — it SHALL NOT throw for any input a plugin can supply at runtime (plugin code is JavaScript; TypeScript types are not enforced at runtime), including malformed containers (`scope`, or any array/record field, supplied as `null`, an array, or a non-object primitive). It SHALL defensively sanitize:
- Every string it forwards to **argv** (`tools`, `excludeTools`, `skills`, `extensions` entries) SHALL be dropped if it is not a non-empty string OR contains a NUL character (a NUL in any argv element crashes `spawn`).
- Every `extensionConfig` entry SHALL be dropped if the outer/inner container is not a plain object, or the value is neither a string nor an array of strings, or the name/value contains a NUL character. Within a `string[]` value, individual elements that are not non-empty strings or that contain a NUL SHALL be dropped; if no valid elements remain, the entry SHALL be dropped.
- A non-array array-field or non-object record-field SHALL be treated as absent rather than iterated.

The `spawnSession` hook SHALL call `pluginSpawnToSessionOptions` BEFORE enqueuing any `automationRun` stamp, so a malformed-input rejection cannot strand a pending stamp keyed by `cwd`.

#### Scenario: Non-string allowlist entries are dropped
- **WHEN** `scope.tools` contains a non-string or empty-string entry alongside valid tool names
- **THEN** the mapper SHALL drop the invalid entries and emit `--tools` with only the valid names, without throwing

#### Scenario: NUL in an argv-bound string is dropped
- **WHEN** a `skills`, `extensions`, or `tools` entry contains a NUL character
- **THEN** that entry SHALL be dropped and the spawn SHALL proceed without it, rather than crashing

#### Scenario: Env value with NUL is dropped
- **WHEN** an `extensionConfig` value contains a NUL character
- **THEN** that entry SHALL be dropped and the spawn SHALL proceed without it, rather than crashing

#### Scenario: Malformed container is treated as absent
- **WHEN** `scope.extensionConfig` is `null`, an array, or a primitive (not a plain object)
- **THEN** the mapper SHALL treat it as absent and SHALL NOT throw

#### Scenario: Mapping precedes automationRun enqueue
- **WHEN** the `spawnSession` hook processes options carrying both `automationRun` and a `scope` block
- **THEN** it SHALL compute the `SessionOptions` via `pluginSpawnToSessionOptions` before enqueuing the `automationRun` stamp

