## Purpose

Command routing logic for the bridge extension's send_prompt handler — bang commands, compact, slash commands, and regular text.

## Requirements

### Requirement: Bang command detection and execution
The command handler SHALL detect `!` and `!!` prefixes in `send_prompt` text and execute them as shell commands via `pi.exec()` instead of sending to the LLM.

- `!!<command>` (double-bang): Execute silently — run the command and forward output to the dashboard only, do NOT send to the LLM.
- `!<command>` (single-bang): Execute and send — run the command and send the command + output as a user message to the LLM.

The command text SHALL be trimmed after removing the prefix. Empty commands after trimming SHALL be ignored and passed through as regular messages.

#### Scenario: Double-bang silent execution
- **WHEN** `send_prompt` text is `!!ls -la`
- **THEN** the handler SHALL execute `ls -la` via `pi.exec()`, forward output as a `bash_output` event with `excludeFromContext: true`, and NOT call `sendUserMessage()`

#### Scenario: Single-bang execution with LLM
- **WHEN** `send_prompt` text is `!git status`
- **THEN** the handler SHALL execute `git status` via `pi.exec()`, forward output as a `bash_output` event with `excludeFromContext: false`, AND send the command + output as a user message to the LLM

#### Scenario: Empty command after prefix
- **WHEN** `send_prompt` text is `!` or `!!` with no command after trimming
- **THEN** the handler SHALL fall through to `sendUserMessage()` with the original text

### Requirement: Bash execution timeout
Shell commands executed via bang prefixes SHALL have a 30-second timeout. If the timeout expires, the partial output collected so far SHALL be forwarded as a `bash_output` event with an indication of timeout.

#### Scenario: Command times out
- **WHEN** a bang command runs for more than 30 seconds
- **THEN** the handler SHALL kill the process, forward collected output as a `bash_output` event, and include a timeout indicator in the output

### Requirement: Compact command routing
The command handler SHALL detect `/compact` in `send_prompt` text and route it to `ctx.compact()` instead of sending to the LLM.

- `/compact` with no arguments: call `compact()` with no options
- `/compact <instructions>`: call `compact({ customInstructions: instructions })`

The handler SHALL send a `command_feedback` event with status `started` when compaction begins.

#### Scenario: Compact without instructions
- **WHEN** `send_prompt` text is `/compact`
- **THEN** the handler SHALL call `ctx.compact()` and send a `command_feedback` event with `command: "/compact"` and `status: "started"`

#### Scenario: Compact with custom instructions
- **WHEN** `send_prompt` text is `/compact summarize only the code changes`
- **THEN** the handler SHALL call `ctx.compact({ customInstructions: "summarize only the code changes" })` and send a `command_feedback` event

### Requirement: Command routing order
The command handler SHALL process `send_prompt` text in this exact order:

1. Check for `!!` prefix → silent bash execution
2. Check for `!` prefix → bash execution with LLM send
3. Check for `/compact` → compact routing
4. Check for `/quit` or `/exit` → shutdown
5. Check for `/reload` → extension reload
6. Check for `/new` → spawn new session in same cwd
7. Check for `/model provider/id` → model switch via `setModel` callback
8. Check for `/` prefix matching a known **user-defined flow name** (from `getFlowsList()`) → emit `flow:run` event
9. Check for `/` prefix matching a known **extension command** (`source: "extension"` in `pi.getCommands()`, excluding `DASHBOARD_NATIVE_COMMANDS` and `__`-prefixed names; evaluated inside `tryDispatchExtensionCommand`, which returns `false` if `getCommands()` throws) → dispatch in-process via `pi.sendUserMessage(text, { expandPromptTemplates: true, deliverAs })` (old-pi gate → `command_feedback { status: "error" }`)
10. Check for `/` prefix → fall through to template expansion + `pi.sendUserMessage()` (handles skills, prompt templates, unrecognized slashes)
11. Default (no `/` prefix) → `pi.sendUserMessage(text)` (existing passthrough behavior)

Note: pi-flows management commands (`/flows`, `/flows:new`, `/flows:edit`, `/flows:delete`) are registered by the pi-flows extension via `pi.registerCommand` and are therefore handled by step 9 (`/roles` is in `DASHBOARD_NATIVE_COMMANDS` and handled by the bridge). The kebab-menu UI continues to invoke `flows:new-request` / `flows:edit-request` / `flow:run` / `flow:delete-request` directly via the `flow_management` WebSocket message handler in `bridge.ts` — that path is independent of typed-text command routing and is not covered by this requirement.

