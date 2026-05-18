## MODIFIED Requirements

### Requirement: Slash command routing through session.prompt()

For `/` prefixed input that is not handled by an earlier routing step (bang commands, `/compact`, `/quit`, `/reload`, `/new`, `/model <provider/id>`, management commands, flow run), the command handler SHALL attempt to dispatch the slash command using a **three-way decision**, in this order:

1. **Path B (preferred when available)**: if `pi.dispatchCommand` is exposed by the active pi build (feature-detected via `hasDispatchCommand(pi)`), the handler SHALL call `pi.dispatchCommand(text, {streamingBehavior: delivery ?? "followUp"})` directly. Bridge emits `command_feedback {status: "started"}` before the call and `{status: "completed"}` after it resolves (or `{status: "error", message: err.message}` on rejection).

2. **Path C (when pi.dispatchCommand absent and session is headless RPC)**: if `pi.dispatchCommand` is NOT a function AND the bridge detects a headless RPC pi (per `isHeadlessRpcSession()`), the handler SHALL emit `command_feedback {status: "started"}` and emit a server-bound message `{type: "dispatch_extension_command", sessionId, command, requestId: <uuid>}`. The server's keeper-manager SHALL write the corresponding pi RPC line to the session's keeper UDS / named pipe. The server emits the terminal `command_feedback` event (`completed` on UDS-write success — optimistic; `error` on UDS-write failure). The bridge SHALL NOT emit a terminal event for this path.

3. **Path D (error feedback)**: if neither Path B nor Path C is reachable (i.e. `pi.dispatchCommand` absent AND non-headless session — tmux / wt / unrecognized spawn — OR no `connection` supplied), the handler SHALL emit `command_feedback {status: "error"}` with a message explaining that extension command dispatch requires headless mode with `useRpcKeeper: true` in dashboard config (`~/.pi/dashboard/config.json`), and SHALL return `true`. The caller SHALL NOT call `pi.sendUserMessage` for this command — `sendUserMessage` hardcodes `expandPromptTemplates: false`, which skips pi's `_tryExecuteExtensionCommand`, so extension commands sent that way become regular LLM messages rather than being dispatched.

The `delivery` parameter (defaulting to `"followUp"` when absent) SHALL determine `streamingBehavior` on the Path B `dispatchCommand` call.

The fallback to `pi.sendUserMessage(text)` SHALL be reached for slash text that:
- Is NOT a registered extension command (per `pi.getCommands()` filtered to `source === "extension"` and not in `DASHBOARD_NATIVE_COMMANDS`), OR
- Is a skill command (`/skill:<name>`), prompt template, or unrecognized slash text whose semantics require LLM interpretation.

The handler SHALL emit EXACTLY ONE `started` event and EXACTLY ONE terminal event (`completed` xor `error`) per dispatch invocation across Path B, Path C, and Path D combined.

#### Scenario: Path B — pi.dispatchCommand available
- **WHEN** `send_prompt` text is `/ctx-stats` AND `pi.dispatchCommand` is a function
- **THEN** the bridge SHALL emit `command_feedback {command: "/ctx-stats", status: "started"}`
- **AND** SHALL call `pi.dispatchCommand("/ctx-stats", {streamingBehavior: delivery ?? "followUp"})`
- **AND** upon resolution SHALL emit `command_feedback {command: "/ctx-stats", status: "completed"}`
- **AND** SHALL NOT emit `dispatch_extension_command`

#### Scenario: Path B delivery — steering message uses streamingBehavior "steer"
- **WHEN** `send_prompt` text is `/ctx-stats` AND `msg.delivery === "steer"` AND `pi.dispatchCommand` is a function
- **THEN** the bridge SHALL call `pi.dispatchCommand("/ctx-stats", {streamingBehavior: "steer"})`

#### Scenario: Path B delivery — followUp message uses streamingBehavior "followUp"
- **WHEN** `send_prompt` text is `/ctx-stats` AND `msg.delivery === "followUp"` AND `pi.dispatchCommand` is a function
- **THEN** the bridge SHALL call `pi.dispatchCommand("/ctx-stats", {streamingBehavior: "followUp"})`

