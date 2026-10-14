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
- `agentDir?: string` — absolute path of a plugin-owned pi agent directory the spawned process uses instead of the operator's agent directory

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
- **AND** the spawned env SHALL NOT contain `PI_CODING_AGENT_DIR` or `PI_DASHBOARD_ISOLATED` set by this capability

#### Scenario: A tools allowlist alone does not remove MCP tools
- **WHEN** a plugin sets `scope.tools` to `["read"]` and leaves `scope.noMcp` absent
- **THEN** the argv SHALL contain `--tools read` and SHALL NOT contain `--no-mcp` (on pi ≥ 1.0.4 that session keeps pi's MCP tools; a plugin that needs none sets `scope.noMcp: true`)

### Requirement: Scope restrictions preserve the dashboard control channel

No `scope` field SHALL be able to prevent the spawned session's dashboard bridge extension from loading and registering. Because the bridge is loaded via pi's extension **discovery**, the `scope` block SHALL NOT offer a discovery-disable toggle (`--no-extensions`); the `extensions` allowlist is additive and leaves discovery — and therefore the bridge — intact. When `scope.agentDir` redirects discovery to a directory whose settings do not list the bridge, the host SHALL load the bridge explicitly by appending `-e <bridge entry file>` to the argv, where the entry file is the first `pi.extensions` entry of the bridge package located at the host's boot-resolved bridge directory — never the package directory itself (which would also load the bridge package's skills) and never a plugin-supplied value. The pair SHALL be appended on the headless plugin-spawn path after the shared argv builder, and SHALL NOT be duplicated when `scope.extensions` already names the same file. A spawned session SHALL remain dashboard-controllable (able to register and be aborted) under any combination of `scope` fields.

#### Scenario: Restricting tools leaves the session registrable
- **WHEN** a plugin spawns with `scope.noTools: true`
- **THEN** the spawned session SHALL still load the dashboard bridge and register with the server (the bridge control channel does not depend on model-facing tools)

#### Scenario: No discovery-disable toggle exists
- **WHEN** a plugin inspects the `scope` block type
- **THEN** there SHALL be no field that maps to pi's `--no-extensions`

#### Scenario: Isolated agent dir still loads the bridge
- **WHEN** a plugin spawns with a valid `scope.agentDir` whose `settings.json` lists no packages
- **THEN** the argv SHALL contain exactly one `-e <bridge entry file>` pair
- **AND** the spawned session SHALL register with the server and be abortable from it
- **AND** none of the bridge package's declared skills SHALL be loaded

#### Scenario: Bridge entry is not duplicated
- **WHEN** an isolated spawn's `scope.extensions` already contains the bridge entry file path
- **THEN** the argv SHALL contain that path in exactly one `-e` pair

#### Scenario: Unresolvable bridge refuses the isolated spawn
- **WHEN** a plugin spawns with a valid `scope.agentDir` and the host has no resolved bridge directory or the package declares no extension entry
- **THEN** the spawn SHALL be refused with result code `agent_dir_bridge_unresolved`
- **AND** no pi process SHALL be started

### Requirement: Scope fields map 1:1 to pi CLI capability flags

The spawn chain SHALL forward every argv-bound `scope.*` field through `pluginSpawnToSessionOptions` → `SessionOptions` → `SessionFlags` → `sessionFlagsToArgv` to the spawned pi argv, using the following mapping. `extensionConfig` and `agentDir` are env-bound (see their own requirements) and are not pi flags:

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

Each scope field SHALL be emitted only when present (non-empty for array fields, `true` for boolean fields). An empty array SHALL emit no flag. `appendSystemPrompt`, `noContextFiles`, `noProjectTrust`, `sessionDir`, `noMcp` and `agentDir` SHALL NOT be read or changed by cwd-policy composition (as with `extensions`).

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

#### Scenario: agentDir emits no pi flag of its own
- **WHEN** a plugin sets a valid `scope.agentDir`
- **THEN** no `--agent-dir`-style flag SHALL be emitted; its argv effects are limited to the host-forced isolation flags and the bridge `-e` pair

### Requirement: `PluginSpawnOptions → SessionOptions` mapping is an extractable pure function

The inline `PluginSpawnOptions → SessionOptions` mapping in the `spawnSession` hook SHALL be extracted into an exported pure function `pluginSpawnToSessionOptions(opts: PluginSpawnOptions): MappedSpawnOptions` (where `MappedSpawnOptions` extends `SessionFlags` with `strategy`, `extensionConfig`, `agentDir` and `agentDirInvalid`, a structural superset of `SessionOptions`) so the field forwarding is unit-testable in isolation, and the `spawnSession` hook SHALL delegate to it.

