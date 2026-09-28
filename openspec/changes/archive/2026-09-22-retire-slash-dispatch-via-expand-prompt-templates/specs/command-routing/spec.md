# command-routing — delta

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Slash command routing through session.prompt()
**Reason**: The three-way Path B/C/D decision is replaced by a single in-process dispatch (see ADDED requirement). Its "unaffected" scenarios (skill command, prompt template, unrecognized slash, bridge-native suppression) remain true and are covered by "Command routing order" steps 10–11 and "Extension slash command detection".
**Migration**: `slash-dispatch.ts` becomes gate + single call; `connection` parameter removed.

### Requirement: Bridge feature-detects pi.dispatchCommand
**Reason**: `pi.dispatchCommand` never shipped; `sendUserMessage({ expandPromptTemplates: true })` is the supported dispatch surface since pi 0.84.2. The "no version sniffing" rule existed only for this feature detection and is replaced by an explicit old-pi version gate.
**Migration**: Delete `hasDispatchCommand` from `bridge-context.ts` and its tests.

## MODIFIED Requirements

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
