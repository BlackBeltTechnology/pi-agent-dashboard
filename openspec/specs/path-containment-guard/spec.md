# path-containment-guard Specification

## Purpose
An opt-in, non-interactive pi extension that rejects tool calls whose path argument resolves outside configured allowed roots, and rejects configured denied tools outright, so an unattended (for example plugin-spawned) session is confined without an operator in the loop.

## Requirements

### Requirement: The guard is opt-in and configured through the extension-config env convention

The guard SHALL act only in a pi process that loaded it explicitly (for example through `PluginSpawnOptions.scope.extensions` or pi's `-e` flag). It SHALL NOT be loaded by discovery from any package it ships in. It SHALL read its configuration only from the process environment, using the `extensionConfig` projection under the extension name `path-containment-guard`:

- `PI_EXT_PATH_CONTAINMENT_GUARD_ALLOWED_ROOTS` — a JSON-encoded array of absolute directory paths.
- `PI_EXT_PATH_CONTAINMENT_GUARD_DENIED_TOOLS` — a JSON-encoded array of tool names.

The configuration SHALL be read once, when the extension loads. Loading SHALL never fail because of configuration or filesystem state. When anything goes wrong while loading, the guard SHALL still register its check, and that check SHALL reject every tool call with the reason `config_invalid`. A guard that failed to load would otherwise vanish on a session reload, leaving the session unguarded. In the allowed-roots array, the following entries SHALL be ignored:

- an entry that is not a non-empty absolute path;
- an entry that contains a NUL character;
- on Windows, an entry with neither a drive letter nor a UNC prefix;
- an entry whose canonicalisation fails, for example a symlink loop.

#### Scenario: Configured through scope.extensionConfig

- **GIVEN** a plugin spawns a session with `scope.extensions` naming the guard and `scope.extensionConfig` `{ "path-containment-guard": { "allowedRoots": ["/w/repo"], "deniedTools": ["bash"] } }`
- **WHEN** the session starts
- **THEN** the guard SHALL confine path tools to `/w/repo` and SHALL reject `bash`

#### Scenario: Not loaded means no effect

- **GIVEN** a session that did not load the guard
- **WHEN** the agent reads any path or runs any tool
- **THEN** this capability SHALL NOT block the call

#### Scenario: Relative and malformed root entries are ignored

- **GIVEN** `allowedRoots` is `["/w/repo", "rel/dir", "", 7]`
- **WHEN** the agent reads `/w/repo/a.ts`
- **THEN** the read SHALL be allowed, and `rel/dir` SHALL NOT admit any path

#### Scenario: A root that cannot be canonicalised is ignored

- **GIVEN** `allowedRoots` is `["/w/loop", "/w/repo"]`, where `/w/loop` is a symlink loop
- **WHEN** the agent reads `/w/repo/a.ts`
- **THEN** the guard SHALL have loaded, and the read SHALL run

#### Scenario: An unexpected load failure blocks instead of disappearing

- **WHEN** reading the configuration throws unexpectedly while the guard loads
- **THEN** the guard SHALL still be active, and every tool call SHALL be rejected with the reason `config_invalid`

#### Scenario: A driveless Windows root is ignored

- **GIVEN** a Windows host and `allowedRoots` is `["\\w\\repo"]`
- **WHEN** the agent reads `C:\w\repo\a.ts`
- **THEN** the read SHALL be rejected with the reason `config_invalid`

### Requirement: Missing or unusable configuration fails closed

**Allowed roots.** When the allowed-roots variable is absent, is not valid JSON, is not an array, or holds no valid entry, every gated path tool call SHALL be rejected.

**Denied tools.** When the denied-tools variable is present and any of the following holds, every tool call SHALL be rejected, because the guard cannot tell which tools were meant to be denied:

- it is not valid JSON;
- it is not an array;
- it contains any entry that is not a non-empty string.

An absent denied-tools variable, or an empty array, SHALL deny no tool.

An empty array reaches the guard only through a directly set environment. The spawn mapper drops an `extensionConfig` array that has no valid elements, and inherited guard variables never reach a plugin-spawned session (plugin-spawn-scope).

#### Scenario: No allowed roots blocks every path tool

- **GIVEN** the guard is loaded and `PI_EXT_PATH_CONTAINMENT_GUARD_ALLOWED_ROOTS` is absent
- **WHEN** the agent reads `/w/repo/a.ts`
- **THEN** the read SHALL be rejected with the reason `config_invalid`

#### Scenario: An empty allowed-roots array blocks every path tool

- **GIVEN** `PI_EXT_PATH_CONTAINMENT_GUARD_ALLOWED_ROOTS` is set directly to `[]`
- **WHEN** the agent runs `ls` with no path
- **THEN** the call SHALL be rejected with the reason `config_invalid`

#### Scenario: Unparseable denied-tools blocks every tool

- **GIVEN** `PI_EXT_PATH_CONTAINMENT_GUARD_DENIED_TOOLS` is `bash,write` (not JSON)
- **WHEN** the agent runs any tool
- **THEN** the call SHALL be rejected with the reason `config_invalid`

#### Scenario: A malformed denied-tools entry blocks every tool

- **GIVEN** `PI_EXT_PATH_CONTAINMENT_GUARD_DENIED_TOOLS` is `["bash", 7]`
- **WHEN** the agent runs `read` on an in-root path
- **THEN** the call SHALL be rejected with the reason `config_invalid`

#### Scenario: Absent denied-tools denies nothing

- **GIVEN** valid `allowedRoots` and no denied-tools variable
- **WHEN** the agent runs `bash`
- **THEN** this capability SHALL NOT block the call

### Requirement: Denied tools are rejected before execution

A tool call whose tool name exactly equals (case-sensitively) an entry of the denied-tools list SHALL be rejected before the tool executes, whatever its arguments. This check SHALL take precedence over the path check. Calls made from inside another tool (nested tool calls) SHALL be checked in the same way.

#### Scenario: Denied bash is rejected

- **GIVEN** `deniedTools` is `["bash"]`
- **WHEN** the agent runs `bash` with `ls`
- **THEN** the call SHALL NOT execute and the agent SHALL receive the reason `tool_denied`

#### Scenario: Denied path tool is rejected even in-root

- **GIVEN** `allowedRoots` is `["/w/repo"]` and `deniedTools` is `["write"]`
- **WHEN** the agent writes `/w/repo/a.txt`
- **THEN** the call SHALL be rejected with the reason `tool_denied`

#### Scenario: Name match is exact

- **GIVEN** `deniedTools` is `["Bash"]`
- **WHEN** the agent runs `bash`
- **THEN** this capability SHALL NOT reject the call as denied

#### Scenario: A nested call to a denied tool is rejected

- **GIVEN** `deniedTools` is `["bash"]`
- **WHEN** another tool runs `bash` as a nested tool call
- **THEN** the nested call SHALL be rejected with the reason `tool_denied`

### Requirement: Path tools are confined to the allowed roots

The guard SHALL check every `read`, `write`, `edit`, `grep`, `find` and `ls` call before the tool executes.

- **Resolving the target.** The guard SHALL resolve the target path by the rules the tool itself applies to its path argument: home-directory expansion, a leading `@` marker, Unicode-space normalisation, `file://` URLs, Windows shell-path forms on Windows, and resolution against the session working directory. For `read`, it SHALL also apply the tool's filename-variant fallback.
- **Absent path.** For `grep`, `find` and `ls`, a path argument that is absent, empty or `null` SHALL be treated as the session working directory, as those tools do.
- **Canonicalising.** The guard SHALL then canonicalise the target to the location the tool would actually open or create:
  - existing path components SHALL be resolved through their real path;
  - a symlink whose own target does not exist (a dangling symlink) SHALL be followed to that target.
  - link text SHALL be resolved component by component from the link's real parent directory, as the operating system resolves it.
- **Allowed roots.** Each allowed root SHALL be canonicalised the same way, so that a symlinked root admits the paths it resolves to.
- **Containment.** Containment SHALL be decided component by component, never by string prefix. An exact match SHALL be tried first. Case-insensitive comparison SHALL be used only when the target's volume folds case.
- **Outcome.** A call whose canonical target lies within some allowed root SHALL proceed. Any other call SHALL be rejected with the reason `path_outside_roots`.

The session working directory SHALL NOT itself be an allowed root unless it lies within a configured one.

The guard SHALL decide on the arguments as its handler receives them. Argument rewrites by other extensions loaded into the same process are outside this capability, because such extensions run with the process's full authority.

#### Scenario: In-root read proceeds

- **GIVEN** `allowedRoots` is `["/w/repo"]`
- **WHEN** the agent reads `/w/repo/src/a.ts`
- **THEN** the read SHALL run

#### Scenario: Traversal out of the root is rejected

- **GIVEN** `allowedRoots` is `["/w/repo"]` and the working directory is `/w/repo`
- **WHEN** the agent reads `../other/x.txt`
- **THEN** the read SHALL be rejected with the reason `path_outside_roots`

#### Scenario: Home shorthand is resolved, not treated as relative

- **GIVEN** `allowedRoots` is `["/w/repo"]` and the working directory is `/w/repo`
- **WHEN** the agent reads `~/.ssh/id_rsa`
- **THEN** the read SHALL be rejected as outside the roots

#### Scenario: A string-prefix sibling is outside

- **GIVEN** `allowedRoots` is `["/w/repo"]`
- **WHEN** the agent writes `/w/repo-old/a.txt`
- **THEN** the write SHALL be rejected

#### Scenario: A symlink escaping the root is rejected

- **GIVEN** `allowedRoots` is `["/w/repo"]` and `/w/repo/link` is a symlink to `/w/other`
- **WHEN** the agent edits `/w/repo/link/f.txt`
- **THEN** the edit SHALL be rejected

#### Scenario: A dangling symlink escaping the root is rejected

- **GIVEN** `allowedRoots` is `["/w/repo"]` and `/w/repo/link` is a symlink to the not-yet-existing `/w/other/new.txt`
- **WHEN** the agent writes `/w/repo/link`
- **THEN** the write SHALL be rejected with the reason `path_outside_roots`

#### Scenario: A relative dangling link under a symlinked directory is rejected

- **GIVEN** `allowedRoots` is `["/w/repo"]`, `/w/repo/s` is a symlink to `/w/other/deep`, and `/w/other/deep/link` is a symlink to the not-yet-existing `../new.txt`
- **WHEN** the agent writes `/w/repo/s/link`
- **THEN** the write SHALL be rejected with the reason `path_outside_roots`

#### Scenario: A not-yet-existing nested target inside the root is allowed

- **GIVEN** `allowedRoots` is `["/w/repo"]` and `/w/repo/new/deep` does not exist
- **WHEN** the agent writes `/w/repo/new/deep/a.txt`
- **THEN** the write SHALL run

#### Scenario: grep without a path searches the working directory

- **GIVEN** `allowedRoots` is `["/w/repo/sub"]` and the working directory is `/w/repo`
- **WHEN** the agent runs `grep` with no path
- **THEN** the call SHALL be rejected, because the working directory lies outside the roots

#### Scenario: ls inside a nested allowed root proceeds

- **GIVEN** `allowedRoots` is `["/w/repo/sub"]` and the working directory is `/w/repo`
- **WHEN** the agent runs `ls` with path `sub/x`
- **THEN** the call SHALL run

#### Scenario: Case folds only on a case-insensitive volume

- **GIVEN** `allowedRoots` is `["/w/Repo"]` on a case-sensitive volume
- **WHEN** the agent reads `/w/repo/a.ts`
- **THEN** the read SHALL be rejected

### Requirement: Allowed decisions stay cheap

An allowed in-root decision SHALL make no network or server round trip, and its added latency SHALL stay under 1 ms at p95, measured over repeated calls on an existing directory tree after the first call.

#### Scenario: In-root decision latency

- **GIVEN** `allowedRoots` is one existing temporary directory
- **WHEN** the guard decides 1000 `read` calls of existing files inside it
- **THEN** the p95 decision time SHALL be below 1 ms

### Requirement: The guard rejects without prompting and fails closed

The guard SHALL never invoke the session's interactive UI, and SHALL never allow a call it would otherwise reject.

It SHALL reject a call with the reason `invalid_path` when:

- a `read`, `write` or `edit` call has a path argument that is absent, empty, `null` or not a string;
- any gated call has a path argument that is present, not `null`, and not a string;
- any gated call has a path argument that contains a NUL character.

It SHALL reject the call with the reason `error` when evaluating it throws, including when a chain of symlinks cannot be resolved within a bounded number of hops.

Argument checks that pi's own schema validation already enforces (a missing or non-string `path` on `read`/`write`/`edit`) are kept as defence in depth, for example against a tool re-registered under a built-in name.

Every rejection SHALL carry a reason, returned to the agent as the tool's block reason. The reason SHALL begin with one machine code: `tool_denied`, `path_outside_roots`, `invalid_path`, `config_invalid` or `error`. Where it applies, it SHALL be followed by the tool name and the canonical target. Each rejection SHALL emit one log record naming the code, the tool and the canonical target where there is one. Control characters (including U+2028 and U+2029) in logged values SHALL be escaped, so that a crafted filename cannot forge a log record.

#### Scenario: Non-string path is rejected

- **WHEN** the agent calls `read` with `path` set to a number
- **THEN** the call SHALL be rejected with the reason `invalid_path`

#### Scenario: Missing write path is rejected

- **WHEN** the agent calls `write` with no `path` argument
- **THEN** the call SHALL be rejected with the reason `invalid_path`

#### Scenario: Internal error rejects

- **WHEN** canonicalising the target throws
- **THEN** the call SHALL be rejected with the reason `error`

#### Scenario: A newline in a path cannot forge a log record

- **WHEN** the agent reads an out-of-root path whose name contains a newline
- **THEN** exactly one log line SHALL be written, with the newline escaped

#### Scenario: A symlink loop rejects

- **GIVEN** `/w/repo/a` is a symlink to `/w/repo/b`, and `/w/repo/b` is a symlink to `/w/repo/a`
- **WHEN** the agent writes `/w/repo/a`
- **THEN** the call SHALL be rejected

#### Scenario: The guard never uses the UI

- **GIVEN** the session has an interactive UI
- **WHEN** an out-of-root write is checked
- **THEN** the guard SHALL NOT call any UI method, and SHALL reject the write

### Requirement: Other tools are not path-checked

Tools other than `read`, `write`, `edit`, `grep`, `find` and `ls` SHALL NOT be path-checked. This includes the shell tools `bash` and `powershell`, MCP tools and extension-registered tools. They SHALL be rejected only when listed in the denied-tools list or when the configuration is unusable as defined above. The guard SHALL NOT analyse shell command text.

#### Scenario: bash is not path-analysed

- **GIVEN** `allowedRoots` is `["/w/repo"]` and `bash` is not denied
- **WHEN** the agent runs `bash` with `cat /w/other/secret.txt`
- **THEN** this capability SHALL NOT block the call

#### Scenario: powershell is rejected only when denied

- **GIVEN** `deniedTools` is `["bash", "powershell"]`
- **WHEN** the agent runs `powershell`
- **THEN** the call SHALL be rejected with the reason `tool_denied`

### Requirement: The guard is independent of the interactive path gate

The guard's verdict SHALL NOT depend on the state of the interactive agent path gate. That gate's on/off setting and environment override, its persisted directory grants, a live YOLO session, and an operator's answer to a gate prompt SHALL neither widen the allowed roots nor turn a guard rejection into an allow. When both are active, a call SHALL execute only if neither of them blocks it, whatever order their handlers run in.

#### Scenario: A persisted grant does not widen the guard

- **GIVEN** the path-grant store holds `/w/other` and `allowedRoots` is `["/w/repo"]`
- **WHEN** the agent reads `/w/other/a.md`
- **THEN** the guard SHALL reject the read

#### Scenario: A gate allow does not override the guard

- **GIVEN** `allowedRoots` is `["/w/repo/sub"]`, the working directory is `/w/repo`, and the interactive gate is enabled
- **WHEN** the agent reads `/w/repo/a.md`, which the gate admits without a prompt as in-root
- **THEN** the read SHALL NOT execute

#### Scenario: Disabling the interactive gate leaves the guard active

- **GIVEN** the interactive gate is disabled and `allowedRoots` is `["/w/repo"]`
- **WHEN** the agent reads `/w/other/a.md`
- **THEN** the guard SHALL reject the read

### Requirement: Plugins get a typed spawn-scope fragment

The guard package SHALL export a pure helper that takes guard options `{ allowedRoots: string[]; deniedTools?: string[] }` and, optionally, an existing `scope`. It SHALL return a new `scope`:

- carrying every field of the given scope;
- with the absolute path of the guard's entry file appended to `extensions`;
- with an `extensionConfig` entry under the `path-containment-guard` name holding exactly the keys `allowedRoots` and, when given, `deniedTools`.

It SHALL NOT modify the given scope. It SHALL throw when the given scope already has a `path-containment-guard` `extensionConfig` entry. Importing the helper SHALL NOT load pi or register the extension.

The helper SHALL throw when `allowedRoots` holds no root the guard would accept (by the same root rules as the guard's own parsing), or when `deniedTools` is given and holds an entry that is not a non-empty string. A plugin's mistake then surfaces at spawn time, rather than reaching the guard as an absent variable.

#### Scenario: Helper output configures the guard

- **WHEN** a plugin spawns with `scope` set to the helper's result for `{ allowedRoots: ["/w/repo"], deniedTools: ["bash"] }`
- **THEN** the spawned argv SHALL contain `-e <guard entry path>`
- **AND** the spawned env SHALL contain `PI_EXT_PATH_CONTAINMENT_GUARD_ALLOWED_ROOTS` = `["/w/repo"]` and `PI_EXT_PATH_CONTAINMENT_GUARD_DENIED_TOOLS` = `["bash"]`

#### Scenario: Merging into an existing scope keeps both

- **GIVEN** an existing scope `{ extensions: ["/p/own.ts"], extensionConfig: { "team": { "root": "/w" } } }`
- **WHEN** the helper is called with that scope and `{ allowedRoots: ["/w/repo"] }`
- **THEN** the result's `extensions` SHALL be `["/p/own.ts", <guard entry path>]`, and its `extensionConfig` SHALL hold both the `team` and the `path-containment-guard` entries
- **AND** the given scope SHALL be unchanged

#### Scenario: deniedTools omitted

- **WHEN** the helper is called with only `allowedRoots`
- **THEN** the returned `extensionConfig` SHALL NOT contain a `deniedTools` key

#### Scenario: Empty roots throw

- **WHEN** the helper is called with `{ allowedRoots: [] }` or `{ allowedRoots: ["rel"] }`
- **THEN** it SHALL throw and return no fragment

#### Scenario: A malformed denied-tools entry throws

- **WHEN** the helper is called with `{ allowedRoots: ["/w/repo"], deniedTools: ["bash", ""] }`
- **THEN** it SHALL throw and return no fragment