#### Scenario: Mapper forwards existing fields unchanged
- **WHEN** `pluginSpawnToSessionOptions` receives `{ cwd, model }` with no `scope`
- **THEN** the returned `MappedSpawnOptions` SHALL carry the same `model` and produce the same argv as the prior inline literal

#### Scenario: Mapper forwards scope fields
- **WHEN** `pluginSpawnToSessionOptions` receives a `scope` block
- **THEN** the returned `MappedSpawnOptions` SHALL carry each `scope.*` field through to `sessionFlagsToArgv` (argv fields) and `buildSpawnEnv` (`extensionConfig`, `agentDir`)

### Requirement: The mapper is total and sanitizes untrusted input

`pluginSpawnToSessionOptions` SHALL be total — it SHALL NOT throw for any input a plugin can supply at runtime (plugin code is JavaScript; TypeScript types are not enforced at runtime), including malformed containers (`scope`, or any array/record field, supplied as `null`, an array, or a non-object primitive). It SHALL defensively sanitize:
- Every string it forwards to **argv** (`tools`, `excludeTools`, `skills`, `extensions`, `appendSystemPrompt` entries, `sessionDir`) SHALL be dropped if it is not a non-empty string OR contains a NUL character (a NUL in any argv element crashes `spawn`). An `appendSystemPrompt` entry SHALL additionally be dropped unless it is an absolute path, because pi treats a non-existent path argument as literal prompt text. A `sessionDir` that is not an absolute path SHALL be treated as absent.
- Every `extensionConfig` entry SHALL be dropped if the outer/inner container is not a plain object, or the value is neither a string nor an array of strings, or the name/value contains a NUL character. Within a `string[]` value, individual elements that are not non-empty strings or that contain a NUL SHALL be dropped; if no valid elements remain, the entry SHALL be dropped.
- A non-array array-field or non-object record-field SHALL be treated as absent rather than iterated; a non-boolean boolean field SHALL be treated as absent.
- `agentDir` is the one exception to drop-on-invalid: when `scope` is present but not a plain object, or the `agentDir` key is present with any value other than `undefined`, the mapper SHALL carry an isolation request to the host — a non-empty NUL-free string as `agentDir`, anything else (including a malformed `scope` container) as `agentDirInvalid: true` — never dropping it, because treating it as absent would run the session in the operator's environment. The host then validates it and refuses the spawn with `agent_dir_invalid` (see the `agentDir` requirement).

The `spawnSession` hook SHALL call `pluginSpawnToSessionOptions` BEFORE enqueuing any `automationRun` stamp, so a malformed-input rejection cannot strand a pending stamp keyed by `cwd`. `agentDir` validation SHALL likewise complete before the stamp is enqueued.

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

#### Scenario: Malformed agentDir is flagged, not dropped
- **WHEN** `scope.agentDir` is `null`, a number, an empty string, or contains a NUL
- **THEN** the mapper SHALL NOT throw and SHALL flag `agentDir` invalid
- **AND** the spawn SHALL be refused with `agent_dir_invalid` before any `automationRun` stamp is enqueued

## ADDED Requirements

### Requirement: `agentDir` selects a host-enforced isolated spawn, fail-closed

A plugin spawn whose `scope.agentDir` is valid SHALL run as an **isolated spawn**.

**Operator tree.** The operator tree SHALL be the canonical operator agent dir — computed exactly as pi computes it from the dashboard server's own environment: the value of `PI_CODING_AGENT_DIR` when set (normalized as pi normalizes it, including `~` expansion to the home directory), else `<os.homedir()>/.pi/agent` — together with the canonical `<os.homedir()>/.pi`, **excluding** the spawning plugin's own data directory (`~/.pi/dashboard/plugins/<pluginId>/`), which is the sanctioned place for a plugin to provision agent dirs. Canonical paths SHALL use native realpath when the path exists and lexical resolution when it does not, the repository's case-insensitive-filesystem rule (the helper cwd-policy matching uses), and a path-separator-aware prefix test. A path is **outside the operator tree** when it is neither equal to, an ancestor of, nor a descendant of any operator-tree path; a path inside the spawning plugin's own data directory is outside the operator tree. Paths inside another plugin's data directory are not.

**Validity.** `agentDir` is valid only when it is a string without NUL, is absolute, exists, is a directory whose realpath succeeds, and is outside the operator tree. In isolated mode the spawn `cwd` and every plugin-supplied path (`scope.sessionDir`, `scope.extensions`, `scope.skills`, `scope.appendSystemPrompt` entries) SHALL also be outside the operator tree.