#### Scenario: Path B delivery — absent defaults to "followUp"
- **WHEN** `send_prompt` text is `/ctx-stats` AND `msg.delivery` is absent AND `pi.dispatchCommand` is a function
- **THEN** the bridge SHALL call `pi.dispatchCommand("/ctx-stats", {streamingBehavior: "followUp"})`

#### Scenario: Path C — headless RPC session, dispatchCommand absent
- **WHEN** `send_prompt` text is `/ctx-stats` AND `pi.dispatchCommand` is NOT a function AND `isHeadlessRpcSession()` returns true
- **THEN** the bridge SHALL emit `command_feedback {command: "/ctx-stats", status: "started"}`
- **AND** the bridge SHALL emit `dispatch_extension_command {sessionId, command: "/ctx-stats", requestId}` to the server
- **AND** the server SHALL write `{"type":"prompt","message":"/ctx-stats","id":"<requestId>"}\n` to the session's keeper UDS / named pipe
- **AND** the server SHALL emit `command_feedback {command: "/ctx-stats", status: "completed"}` to browser subscribers (optimistic)
- **AND** the bridge SHALL NOT emit `command_feedback {status: "completed"}` for this dispatch

#### Scenario: Path D — non-headless session, dispatchCommand absent (error feedback)
- **WHEN** `send_prompt` text is `/ctx-stats` AND `pi.dispatchCommand` is NOT a function AND `isHeadlessRpcSession()` returns false (tmux / wt / unrecognized)
- **THEN** the bridge SHALL emit `command_feedback {status: "error", message: <rpc-keeper hint>}`
- **AND** the bridge SHALL return `true` from the dispatch helper
- **AND** the caller SHALL NOT call `pi.sendUserMessage` (extension commands cannot be dispatched via `sendUserMessage`)
- **AND** the bridge SHALL NOT emit `dispatch_extension_command`
- **AND** the error message SHALL include a hint to enable `useRpcKeeper: true` in `~/.pi/dashboard/config.json`

#### Scenario: Path D when no connection supplied
- **WHEN** `send_prompt` text is `/ctx-stats` AND `pi.dispatchCommand` is NOT a function AND no `connection` is supplied
- **THEN** the bridge SHALL emit `command_feedback {status: "error", message: <rpc-keeper hint>}`
- **AND** the bridge SHALL return `true` from the dispatch helper

#### Scenario: Error command_feedback on Path D
- **WHEN** a single dispatch takes Path D
- **THEN** the recorded `command_feedback` events for that command-text SHALL contain exactly one event with `status: "error"` and a message including the rpc-keeper hint

#### Scenario: Skill command expanded (unaffected)
- **WHEN** `send_prompt` text is `/skill:my-skill some args`
- **THEN** the handler SHALL expand the skill via `expandPromptTemplateFromDisk(text, cwd, pi)` and call `pi.sendUserMessage(<expanded>, { deliverAs })`
- **AND** SHALL NOT call `pi.dispatchCommand(...)` (skill commands are not extension commands)

#### Scenario: Prompt template expanded (unaffected)
- **WHEN** `send_prompt` text is `/some-prompt-template arg1 arg2` AND `some-prompt-template` is a registered prompt template (`source: "prompt"`)
- **THEN** the handler SHALL expand the template via `expandPromptTemplateFromDisk(text, cwd, pi)` and call `pi.sendUserMessage(<expanded>, { deliverAs })`
- **AND** SHALL NOT call `pi.dispatchCommand(...)` (prompt templates are not extension commands)

#### Scenario: Unrecognized slash falls through
- **WHEN** `send_prompt` text is `/totally-unknown-command` AND no entry with name `totally-unknown-command` exists in `pi.getCommands()`
- **THEN** the handler SHALL fall through to `pi.sendUserMessage("/totally-unknown-command", { deliverAs })`
- **AND** SHALL NOT emit `command_feedback` events for this text
- **AND** SHALL NOT call `pi.dispatchCommand(...)`