#### Scenario: Routing precedence — bang beats slash
- **WHEN** `send_prompt` text is `!!echo /ctx-stats`
- **THEN** the handler SHALL execute `echo /ctx-stats` as a silent bash command
- **AND** SHALL NOT invoke any slash routing branch

#### Scenario: Routing precedence — user-defined flow run beats extension dispatch
- **WHEN** `send_prompt` text is `/deploy-prod` AND `deploy-prod` is a user-defined flow name returned by `getFlowsList()` AND ALSO appears in `pi.getCommands()`
- **THEN** the handler SHALL emit `flow:run { flowName: "deploy-prod" }` via `pi.events.emit(...)` (step 8 wins over step 9)
- **AND** SHALL NOT call `pi.sendUserMessage(...)` with `expandPromptTemplates: true` for this text

#### Scenario: Routing precedence — typed `/flows:new` rides extension dispatch
- **WHEN** `send_prompt` text is `/flows:new` AND `getFlowsList()` does NOT contain a user-defined flow named `flows:new` AND `pi.getCommands()` contains `{ name: "flows:new", source: "extension" }` (registered by pi-flows)
- **THEN** step 8 SHALL NOT match (no user-defined flow)
- **AND** step 9 SHALL fire: `pi.sendUserMessage("/flows:new", { expandPromptTemplates: true, deliverAs: "followUp" })`
- **AND** step 10 SHALL NOT execute for this text

#### Scenario: Extension dispatch beats fall-through
- **WHEN** `send_prompt` text is `/ctx-stats` AND `ctx-stats` is an extension command AND no earlier step matches
- **THEN** step 9 fires (in-process dispatch or old-pi gate error)
- **AND** step 10's fall-through to template expansion SHALL NOT execute

### Requirement: Model command routing
The command handler SHALL detect `/model provider/id` in `send_prompt` text and route it through the `setModel` callback instead of sending to the LLM. The `/model` command is a TUI-only command in pi and does not work via `session.prompt()` or `sendUserMessage()`.

- `/model provider/id` (with a `/` in the argument): call `setModel(provider, modelId)` and send a `command_feedback` event
- `/model` (bare, no argument) or `/model name` (no `/` in argument): fall through to generic slash command routing (opens TUI model selector)

#### Scenario: Model switch with provider/id
- **WHEN** `send_prompt` text is `/model anthropic/claude-haiku-4-5`
- **THEN** the handler SHALL call `setModel("anthropic", "claude-haiku-4-5")` and send a `command_feedback` event with `command: "/model anthropic/claude-haiku-4-5"` and `status: "completed"`
- **AND** SHALL NOT call `sendUserMessage()`

#### Scenario: Bare /model falls through
- **WHEN** `send_prompt` text is `/model` or `/model something` (no `/` in argument)
- **THEN** the handler SHALL fall through to generic slash command routing

### Requirement: Extension slash command detection
The command handler SHALL provide a pure helper `isExtensionSlashCommand(text, commandList)` that returns true iff:
- `text` starts with `/` AND has no embedded newline
- The token between the leading `/` and the first space (or end of string) — call it `cmdName` — appears in `commandList` with `source === "extension"`
- `cmdName` is NOT in `DASHBOARD_NATIVE_COMMANDS` (the same set used by `filterHiddenCommands` in `bridge-context.ts`)
- `cmdName` does NOT start with `__` (bridge-native hidden commands such as `__dashboard_reload`)

This helper SHALL be exported and used by `tryDispatchExtensionCommand` in `slash-dispatch.ts` (called from the bridge's `sessionPrompt` callback and `command-handler.ts`'s slash else-arm) to gate step 9 of the routing order.

The helper SHALL NOT mutate `commandList` and SHALL NOT call any pi APIs. It is a pure string + array predicate suitable for unit testing without a stub pi.

#### Scenario: Detects bare extension command
- **WHEN** called with `("/ctx-stats", [{ name: "ctx-stats", source: "extension" }])`
- **THEN** SHALL return `true`

#### Scenario: Detects extension command with arguments
- **WHEN** called with `("/ctx-stats verbose=1", [{ name: "ctx-stats", source: "extension" }])`
- **THEN** SHALL return `true`

#### Scenario: Rejects skill command
- **WHEN** called with `("/skill:foo", [{ name: "skill:foo", source: "skill" }])`
- **THEN** SHALL return `false` (source is `skill`, not `extension`)