**Refusal.** Validation SHALL run in the `spawnSession` hook after mapping and before any pending registry entry, initial prompt or credential is filed, and SHALL read the raw options for combination checks, treating a key whose value is `undefined` as absent. The spawn SHALL be refused — `PluginSpawnResult` `{ success: false, code }`, no pi process started — when:
- `agentDir` is present but invalid, or `scope` is present, not `null`, and not a plain object → `agent_dir_invalid`
- the `cwd` or a plugin-supplied path is inside the operator tree in isolated mode → `isolated_path_invalid`
- a valid `agentDir` is combined with `resume` (including `null`), any `mode` other than `"local"`, or `initialPrompt` → `agent_dir_unsupported_combo` (`agent` + `scope` is already refused by the ACP road before this validation)
- 256 isolated spawns are already live (spawned and not yet ended or revoked) → `agent_dir_capacity`
- the bridge entry file cannot be resolved or does not exist → `agent_dir_bridge_unresolved`. The bridge directory SHALL be resolved per spawn from the same source non-isolated spawns load it from (the dashboard bridge package registered in the operator's pi settings), so an overlay switch is honoured.

**Forced containment.** For an isolated spawn the host SHALL, regardless of the other `scope` fields:
- emit `--no-builtin-tools`, `--exclude-tools` containing at least `read,bash,edit,write,grep,find,ls` (unioned with the plugin's `excludeTools`, so an allowlist naming a built-in cannot re-activate it), `--no-context-files`, `--no-approve` and `--no-skills` (skills listed in `scope.skills` and tools registered by the plugin's own extensions remain available);
- merge the cwd policy without its `skills` (see `host-cwd-policy`);
- apply no spawn-env contributor (see `plugin-spawn-env-contributor`);
- build the env by first reducing the server env to this allowlist, matched case-insensitively on Windows (`LC_*` is a prefix match): `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `LC_*`, `TZ`, `TMPDIR`, `TMP`, `TEMP`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`, and on Windows `SystemRoot`, `windir`, `ComSpec`, `PATHEXT`, `USERPROFILE`, `USERNAME`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`; then applying the host's existing shaping unchanged (resolved-runtime `PATH` prepend, Electron `argv0` `ELECTRON_RUN_AS_NODE` rule, bridge control variables `PI_DASHBOARD_BRIDGE`, `PI_DASHBOARD_URL`, `PI_DASHBOARD_REQUIRE_SERVER_PROOF`, `PI_DASHBOARD_SOCKET`, `PI_DASHBOARD_SPAWN_TOKEN` under their existing conditions); then adding `PI_DASHBOARD_SPAWN_CREDENTIAL` (see `pi-gateway-auth`), `PI_EXT_*` from `scope.extensionConfig`, `PI_CODING_AGENT_DIR=<agentDir>` and `PI_DASHBOARD_ISOLATED=1`. No other server-env variable SHALL reach the child.

**Registration and attestation.** The isolated bridge SHALL report `isolated: true` in its registration. The server SHALL terminate a session registered under an isolated spawn's token whose registration does not report `isolated: true`, and SHALL ignore the flag on any registration not correlated to an isolated spawn. The server SHALL NOT deliver a cwd-keyed pending initial prompt to a session registered under an isolated spawn's token. Isolated sessions follow the existing ownership rule (`session-ownership-scoping`): ownerless unless a trusted owned-spawn road stamps an owner.

The hook SHALL return `isolated: true` for a successful isolated spawn and propagate `code` on refusal; every other spawn SHALL return `isolated` absent or `false`. A non-isolated spawn SHALL remove any inherited `PI_DASHBOARD_ISOLATED` from its env. An isolated session's files SHALL be written under `<agentDir>/sessions` unless `scope.sessionDir` is set. Bridge-entry de-duplication against `scope.extensions` SHALL compare canonical paths.

#### Scenario: Valid agentDir produces an isolated spawn
- **WHEN** a plugin spawns with `scope.agentDir` set to an existing absolute directory outside the operator tree, in a cwd outside it
- **THEN** the env SHALL contain `PI_CODING_AGENT_DIR` equal to that path, `PI_DASHBOARD_ISOLATED=1` and `PI_DASHBOARD_SPAWN_TOKEN`
- **AND** the argv SHALL contain `--no-builtin-tools`, `--no-context-files`, `--no-approve`, `--no-skills` and an `--exclude-tools` value containing `read,bash,edit,write,grep,find,ls`
- **AND** the result SHALL carry `success: true` and `isolated: true`, and the session SHALL register

#### Scenario: Allowlisted built-in cannot be re-enabled
- **WHEN** an isolated spawn sets `scope.tools: ["read", "kb_search"]`
- **THEN** the session SHALL expose `kb_search` (registered by the plugin's extension) and SHALL NOT expose `read`

#### Scenario: Relative agentDir refuses the spawn
- **WHEN** a plugin spawns with `scope.agentDir: "agents/customer"`
- **THEN** the result SHALL be `{ success: false, code: "agent_dir_invalid" }` and no pi process SHALL start

#### Scenario: Missing directory refuses the spawn
- **WHEN** `scope.agentDir` is absolute but does not exist
- **THEN** the result SHALL carry `code: "agent_dir_invalid"`

#### Scenario: Malformed scope container refuses the spawn
- **WHEN** a plugin passes `scope` as a string, an array or a number
- **THEN** the result SHALL carry `code: "agent_dir_invalid"` and no pi process SHALL start
- **AND** `scope: null` SHALL be treated as absent

#### Scenario: Operator tree reached by symlink, case variant or the dashboard dir is refused
- **WHEN** `scope.agentDir` is a symlink to the operator agent dir, a case variant of it on a case-insensitive filesystem, a directory inside it, or a directory inside `~/.pi/dashboard`
- **THEN** the result SHALL carry `code: "agent_dir_invalid"`

#### Scenario: Operator agent dir from a tilde env value
- **WHEN** the server env has `PI_CODING_AGENT_DIR=~/x`
- **THEN** the host SHALL compute the operator agent dir as `<home>/x`, equal to pi's own resolution of that value

#### Scenario: Agent dir inside the plugin's own data dir is accepted
- **WHEN** plugin `web-chat` spawns with `scope.agentDir` under `~/.pi/dashboard/plugins/web-chat/users/<hash>/agent`
- **THEN** the spawn SHALL NOT be refused for the operator tree
- **AND** the same path under another plugin's data dir SHALL be refused with `agent_dir_invalid`

#### Scenario: Cwd or plugin path inside the operator tree is refused
- **WHEN** an isolated spawn uses `cwd` equal to the operator home directory, or sets `scope.sessionDir` inside the operator agent dir
- **THEN** the result SHALL carry `code: "isolated_path_invalid"`

#### Scenario: Refusal leaves no pending state
- **WHEN** an isolated spawn is refused for any reason above
- **THEN** no pending plugin ref, initial prompt or spawn credential SHALL remain filed

#### Scenario: Unsupported combinations are refused; undefined keys are absent
- **WHEN** a plugin spawns with a valid `scope.agentDir` and `resume: null`, or `mode: "worktree"`, or a non-empty `initialPrompt`
- **THEN** the result SHALL carry `code: "agent_dir_unsupported_combo"`
- **AND** the same spawn with those keys present but `undefined` SHALL NOT be refused for them

#### Scenario: Live isolated spawn cap
- **WHEN** 256 isolated spawns are live and a plugin requests another
- **THEN** the result SHALL carry `code: "agent_dir_capacity"` and no pi process SHALL start
- **AND** after one live isolated session ends, the next isolated spawn SHALL succeed

#### Scenario: Missing bridge entry file refuses the spawn
- **WHEN** the resolved bridge entry file does not exist at spawn time
- **THEN** the result SHALL carry `code: "agent_dir_bridge_unresolved"` and no pi process SHALL start

#### Scenario: Operator credentials and env do not reach the isolated session
- **WHEN** the server env contains `ANTHROPIC_API_KEY`, `SSH_AUTH_SOCK`, `PI_CODING_AGENT_SESSION_DIR` and `PI_DASHBOARD_ISOLATED=0`, and a plugin performs an isolated spawn
- **THEN** the spawned env SHALL contain none of `ANTHROPIC_API_KEY`, `SSH_AUTH_SOCK` and `PI_CODING_AGENT_SESSION_DIR`, and `PI_DASHBOARD_ISOLATED` SHALL equal `1`

#### Scenario: Windows allowlist matches case-insensitively
- **WHEN** an isolated spawn runs on Windows and the server env stores the path variable as `Path`
- **THEN** the child env SHALL carry that path variable

#### Scenario: Isolated spawn keeps the managed runtime and Electron rules
- **WHEN** an isolated spawn runs under a resolved managed runtime with the Electron binary as `argv0`
- **THEN** the env `PATH` SHALL start with the resolved runtime bin dir and `ELECTRON_RUN_AS_NODE` SHALL equal `1`

#### Scenario: Isolated session excludes operator and workspace content
- **WHEN** an isolated session runs in a cwd whose ancestors hold an `AGENTS.md`, an `.agents/skills` skill and a `.pi/settings.json` package, and the operator agent dir holds settings packages, skills and an `AGENTS.md`
- **THEN** its system prompt and tool list SHALL contain nothing from any of them, and no built-in tool SHALL be available to the model

#### Scenario: Missing attestation terminates the session
- **WHEN** a session registers under an isolated spawn's token without reporting `isolated: true`
- **THEN** the server SHALL terminate that session

#### Scenario: Isolated session never receives a cwd-keyed initial prompt
- **WHEN** a non-isolated spawn queued an initial prompt for cwd `/c` and an isolated session registers in `/c` first
- **THEN** the isolated session SHALL NOT receive that prompt and it SHALL remain queued for its own session

#### Scenario: Non-isolated spawn strips an inherited isolation marker
- **WHEN** the server env contains `PI_DASHBOARD_ISOLATED=1` and a plugin spawns without `scope.agentDir`
- **THEN** the spawned env SHALL NOT contain `PI_DASHBOARD_ISOLATED`

### Requirement: The bridge runs control-channel-only in an isolated session

The bridge SHALL enter isolated mode only when, at its first load in the process, its environment carries `PI_DASHBOARD_ISOLATED=1` together with `PI_DASHBOARD_SPAWN_TOKEN` (a marker exported in an operator's shell alone SHALL NOT disable a terminal session). The decision SHALL be captured once and SHALL persist across bridge reloads and reconnects in the same process, even after the spawn token is consumed. In isolated mode the bridge SHALL perform only session registration (env-pinned endpoint, spawn-scoped credential — see `pi-gateway-auth`), event forwarding to the dashboard, model-list reporting from its own session registry, and inbound command handling. It SHALL NOT:
- inject its session-context system-prompt fragment;
- register any model-facing tool, provider, MCP server (including the dashboard MCP server) or slash command;
- expand `/` input from prompt templates or skills;
- run the automatic session namer, auto-start a dashboard server, provision the OpenSpec CLI shim, or request or apply credential-vault deliveries;
- read or write any file under the operator tree (`~/.pi/` — agent and dashboard dirs, including the local token, grants, pins, identity logs, config, role/provider/model/settings files); the path gate SHALL deny path-bearing tool calls outside the session cwd instead of consulting operator grants or config.

Event forwarding (turn content reaching the dashboard) is intentionally unchanged. Without isolated mode the bridge SHALL behave exactly as before this change.

#### Scenario: Isolated session prompt has no dashboard fragment
- **WHEN** an isolated session runs a turn
- **THEN** its system prompt SHALL NOT contain `pi-dashboard session context` nor the session id

#### Scenario: Isolated bridge registers no tools, providers or commands
- **WHEN** the bridge loads in isolated mode
- **THEN** it SHALL register no tool (including `ask_user`, `canvas`, `list_models`, `list_roles`, `update_roles`), no provider and no slash command

#### Scenario: Isolated bridge touches no operator files
- **WHEN** the bridge loads, registers over loopback TCP and runs a turn in isolated mode
- **THEN** no file under the operator's `~/.pi/` tree SHALL be opened for read or write by the bridge

#### Scenario: Slash input is not expanded
- **WHEN** a user message `/review` reaches an isolated session whose cwd holds `.pi/prompts/review.md`
- **THEN** the message SHALL reach the model unexpanded

#### Scenario: Isolation survives reload after the spawn token is consumed
- **WHEN** an isolated bridge has registered (spawn token consumed) and the bridge is reloaded in the same process
- **THEN** it SHALL still run in isolated mode and register with `isolated: true`

#### Scenario: No dashboard MCP server and no vault delivery in isolated mode
- **WHEN** the server mints an MCP token or the credential vault holds a grant for the isolated session's cwd
- **THEN** the isolated bridge SHALL register no MCP server and SHALL apply no vault-delivered variable to its environment

#### Scenario: Marker without spawn token is ignored
- **WHEN** an operator starts pi in a shell that exported `PI_DASHBOARD_ISOLATED=1` but no `PI_DASHBOARD_SPAWN_TOKEN`
- **THEN** the bridge SHALL behave as non-isolated

#### Scenario: Non-isolated session keeps the fragment
- **WHEN** a session not in isolated mode runs a turn
- **THEN** the session-context fragment SHALL be injected exactly as before this change