#### Scenario: Bridge-native command suppressed from extension detection
- **WHEN** `send_prompt` text is `/__dashboard_reload`
- **THEN** the handler SHALL fall through to `pi.sendUserMessage(...)` (bridge-native commands are excluded from extension detection via `DASHBOARD_NATIVE_COMMANDS`)
- **AND** SHALL NOT emit `command_feedback { status: "error" }` for it

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
9. Check for `/` prefix matching a known **extension command** (`source: "extension"` in `pi.getCommands()`, excluding `DASHBOARD_NATIVE_COMMANDS`) → dispatch via `pi.dispatchCommand` (Path B, when available) OR headless RPC dispatch (Path C, when headless) OR emit `command_feedback {error}` with rpc-keeper hint (Path D, non-headless without dispatchCommand)
10. Check for `/` prefix → fall through to template expansion + `pi.sendUserMessage()` (handles skills, prompt templates, unrecognized slashes)
11. Default (no `/` prefix) → `pi.sendUserMessage(text)` (existing passthrough behavior)

Note: pi-flows management commands (`/flows`, `/flows:new`, `/flows:edit`, `/flows:delete`, `/roles`) are registered by the pi-flows extension via `pi.registerCommand` and are therefore handled by step 9 (extension dispatch) when `pi.dispatchCommand` is available, by Path C when headless, or by Path D error feedback when non-headless without dispatchCommand.

#### Scenario: Routing precedence — bang beats slash
- **WHEN** `send_prompt` text is `!!echo /ctx-stats`
- **THEN** the handler SHALL execute `echo /ctx-stats` as a silent bash command
- **AND** SHALL NOT invoke any slash routing branch

#### Scenario: Routing precedence — user-defined flow run beats extension dispatch
- **WHEN** `send_prompt` text is `/deploy-prod` AND `deploy-prod` is a user-defined flow name returned by `getFlowsList()` AND ALSO appears in `pi.getCommands()`
- **THEN** the handler SHALL emit `flow:run { flowName: "deploy-prod" }` via `pi.events.emit(...)` (step 8 wins over step 9)
- **AND** SHALL NOT call `pi.dispatchCommand(...)` for this text

#### Scenario: Extension dispatch in non-headless emits error feedback
- **WHEN** `send_prompt` text is `/ctx-stats` AND `pi.dispatchCommand` is NOT a function AND session is non-headless (tmux/wt)
- **THEN** step 9's Path D SHALL emit `command_feedback {status: "error"}` with rpc-keeper hint
- **AND** the handler SHALL NOT fall through to `pi.sendUserMessage` for this command

### Requirement: Bridge feature-detects pi.dispatchCommand

The bridge's dispatch helper in `packages/extension/src/slash-dispatch.ts` SHALL feature-detect the presence of `pi.dispatchCommand` at call time using `hasDispatchCommand(pi)`.

`hasDispatchCommand` SHALL:
- Return `false` when `pi` is `null` or `undefined`
- Check `typeof pi.dispatchCommand === "function"` (traverses prototype chain)
- As a fallback, check `"dispatchCommand" in pi` with a guarded `typeof` on the resolved value (handles getter-backed / Proxy-hidden properties)

The bridge SHALL NOT use pi version strings, semver checks, or any other version-sniffing mechanism for this gate.

#### Scenario: pi.dispatchCommand is a function
- **WHEN** `hasDispatchCommand({ dispatchCommand: () => {} })` is called
- **THEN** SHALL return `true`

#### Scenario: pi.dispatchCommand is absent
- **WHEN** `hasDispatchCommand({})` is called
- **THEN** SHALL return `false`

#### Scenario: pi.dispatchCommand is not a function
- **WHEN** `hasDispatchCommand({ dispatchCommand: "yes" })` is called
- **THEN** SHALL return `false`

#### Scenario: pi is null or undefined
- **WHEN** `hasDispatchCommand(null)` or `hasDispatchCommand(undefined)` is called
- **THEN** SHALL return `false`

### Requirement: SendPrompt protocol carries optional delivery field

The `SendPromptToExtensionMessage` protocol message SHALL include an optional `delivery?: "steer" | "followUp"` field. When absent, the receiver SHALL treat it as `"followUp"`.

#### Scenario: delivery absent defaults to followUp
- **WHEN** `send_prompt` message does not include a `delivery` field
- **THEN** the bridge SHALL use `"followUp"` semantics (streamingBehavior on dispatchCommand)

#### Scenario: delivery "steer" propagates to streamingBehavior on Path B only
- **WHEN** `send_prompt` message includes `delivery: "steer"` AND `pi.dispatchCommand` is available
- **THEN** the bridge SHALL call `pi.dispatchCommand(text, { streamingBehavior: "steer" })`