#### Scenario: Rejects prompt template
- **WHEN** called with `("/review", [{ name: "review", source: "prompt" }])`
- **THEN** SHALL return `false`

#### Scenario: Rejects bridge-native dashboard command
- **WHEN** called with `("/__dashboard_reload", [{ name: "__dashboard_reload", source: "extension" }])`
- **THEN** SHALL return `false` (excluded by the `__` prefix rule)

#### Scenario: Rejects dashboard-native command name
- **WHEN** called with `("/roles", [{ name: "roles", source: "extension" }])`
- **THEN** SHALL return `false` (excluded by `DASHBOARD_NATIVE_COMMANDS`)

#### Scenario: Rejects unknown slash
- **WHEN** called with `("/totally-unknown", [])`
- **THEN** SHALL return `false`

#### Scenario: Rejects multi-line input
- **WHEN** called with `("/ctx-stats\nuser context", [{ name: "ctx-stats", source: "extension" }])`
- **THEN** SHALL return `false` (multi-line slashes are passthrough by `parseSendPrompt`)

#### Scenario: Rejects non-slash input
- **WHEN** called with `("hello world", [{ name: "ctx-stats", source: "extension" }])`
- **THEN** SHALL return `false`

### Requirement: Global prompt template resolution

`resolveTemplate` in `packages/extension/src/prompt-expander.ts` SHALL resolve registered prompt templates in addition to skills when falling back to `pi.getCommands()` (Step 3). For each candidate name variant (original-form-first), the resolver SHALL match an entry whose `name` equals the candidate AND whose `source` is EITHER `"skill"` OR `"prompt"`, using the entry's path field, and SHALL return the first match found.

The resolver SHALL NOT add directory scanning for prompt templates — `pi.getCommands()` already returns every prompt template (global, project, package) with its absolute path.

Skill resolution and original-form-first precedence SHALL remain unchanged.

#### Scenario: Global prompt template resolved via pi.getCommands()
- **WHEN** `pi.getCommands()` returns `{ name: "session-summary", source: "prompt", path: <abs path to on-disk template> }` AND the dashboard sends `/session-summary`
- **THEN** `resolveTemplate` SHALL return the template's path with `source: "prompt"`
- **AND** `expandPromptTemplateFromDisk` SHALL expand it and call `pi.sendUserMessage(<expanded>, { deliverAs })`
- **AND** SHALL NOT pass the raw `/session-summary` text to the LLM

#### Scenario: Skill resolution unaffected
- **WHEN** `pi.getCommands()` returns `{ name: "opsx:archive", source: "skill", path: <abs> }` AND the dashboard sends `/opsx:archive`
- **THEN** `resolveTemplate` SHALL return the skill's path with `source: "skill"` (unchanged behavior)

#### Scenario: Unrecognized slash still falls through
- **WHEN** `pi.getCommands()` contains no entry named `totally-unknown` of source `skill` or `prompt`
- **THEN** `resolveTemplate` SHALL return `null` and the handler SHALL fall through to `pi.sendUserMessage`

### Requirement: Extension slash command dispatch via sendUserMessage

When `isExtensionSlashCommand(text, pi.getCommands())` is true, the bridge
SHALL dispatch the command in-process by calling
`pi.sendUserMessage(text, { expandPromptTemplates: true, deliverAs })`, where
`deliverAs` is the requested delivery (`"steer"` | `"followUp"`, default
`"followUp"`). This SHALL apply to every session kind — headless RPC, tmux,
terminal, user-launched — with no session-kind probe.

Feedback contract (exactly one `started` and exactly one terminal event per
invocation):
- `command_feedback {command, status:"started"}` before the call;
- `command_feedback {status:"completed"}` immediately after the call returns —
  meaning pi accepted the text for dispatch (fire-and-forget; pi runs
  `prompt()` asynchronously and swallows its own rejections);
- `command_feedback {status:"error", message}` if the call throws synchronously
  (pi's `assertActive` on a stale extension context).

Handler outcome is NOT observable by the bridge and SHALL NOT be claimed.

Old-pi gate: the bridge SHALL read the version of the pi process it runs
inside by walking up from `process.argv[1]` to the nearest `package.json`
whose `name` is `@earendil-works/pi-coding-agent` or
`@mariozechner/pi-coding-agent`; any failure SHALL yield `undefined` (never
throw). When the version parses as a triplet below `0.84.2`, the bridge SHALL
NOT call `sendUserMessage` and SHALL emit `started` followed by `error` with
message "Extension slash commands from the dashboard require pi 0.84.2+".
When the version is `undefined` or unparseable, the bridge SHALL treat it as
new and `console.warn` once per process. The read SHALL NOT resolve the
package by name through `node_modules` (a hoisted copy is not the running pi).

The bridge SHALL NOT feature-detect `pi.dispatchCommand` and SHALL NOT emit
`dispatch_extension_command`.

#### Scenario: Extension command in a headless RPC session
- **WHEN** `send_prompt` text is `/ctx-stats` in a dashboard-spawned headless session on pi >= 0.84.2
- **THEN** the bridge SHALL emit `command_feedback {status:"started"}`
- **AND** SHALL call `pi.sendUserMessage("/ctx-stats", { expandPromptTemplates: true, deliverAs: "followUp" })`
- **AND** SHALL emit `command_feedback {status:"completed"}`
- **AND** SHALL NOT send `dispatch_extension_command` to the server

#### Scenario: Extension command in a tmux / terminal session
- **WHEN** `send_prompt` text is `/ctx-stats` in a user-launched or tmux session on pi >= 0.84.2
- **THEN** the bridge SHALL dispatch exactly as in the headless scenario
- **AND** SHALL NOT emit the former "requires pi 0.71+" stopgap error

#### Scenario: Extension command while the agent is streaming, steer delivery
- **WHEN** `send_prompt` text is `/curator` with `delivery: "steer"` and the agent is streaming
- **THEN** the bridge SHALL pass `deliverAs: "steer"`
- **AND** pi SHALL run the extension command immediately regardless of `deliverAs` (core `prompt()` handles extension commands before it consults `streamingBehavior`)

#### Scenario: Stale extension context throws synchronously
- **WHEN** `pi.sendUserMessage` throws synchronously
- **THEN** the bridge SHALL emit `command_feedback {status:"error", message: <thrown message>}`
- **AND** SHALL NOT emit `completed`

#### Scenario: Old pi below 0.84.2
- **GIVEN** `readPiVersion()` returns `0.84.1`
- **WHEN** `send_prompt` text is `/ctx-stats`
- **THEN** the bridge SHALL emit `started` then `error` with message containing "requires pi 0.84.2+"
- **AND** SHALL NOT call `pi.sendUserMessage`

#### Scenario: mariozechner build fails the gate
- **GIVEN** `process.argv[1]` walks up to a manifest `{ name: "@mariozechner/pi-coding-agent", version: "0.73.1" }`
- **WHEN** `send_prompt` text is `/ctx-stats`
- **THEN** the bridge SHALL emit `started` then `error` containing "requires pi 0.84.2+"
- **AND** SHALL NOT call `pi.sendUserMessage`

#### Scenario: Hoisted newer copy does not mask an old running pi
- **GIVEN** the running pi's manifest (via `process.argv[1]`) is `0.80.10` AND a `node_modules/@earendil-works/pi-coding-agent` at `0.85.1` is resolvable by name
- **WHEN** `send_prompt` text is `/ctx-stats`
- **THEN** the bridge SHALL emit `error` (reads the running pi, not the hoisted copy)

#### Scenario: Reader failure yields exactly one terminal event
- **GIVEN** the version read throws
- **WHEN** `send_prompt` text is `/ctx-stats`
- **THEN** the bridge SHALL emit `started` then `completed` (treated as new) and SHALL NOT propagate the throw

#### Scenario: Unreadable version is treated as new
- **GIVEN** no pi manifest is found from `process.argv[1]`
- **WHEN** `send_prompt` text is `/ctx-stats`
- **THEN** the bridge SHALL call `pi.sendUserMessage` with `expandPromptTemplates: true`
- **AND** SHALL have logged one warning for the process

#### Scenario: pi exactly 0.84.2 passes the gate
- **GIVEN** `readPiVersion()` returns `0.84.2`
- **WHEN** `send_prompt` text is `/ctx-stats`
- **THEN** the bridge SHALL call `pi.sendUserMessage` with `expandPromptTemplates: true`

#### Scenario: Exactly one terminal event
- **WHEN** any single dispatch invocation fires
- **THEN** the recorded `command_feedback` events for that command text SHALL contain EXACTLY ONE `started` and EXACTLY ONE terminal event (`completed` xor `error`)
