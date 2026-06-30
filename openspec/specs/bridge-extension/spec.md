## Purpose

Bridge extension behavior: forwards pi session events to the dashboard, tracks model and thinking-level changes, manages session lifecycle, and handles server→bridge control messages (abort, shutdown, stop-after-turn).
## Requirements
### Requirement: Dev build and server shutdown on reload cleanup
When `devBuildOnReload` is `true` in the loaded config, the bridge extension's cleanup function (called on `/reload`) SHALL perform the following before the normal cleanup:

1. Log `🔨 Dashboard: building client...` to the terminal
2. Run `execSync("npm run build", { cwd: <packageRoot>, stdio: "inherit" })` where packageRoot is resolved from `__dirname` (two levels up from `src/extension/`)
3. Log `✅ Dashboard: client built` on success, or log the error on failure
4. Log `🛑 Dashboard: stopping server...` to the terminal
5. Send `POST http://localhost:{port}/api/shutdown` (fire-and-forget)
6. Log `✅ Dashboard: server stopped`

Build or shutdown failures SHALL be caught and logged but SHALL NOT prevent the reload from completing.

#### Scenario: Cleanup with devBuildOnReload enabled
- **WHEN** `/reload` triggers the cleanup function and `config.devBuildOnReload` is `true`
- **THEN** the cleanup SHALL build the client and request server shutdown before disconnecting

#### Scenario: Cleanup with devBuildOnReload disabled
- **WHEN** `/reload` triggers the cleanup function and `config.devBuildOnReload` is `false`
- **THEN** the cleanup SHALL proceed normally without building or shutting down the server

#### Scenario: Build error is non-fatal
- **WHEN** `execSync("npm run build")` throws an error during cleanup
- **THEN** the error SHALL be logged and cleanup SHALL continue with the shutdown request

### Requirement: Retry port probe after failed server launch
When `launchServer` returns a failure result during the auto-start flow in `session_start`, the bridge extension SHALL re-probe the port using `isPortOpen(config.piPort)` before deciding whether to show a warning notification. If the re-probe returns `true` (port is now open), the bridge SHALL suppress the failure warning — another agent started the server concurrently. If the re-probe returns `false` (port is still closed), the bridge SHALL show the warning notification with the failure message.

#### Scenario: Concurrent launch — another agent started the server
- **WHEN** `launchServer` fails and the subsequent `isPortOpen` re-probe returns `true`
- **THEN** no warning notification SHALL be shown

#### Scenario: Genuine server failure
- **WHEN** `launchServer` fails and the subsequent `isPortOpen` re-probe returns `false`
- **THEN** the bridge SHALL show a warning notification with the failure message

#### Scenario: Single agent — successful launch
- **WHEN** `launchServer` succeeds on the first attempt
- **THEN** the bridge SHALL show the success notification as before (no behavioral change)

### Requirement: Command routing in send_prompt handler
The bridge extension's command handler SHALL parse `send_prompt` text for `!`, `!!`, and `/` prefixes and route them to the appropriate pi APIs instead of always calling `sendUserMessage()`.

Routing order:
1. `!!<cmd>` → silent bash via `pi.exec()`, forward `bash_output` event
2. `!<cmd>` → bash via `pi.exec()`, forward `bash_output` event + send to LLM
3. `/compact [args]` → `ctx.compact()` with optional custom instructions
4. `/` prefixed → `session.prompt(text)` for extension commands, skills, templates
5. Default → `pi.sendUserMessage(text)`

#### Scenario: Bang command routed to exec
- **WHEN** `send_prompt` arrives with text `!npm test`
- **THEN** the handler SHALL call `pi.exec()` with the command, NOT `sendUserMessage()`

#### Scenario: Compact routed to ctx.compact
- **WHEN** `send_prompt` arrives with text `/compact`
- **THEN** the handler SHALL call `ctx.compact()`, NOT `sendUserMessage()`

#### Scenario: Regular text unchanged
- **WHEN** `send_prompt` arrives with text `explain this function`
- **THEN** the handler SHALL call `sendUserMessage("explain this function")` as before

The command handler SHALL also handle `kill_process` messages by calling `killProcessByPgid(pgid)` from the process-scanner module.

#### Scenario: Kill process command received
- **WHEN** the command handler receives a `kill_process` message with a valid PGID
- **THEN** it SHALL call `killProcessByPgid(pgid)` and log the result

#### Scenario: Kill process for wrong session ignored
- **WHEN** the command handler receives a `kill_process` message with a sessionId that does not match the current session
- **THEN** it SHALL ignore the message

### Requirement: Hidden command registration
The bridge SHALL register a `__dashboard` command via `pi.registerCommand()` during `initBridge()`. The command SHALL have no description. The commands list sent to the server SHALL filter out commands whose names start with `__`.

#### Scenario: Dashboard command registered
- **WHEN** the bridge initializes
- **THEN** `pi.registerCommand("__dashboard", ...)` SHALL be called

#### Scenario: Hidden commands filtered from list
- **WHEN** the bridge sends a `commands_list` message
- **THEN** commands with names starting with `__` SHALL be excluded

### Requirement: Cached session for prompt routing
The bridge SHALL store a reference to the agent session (from `cachedCtx`) that exposes `prompt()` for routing slash commands. The command handler SHALL receive this reference via its options/dependencies.

#### Scenario: Session reference passed to handler
- **WHEN** a slash command needs routing via `session.prompt()`
- **THEN** the command handler SHALL have access to the session's `prompt()` method through its stored context reference

### Requirement: UI proxy activation on session start
The bridge extension SHALL activate the UI proxy in the `session_start` handler. The proxy SHALL wrap `ctx.ui.confirm`, `ctx.ui.select`, `ctx.ui.input`, `ctx.ui.editor`, and `ctx.ui.notify` with dashboard-forwarding versions. The proxy SHALL receive the WebSocket connection, session ID getter, and `ctx.hasUI` flag.

#### Scenario: Proxy activated on session start
- **WHEN** the bridge's `session_start` handler fires
- **THEN** the UI proxy SHALL be applied to `ctx.ui`, replacing dialog and notify methods

#### Scenario: Proxy receives response messages
- **WHEN** the bridge's `onMessage` handler receives an `extension_ui_response` message
- **THEN** it SHALL forward the message to the UI proxy for promise resolution

### Requirement: UI proxy handles reconnection
When the bridge reconnects to the dashboard server, the UI proxy's pending requests are NOT replayed (they are tied to the original dialog call which may have already resolved or timed out). The proxy SHALL continue to work with the new connection for future dialog calls.

#### Scenario: Reconnection does not replay pending requests
- **WHEN** the bridge reconnects to the dashboard server
- **THEN** existing pending requests in the UI proxy SHALL remain in their current state (resolved by TUI or timed out)

### Requirement: Bridge registers ask_user tool
The bridge extension SHALL register an `ask_user` tool via `pi.registerTool()` during `initBridge()`. The tool SHALL have the same parameters, description, promptSnippet, and promptGuidelines as the current `.pi/extensions/ask-user.ts`. The tool's `execute` method SHALL call `ctx.ui.confirm`, `ctx.ui.select`, `ctx.ui.input`, or `ctx.ui.multiselect` based on the `method` parameter — which are already proxied by the UI proxy to the dashboard.

#### Scenario: ask_user tool registered on init
- **WHEN** `initBridge(pi)` runs
- **THEN** `pi.registerTool()` SHALL be called with `name: "ask_user"`

#### Scenario: ask_user confirm call
- **WHEN** the LLM calls `ask_user` with `method: "confirm"` and `title: "Proceed?"`
- **THEN** the tool SHALL call `ctx.ui.confirm("Proceed?", message)` and return the result

#### Scenario: ask_user select call
- **WHEN** the LLM calls `ask_user` with `method: "select"`, `title: "Pick one"`, and `options: ["A", "B"]`
- **THEN** the tool SHALL call `ctx.ui.select("Pick one", ["A", "B"])` and return the result

### Requirement: Dashboard-spawned sessions override existing ask_user
When `PI_DASHBOARD_SPAWNED` environment variable is set to `"1"`, the bridge SHALL always register the `ask_user` tool, overriding any existing tool with the same name. The dashboard is the primary UI for these sessions and must control the ask_user flow.

#### Scenario: Dashboard-spawned overrides existing tool
- **WHEN** `PI_DASHBOARD_SPAWNED=1` and another extension already registered `ask_user`
- **THEN** the bridge SHALL register `ask_user` anyway, overriding the existing registration

#### Scenario: Dashboard-spawned with no existing tool
- **WHEN** `PI_DASHBOARD_SPAWNED=1` and no `ask_user` tool exists
- **THEN** the bridge SHALL register `ask_user` normally

### Requirement: User-launched sessions respect existing ask_user
When `PI_DASHBOARD_SPAWNED` is not set, the bridge SHALL check `pi.getAllTools()` for an existing `ask_user` tool before registering. If one already exists, the bridge SHALL skip registration to respect the user's custom implementation.

#### Scenario: User-launched with existing custom ask_user
- **WHEN** `PI_DASHBOARD_SPAWNED` is not set and `pi.getAllTools()` contains a tool named `ask_user`
- **THEN** the bridge SHALL NOT register `ask_user`

#### Scenario: User-launched with no existing tool
- **WHEN** `PI_DASHBOARD_SPAWNED` is not set and no `ask_user` tool exists in `pi.getAllTools()`
- **THEN** the bridge SHALL register `ask_user`

### Requirement: Standalone ask_user extension removed
The standalone `.pi/extensions/ask-user.ts` file SHALL be removed from the project. The `ask_user` tool is now provided by the bridge extension.

#### Scenario: File removed
- **WHEN** the project is built
- **THEN** `.pi/extensions/ask-user.ts` SHALL NOT exist

### Requirement: Bridge listens to flow events on pi.events
The bridge extension SHALL register listeners on `pi.events` for all `flow:*` event names and forward them as `event_forward` messages using the mapped `eventType` values defined in the flow-event-bridge spec.

#### Scenario: Flow event listeners registered at activation
- **WHEN** the bridge extension activates and `pi.events` is available
- **THEN** listeners SHALL be registered for `flow:flow-started`, `flow:agent-started`, `flow:agent-complete`, `flow:subagent-tool-call`, `flow:subagent-tool-result`, `flow:assistant-text`, `flow:thinking-text`, `flow:loop-iteration`, `flow:auto-decision`, `flow:complete`

#### Scenario: pi.events not available
- **WHEN** `pi.events` is not available (pi-flows not installed)
- **THEN** the bridge SHALL continue to function normally without flow event forwarding

### Requirement: Bridge handles flow_control messages from server
The bridge SHALL handle incoming `flow_control` messages from the server. For `action: "abort"`, it SHALL call the existing abort mechanism. For `action: "toggle_autonomous"`, it SHALL emit a `flow:toggle-autonomous` event on `pi.events` or call the pi-flows autonomous mode API.

#### Scenario: Abort flow control received
- **WHEN** the bridge receives `{ type: "flow_control", action: "abort" }`
- **THEN** the bridge SHALL emit `flow:abort` on `pi.events` (pi-flows listens for this and calls `flowManager.abort()`)

#### Scenario: Toggle autonomous control received
- **WHEN** the bridge receives `{ type: "flow_control", action: "toggle_autonomous" }`
- **THEN** the bridge SHALL emit `flow:toggle-autonomous` on `pi.events` (pi-flows listens for this and toggles `setAutonomousMode`)

### Requirement: Heartbeat acknowledgment handling
The bridge extension SHALL treat incoming `heartbeat_ack` messages as server liveness signals. These messages SHALL be processed by the `ConnectionManager`'s `onMessage` handler, which updates the `lastMessageAt` timestamp used by the watchdog timer.

#### Scenario: Heartbeat ack received
- **WHEN** the bridge receives a `{ type: "heartbeat_ack" }` message from the server
- **THEN** the `ConnectionManager`'s `lastMessageAt` timestamp SHALL be updated
- **AND** no further processing SHALL be required (the ack is consumed by the connection layer)

#### Scenario: Heartbeat sent triggers ack
- **WHEN** the bridge sends a `session_heartbeat` to the server
- **THEN** the server SHALL respond with `heartbeat_ack`
- **AND** the bridge SHALL receive it within the normal WebSocket delivery time

### Requirement: Event subscription model change
The bridge extension's event subscription SHALL change from a curated whitelist to a comprehensive subscription of all pi core event types (minus exclusions). The `model_select` enrichment (adding `thinkingLevel`) and `turn_end` enrichment (adding `contextUsage`) SHALL be preserved. OpenSpec detection and stats extraction are handled server-side.

#### Scenario: All core events forwarded
- **WHEN** any pi core event fires (except `context` and `before_provider_request`)
- **THEN** it SHALL be forwarded as an `event_forward` protocol message

#### Scenario: model_select enrichment preserved
- **WHEN** a `model_select` event fires
- **THEN** it SHALL be enriched with `thinkingLevel` and forwarded as `event_forward`

### Requirement: Bridge sends process PID at registration
The bridge SHALL include `process.pid` (the Node.js process ID) in the `session_register` message sent to the server.

#### Scenario: PID included in registration
- **WHEN** the bridge sends a `session_register` message
- **THEN** the message SHALL include a `pid` field set to `process.pid`

#### Scenario: PID is a positive integer
- **WHEN** the bridge registers
- **THEN** the `pid` value SHALL be a positive integer

### Requirement: Bridge wires process scanner timer
The bridge extension SHALL start a process scanner timer during session initialization (alongside existing heartbeat and git poll timers). The timer SHALL call `scanChildProcesses(process.pid)` every 10 seconds. The timer SHALL be added to the bridge state's `timers` array for cleanup on disconnect.

#### Scenario: Timer starts on session init
- **WHEN** the bridge connects and registers a session
- **THEN** a 10-second interval timer for process scanning SHALL be started

#### Scenario: Timer cleared on cleanup
- **WHEN** the bridge disconnects or the session ends
- **THEN** the process scan timer SHALL be cleared via the timers array cleanup

### Requirement: Bridge sends process_list only on change
The bridge SHALL maintain the previous process scan result (array of PIDs). After each scan, it SHALL compare the current PID set to the previous one. A `process_list` message SHALL only be sent when the sets differ.

#### Scenario: First scan with active processes
- **WHEN** the first scan returns two processes
- **THEN** a `process_list` message SHALL be sent (previous was empty)

#### Scenario: Subsequent scan unchanged
- **WHEN** the scan returns the same PIDs as the previous scan
- **THEN** no `process_list` message SHALL be sent

#### Scenario: Process exits between scans
- **WHEN** a previously reported process is no longer in the scan
- **THEN** a `process_list` message SHALL be sent with the updated list

### Requirement: Bridge uses mDNS discovery for server connection
The bridge extension SHALL use mDNS browsing as the primary mechanism to discover the dashboard server, falling back to config-based port probe when mDNS is unavailable.

#### Scenario: Server found via mDNS
- **WHEN** the bridge extension starts and a `_pi-dashboard._tcp` service is advertised on localhost
- **THEN** the bridge SHALL connect to the discovered server's piPort

#### Scenario: mDNS times out — fallback to config
- **WHEN** mDNS browse returns no results within 2 seconds
- **THEN** the bridge SHALL fall back to probing `localhost:<config.piPort>` with `isDashboardRunning()`

#### Scenario: Auto-start with mDNS
- **WHEN** no server is found via mDNS or fallback and `autoStart` is `true`
- **THEN** the bridge SHALL launch the server as a detached process
- **AND** wait for the server's mDNS advertisement (up to 10 seconds, fallback to config probe) before connecting

### Requirement: Remove OpenSpec activity detection from bridge
The bridge extension SHALL NOT call `detectOpenSpecActivity()` or track OpenSpec state (`currentOpenSpecPhase`, `currentOpenSpecChange`). It SHALL NOT send `openspec_activity_update` protocol messages. The `tool_execution_start` and `agent_end` events SHALL be forwarded as raw `event_forward` messages without OpenSpec processing.

#### Scenario: tool_execution_start forwarded without OpenSpec detection
- **WHEN** a `tool_execution_start` event fires
- **THEN** the bridge SHALL forward it as an `event_forward` and SHALL NOT run `detectOpenSpecActivity()`

#### Scenario: agent_end forwarded without OpenSpec clear
- **WHEN** an `agent_end` event fires
- **THEN** the bridge SHALL forward it as an `event_forward` and SHALL NOT send `openspec_activity_update`

### Requirement: Remove stats_update message send from bridge
The bridge extension SHALL NOT call `extractTurnStats()` or send `stats_update` protocol messages. The `turn_end` event SHALL be forwarded as a raw `event_forward` message.

The bridge SHALL enrich `turn_end` events with `contextUsage` from `ctx.getContextUsage()` before forwarding, since this data is only available via the pi process API.

#### Scenario: turn_end forwarded with contextUsage enrichment
- **WHEN** a `turn_end` event fires
- **THEN** the bridge SHALL attach `contextUsage` (from `ctx.getContextUsage()`) to the event data and forward it as `event_forward`

#### Scenario: No stats_update message sent
- **WHEN** a `turn_end` event fires
- **THEN** the bridge SHALL NOT send a `stats_update` protocol message

### Requirement: Remove redundant model_update send after model_select
The bridge's `model_select` handler SHALL NOT call `sendModelUpdateIfChanged()`. The event is already enriched with `thinkingLevel` and forwarded — the server extracts model/thinkingLevel via `extractSessionUpdates()`.

The `model_update` protocol message type is retained for state sync on reconnect (sent from `sendStateSync`), not removed.

#### Scenario: model_select does not trigger model_update
- **WHEN** a `model_select` event fires
- **THEN** the bridge SHALL enrich it with `thinkingLevel`, forward as `event_forward`, and SHALL NOT call `sendModelUpdateIfChanged()`

### Requirement: Skill command intercepts and injects SKILL.md
When a `/skill:<name>` command is sent from the dashboard, the bridge extension's `sessionPrompt` handler SHALL detect the skill command pattern, look up the skill's SKILL.md path from `pi.getCommands()`, read the file content, and send it as a user message so the LLM receives the skill context. If the skill is not found, the command SHALL be sent as-is (fallback to current behavior).

#### Scenario: Known skill command injects SKILL.md content
- **WHEN** the user sends `/skill:openspec-explore` from the dashboard
- **THEN** the bridge looks up "skill:openspec-explore" in `pi.getCommands()`
- **AND** reads the SKILL.md file at the command's `path` field
- **AND** sends the SKILL.md content as a user message to the LLM

#### Scenario: Unknown skill falls back to plain message
- **WHEN** the user sends `/skill:nonexistent` from the dashboard
- **AND** no matching command with `source: "skill"` exists
- **THEN** the text is sent as a regular user message (current behavior)

#### Scenario: Skill command with additional text
- **WHEN** the user sends `/skill:openspec-explore some additional context`
- **THEN** the SKILL.md content is sent followed by the additional context text

### Requirement: Extension server-launcher captures stderr to log file
The bridge extension's `launchServer` function in `packages/extension/src/server-launcher.ts` SHALL capture stdout and stderr of the spawned server process to `~/.pi/dashboard/server.log` (opened in append mode), rather than using `stdio: "ignore"`. The child SHALL remain detached and `unref`'d.

#### Scenario: Launch failure surfaces in log
- **WHEN** the extension spawns the server and the child process exits immediately with an error (e.g. `ERR_UNSUPPORTED_ESM_URL_SCHEME`, missing loader, port bind failure)
- **THEN** the error output SHALL be appended to `~/.pi/dashboard/server.log`
- **AND** SHALL be readable without re-running the command

#### Scenario: Successful launch still detaches
- **WHEN** the extension spawns the server and it starts successfully
- **THEN** the child SHALL be `unref`'d and the parent pi process SHALL be free to exit without terminating the server

### Requirement: Auto-start failure notification includes log path
When the bridge's `autoStartServer` flow catches a `launchServer` failure, the `ui.notify` message SHALL include the absolute path to `~/.pi/dashboard/server.log` so users can inspect the crash output without prior knowledge of the convention.

#### Scenario: Failure notification surfaces log path
- **WHEN** `launchServer` returns `{ success: false }` or throws during auto-start
- **THEN** `ui.notify` SHALL be called with a message that includes the absolute path `~/.pi/dashboard/server.log` (or its platform-expanded equivalent)

### Requirement: Bridge does not call pi session-replacement APIs

The bridge extension SHALL NOT invoke `pi.newSession(...)`, `ctx.fork(...)`, or `ctx.switchSession(...)` from any code under `packages/extension/src/` (excluding `__tests__/`).

These three APIs trigger pi's session-replacement flow, which (per pi 0.69.0+) invalidates any captured pre-replacement `pi`/`ctx`/session-bound objects on next access. The bridge holds long-lived caches (`cachedCtx`, `cachedModelRegistry`, `cachedHasUI` in `bridge.ts`; `modelRegistry` in `provider-register.ts`) that depend on pi being the *only* originator of session replacement, so we can re-capture inside the resulting `session_start` handler (see existing handler at `bridge.ts` `pi.on("session_start", ...)` keying on `event.reason ∈ {"new","fork","resume"}`).

#### Scenario: Source-grep guard fails the build on a new replacement call
- **WHEN** any `.ts` file under `packages/extension/src/` (other than `__tests__/`) contains the literal substring `pi.newSession(`, `ctx.fork(`, or `ctx.switchSession(`
- **THEN** the test `packages/extension/src/__tests__/no-session-replacement-calls.test.ts` SHALL fail with the offending file:line

#### Scenario: Allowed within tests
- **WHEN** the same substrings appear under `packages/extension/src/__tests__/` (e.g. mocking pi for a unit test)
- **THEN** the guard test SHALL ignore them

### Requirement: Bridge cached session state is session-scoped

`cachedCtx`, `cachedModelRegistry`, and `cachedHasUI` in `bridge.ts`, and the `modelRegistry` reference in `provider-register.ts`, SHALL be treated as session-scoped. They SHALL be re-captured in every `session_start` handler invocation (regardless of `event.reason`) and SHALL NOT be read after `session_shutdown` for that session has fired.

#### Scenario: session_start re-captures ctx and modelRegistry
- **WHEN** `pi.on("session_start", ...)` fires
- **THEN** `cachedCtx` and `cachedModelRegistry` SHALL be assigned from the freshly emitted `ctx`
- **AND** any later-registered listener that reads them SHALL see the new references, not the previous session's

#### Scenario: No session-bound access after shutdown
- **WHEN** `session_shutdown` fires for the current session
- **THEN** subsequent code paths SHALL NOT invoke session-bound methods on `cachedCtx` (e.g. `cachedCtx.sessionManager.getSessionId()`)
- **AND** the bridge SHALL wait for the next `session_start` re-capture before resuming session-bound work

### Requirement: Bridge SHALL NOT register a TUI multiselect arm that consumes `originals.custom`

The bridge extension's TUI PromptBus adapter (registered in `packages/extension/src/bridge.ts` when `ctx.hasUI === true`) MUST NOT contain an `else if (prompt.type === "multiselect" && ... originals.custom ...)` arm that calls `await originals.custom(...)` and uses its resolution to drive a `bus.respond(...)` call.

The reason: pi 0.70's RPC mode (used by every dashboard-spawned headless session) defines `ExtensionUIContext.custom` as an unconditional no-op:

```javascript
async custom() {
    // Custom UI not supported in RPC mode
    return undefined;
},
```

(source: `~/.nvm/.../@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-mode.js:150-152`)

Any TUI adapter arm that awaits `originals.custom(...)` in dashboard headless mode will therefore receive `undefined` synchronously (one event-loop tick), interpret it as cancellation, and call `bus.respond({ cancelled: true, source: "tui" })`. The PromptBus's first-response-wins semantics will then dismiss the dashboard's already-rendered `MultiselectRenderer` before the user can interact with it.

The bridge's `ctx.ui.multiselect` PromptBus patch (added by the predecessor change `fix-multiselect-auto-cancel-on-dashboard`) already routes multiselect through the bus to the `DashboardDefaultAdapter`, which renders a working browser dialog via the registered client `MultiselectRenderer`. No TUI adapter participation is needed for dashboard sessions, and pure-TUI sessions on pi 0.70 RPC have no working `ctx.ui.custom` path to participate through anyway. The TUI multiselect arm is therefore prohibited until pi-coding-agent restores `ctx.ui.custom` in RPC mode.

This requirement is enforced by a repository-level lint test (`packages/extension/src/__tests__/no-tui-multiselect-arm-regression.test.ts`) that scans `bridge.ts` and fails if the source contains the co-occurrence of `originals.custom` AND `prompt.type === "multiselect"`. Either substring alone is permitted — the prohibition is on the combination.

#### Scenario: Lint passes when `bridge.ts` does not contain the offending co-occurrence
- **WHEN** the lint test reads `packages/extension/src/bridge.ts` source
- **AND** the source does NOT contain `originals.custom` and `prompt.type === "multiselect"` together
- **THEN** the lint test SHALL pass

#### Scenario: Lint fails if a contributor re-adds the TUI multiselect arm
- **WHEN** a future refactor adds back the `else if (prompt.type === "multiselect" && ... originals.custom)` arm
- **THEN** the lint test `no-tui-multiselect-arm-regression.test.ts` SHALL fail with a message that includes the file path, the matched lines, and a one-line pointer to this change name

#### Scenario: `originals.custom` capture without consumption is permitted
- **WHEN** `bridge.ts` captures `originals.custom = ctx.ui.custom?.bind(ctx.ui)` (e.g., for a *different* future use that does not include `prompt.type === "multiselect"`)
- **THEN** the lint test SHALL pass — the prohibited pattern is the co-occurrence, not either substring alone

#### Scenario: `prompt.type === "multiselect"` outside the TUI adapter is permitted
- **WHEN** `bridge.ts` references `type: "multiselect"` in the `(ctx.ui as any).multiselect = (title, options, opts) => bus.request({ type: "multiselect", ... })` patch
- **THEN** the lint test SHALL pass — that string is in the patch site, not in the TUI adapter, and is part of the working bus-routed primary path

### Requirement: Bridge SHALL patch `ctx.ui.multiselect` alongside select/input/confirm/editor

The bridge extension's `session_start` PromptBus patching block in `packages/extension/src/bridge.ts` (currently lines ~935-948) SHALL include an assignment of `multiselect` onto `ctx.ui`, parallel to the existing `select`, `input`, `confirm`, and `editor` patches. Omitting this assignment is the regression that caused the dashboard multiselect to silently auto-cancel — the `polyfillMultiselect` helper consults `ctx.ui.multiselect` as its primary path, and without the patch it falls into a TUI-only `ctx.ui.custom` branch that does not render a browser dialog in dashboard / RPC mode.

The assignment MUST issue `bus.request` with `type: "multiselect"` and decode the response per the rules in the `multiselect-dialog` capability ("Bridge routes `ctx.ui.multiselect` through PromptBus" requirement). The decode helper (referred to here as `decodeMultiselectAnswer`) SHALL be a pure function over `{ cancelled, answer }` so it can be exercised in unit tests without instantiating a live PromptBus.

If `(ctx.ui as any).multiselect` is already a function before the patch runs (defensive — covers future upstream additions to pi's `ExtensionUIContext`), the bridge SHALL emit a one-time `console.warn("[bridge] ctx.ui.multiselect already exists — overriding for PromptBus routing")` and proceed with the assignment. The override is intentional: even if pi later ships a built-in `ctx.ui.multiselect`, the bridge's bus-routed version is the one that participates in PromptBus's first-response-wins semantics.

#### Scenario: Patch block assigns ctx.ui.multiselect
- **WHEN** the bridge's `session_start` handler runs through the PromptBus patching block on a stub `ctx`
- **THEN** `typeof ctx.ui.multiselect === "function"` SHALL be true after the block completes

#### Scenario: Patched method dispatches the correct bus.request
- **WHEN** an extension calls `ctx.ui.multiselect("Pick", ["a","b"], { message: "ctx" })` after the patch
- **THEN** `bus.request` SHALL be called with `{ pipeline: "command", type: "multiselect", question: "Pick", options: ["a","b"], metadata: { message: "ctx" } }`

#### Scenario: Decode helper handles all four response shapes
- **WHEN** `decodeMultiselectAnswer({ cancelled: true })` is called → SHALL return `undefined`
- **WHEN** `decodeMultiselectAnswer({ cancelled: false, answer: '["a","b"]' })` → SHALL return `["a","b"]`
- **WHEN** `decodeMultiselectAnswer({ cancelled: false, answer: "[]" })` → SHALL return `[]` (empty selection)
- **WHEN** `decodeMultiselectAnswer({ cancelled: false, answer: "not-json" })` → SHALL return `[]` (graceful degradation, no throw)

#### Scenario: Pre-existing ctx.ui.multiselect triggers a warning, not an error
- **WHEN** the bridge's patch block runs against a `ctx` whose `ui.multiselect` is already a function
- **THEN** `console.warn` SHALL be called with a message containing `"already exists"`
- **AND** the patch SHALL still complete (the bus-routed version replaces the prior assignment)
- **AND** subsequent calls to `ctx.ui.multiselect(...)` SHALL flow through `bus.request`, not the prior implementation

### Requirement: Bridge anchors jiti loader resolution at the active pi cli

The bridge extension SHALL resolve pi's TypeScript loader (jiti) by anchoring `createRequire` at `process.argv[1]` (the active pi cli's entry point) and probing the following package names in order:

1. `jiti` — the un-namespaced upstream package shipped by `@earendil-works/pi-coding-agent` (the primary fork).
2. `@mariozechner/jiti` — the namespaced fork shipped by `@mariozechner/pi-coding-agent` (legacy).

The bridge SHALL NOT probe `@oh-my-pi/jiti`. If neither name resolves, the bridge SHALL surface the error message "Cannot find pi's TypeScript loader (jiti). Is `@earendil-works/pi-coding-agent` or `@mariozechner/pi-coding-agent` installed?" — naming both supported forks in primary-first order, never naming `@oh-my-pi`.

#### Scenario: Earendil pi resolves bare jiti

- **WHEN** the bridge runs inside `@earendil-works/pi-coding-agent`'s Node.js process
- **THEN** `createRequire(piCli).resolve("jiti/package.json")` succeeds
- **AND** `@mariozechner/jiti` is never probed

#### Scenario: Legacy pi falls through to namespaced jiti

- **WHEN** the bridge runs inside `@mariozechner/pi-coding-agent`'s Node.js process
- **THEN** the bare-jiti probe fails fast
- **AND** `createRequire(piCli).resolve("@mariozechner/jiti/package.json")` succeeds

#### Scenario: Error message lists supported forks only

- **WHEN** neither jiti name resolves (e.g., pi is not installed)
- **THEN** the thrown error message SHALL list `@earendil-works/pi-coding-agent` and `@mariozechner/pi-coding-agent`
- **AND** SHALL NOT mention `@oh-my-pi/pi-coding-agent`

### Requirement: Slash dispatch helper applies three-way decision
The `tryDispatchExtensionCommand(pi, text, sessionId, sink, connection)` helper in `packages/extension/src/slash-dispatch.ts` SHALL apply a three-way decision (extending the two-way Path B / Path D logic introduced by `fix-extension-slash-commands-in-dashboard`):

1. **Path B**: when `hasDispatchCommand(pi)` is true → call `pi.dispatchCommand(text, {streamingBehavior: "followUp"})`. Emit `started` before, `completed`/`error` after.

2. **Path C**: when `hasDispatchCommand(pi)` is false AND `isHeadlessRpcSession()` is true → emit `started`; emit `dispatch_extension_command` to the server via the connection; **do NOT emit a terminal event** (server emits it).

3. **Path D (stopgap)**: when `hasDispatchCommand(pi)` is false AND `isHeadlessRpcSession()` is false → emit `started` followed by `error` with the existing pi-version-requirement message.

The helper SHALL maintain its existing return shape: `Promise<boolean>` where `true` indicates the helper handled the text (caller MUST NOT fall through to template expansion or `sendUserMessage`); `false` indicates the text is not an extension command (caller proceeds with existing fallback).

The helper SHALL accept a new optional parameter `connection` (the bridge's WebSocket connection manager) to send `dispatch_extension_command`. If `connection` is undefined (e.g. called from a unit test without a server connection), Path C SHALL gracefully degrade to Path D.

#### Scenario: Path B preferred when pi.dispatchCommand exists
- **GIVEN** `pi.dispatchCommand` is a function AND `text` is `/ctx-stats` AND `ctx-stats` is in `pi.getCommands()` with `source: "extension"`
- **WHEN** `tryDispatchExtensionCommand(pi, text, sessionId, sink, connection)` is called
- **THEN** `pi.dispatchCommand("/ctx-stats", {streamingBehavior: "followUp"})` SHALL be invoked
- **AND** sink SHALL receive `command_feedback {status: "started"}` then `{status: "completed"}`
- **AND** `connection.send` SHALL NOT be called for `dispatch_extension_command`
- **AND** the helper SHALL return `true`

#### Scenario: Path C activated when headless RPC and dispatchCommand absent
- **GIVEN** `pi.dispatchCommand` is undefined AND `isHeadlessRpcSession()` returns true AND `text` is `/ctx-stats`
- **WHEN** `tryDispatchExtensionCommand(pi, text, sessionId, sink, connection)` is called
- **THEN** sink SHALL receive `command_feedback {status: "started"}`
- **AND** `connection.send` SHALL be called with `{type: "dispatch_extension_command", sessionId, command: "/ctx-stats", requestId: <uuid>}`
- **AND** sink SHALL NOT receive a terminal `command_feedback` event from this helper (server emits it)
- **AND** the helper SHALL return `true`

#### Scenario: Path D stopgap when not headless and dispatchCommand absent
- **GIVEN** `pi.dispatchCommand` is undefined AND `isHeadlessRpcSession()` returns false AND `text` is `/ctx-stats`
- **WHEN** `tryDispatchExtensionCommand(pi, text, sessionId, sink, connection)` is called
- **THEN** sink SHALL receive `command_feedback {status: "started"}` followed by `{status: "error", message: <pi version requirement>}`
- **AND** `connection.send` SHALL NOT be called
- **AND** the helper SHALL return `true`

#### Scenario: Path C degrades to Path D when connection is undefined
- **GIVEN** `pi.dispatchCommand` is undefined AND `isHeadlessRpcSession()` returns true AND `connection` argument is undefined
- **WHEN** `tryDispatchExtensionCommand(pi, text, sessionId, sink, undefined)` is called
- **THEN** the helper SHALL fall through to Path D and emit `started` + `error`
- **AND** the helper SHALL NOT throw

#### Scenario: Non-extension command unaffected
- **GIVEN** `text` is `/skill:foo` (source: "skill") OR `/totally-unknown` (no match in getCommands)
- **WHEN** `tryDispatchExtensionCommand(pi, text, sessionId, sink, connection)` is called
- **THEN** the helper SHALL return `false`
- **AND** sink SHALL NOT receive any `command_feedback` events
- **AND** `connection.send` SHALL NOT be called for `dispatch_extension_command`

### Requirement: Bridge wires connection into slash-dispatch helper call sites
Both call sites of `tryDispatchExtensionCommand` (`bridge.ts::sessionPrompt` and `command-handler.ts`'s slash else-arm) SHALL pass the bridge's `ConnectionManager` as the `connection` argument.

In `command-handler.ts`'s slash else-arm (the test-shim path used when `options.sessionPrompt` is undefined), the `connection` argument MAY be undefined (e.g. unit tests without a real connection); the helper degrades to Path D as specified above.

#### Scenario: Bridge sessionPrompt passes connection
- **WHEN** the bridge's `sessionPrompt(text)` callback is invoked for an extension slash command in a headless RPC pi
- **THEN** `tryDispatchExtensionCommand` SHALL be called with `connection: <bridge's ConnectionManager>`
- **AND** Path C SHALL fire and emit `dispatch_extension_command` via the connection

#### Scenario: command-handler else-arm without connection
- **WHEN** `command-handler.ts`'s slash else-arm runs (in a unit test or non-bridge context) AND `options.sessionPrompt` is undefined AND `options.eventSink` is provided
- **THEN** `tryDispatchExtensionCommand` SHALL be called with `connection: undefined`
- **AND** the helper SHALL degrade to Path D for any extension slash command (no `dispatch_extension_command` emitted)

### Requirement: Default model applied only to brand-new sessions

The bridge extension SHALL apply `config.defaultModel` (via `pi.setModel()`) only when the spawned pi process represents a brand-new session — i.e. when `ctx.sessionManager.buildSessionContext().messages.length === 0` at the time the bridge handles `session_start`. For sessions with existing messages (resumed via `--session`, forked via `--fork`, or reloaded mid-process), the bridge SHALL NOT call `pi.setModel()` and SHALL leave the session's existing model untouched.

The detection signal SHALL be the count of `message` entries returned by `ctx.sessionManager.buildSessionContext().messages`, NOT the raw entry count from `ctx.sessionManager.getEntries()`. This mirrors pi's own `hasExistingSession` predicate in `pi-coding-agent/dist/core/sdk.js` (`existingSession.messages.length > 0`). Pi auto-appends `model_change` and `thinking_level_change` setup entries to a brand-new session BEFORE emitting `session_start`, so `getEntries().length` is ≥ 2 even for sessions with no user history; only `buildSessionContext().messages` correctly distinguishes "brand-new" from "has history".

If `ctx.sessionManager.buildSessionContext` is unavailable (older pi versions), the bridge SHALL fall back to `0` (apply the default model) rather than `Infinity` (skip it) — preferring a one-time model overwrite on resume over silent failure on new sessions.

This rule SHALL apply to both call sites of the default-model application:

1. The direct call inside the `session_start` handler.
2. The deferred retry path that fires when a previously-unavailable custom provider becomes ready after `session_start` (`pendingDefaultModel`).

The pre-existing gate on `event.reason === "startup"` SHALL remain in place; the message-count check is an additional AND condition, not a replacement.

#### Scenario: Brand-new session gets default model

- **WHEN** the dashboard spawns pi without `--session` or `--fork` and `session_start` fires with `reason === "startup"`
- **AND** `ctx.sessionManager.buildSessionContext().messages.length === 0`
- **AND** `config.defaultModel` is set and the model is resolvable in the model registry
- **THEN** the bridge SHALL call `pi.setModel()` with the resolved default model

#### Scenario: Brand-new session with pre-emit setup entries gets default model

- **WHEN** the dashboard spawns pi without `--session` or `--fork` and `session_start` fires with `reason === "startup"`
- **AND** pi has auto-appended `model_change` and `thinking_level_change` entries to the session via `sdk.js` (so `ctx.sessionManager.getEntries().length === 2`)
- **AND** `ctx.sessionManager.buildSessionContext().messages.length === 0` (those setup entries are not messages)
- **AND** `config.defaultModel` is set and resolvable
- **THEN** the bridge SHALL call `pi.setModel()` with the resolved default model
- **AND** the bridge SHALL NOT be misled by the non-zero `getEntries()` count

#### Scenario: Resumed session keeps its existing model

- **WHEN** the dashboard spawns pi with `--session <file>` and `session_start` fires with `reason === "startup"`
- **AND** `ctx.sessionManager.buildSessionContext().messages.length > 0` (the persisted session had prior user/assistant messages)
- **THEN** the bridge SHALL NOT call `pi.setModel()`
- **AND** the session SHALL continue with whatever model pi loaded from the persisted session

#### Scenario: Forked session inherits parent's model

- **WHEN** the dashboard spawns pi with `--fork <file>` and `session_start` fires with `reason === "startup"`
- **AND** `ctx.sessionManager.buildSessionContext().messages.length > 0` (parent messages copied by `SessionManager.forkFrom`)
- **THEN** the bridge SHALL NOT call `pi.setModel()`
- **AND** the forked session SHALL run with the model inherited from the parent session

#### Scenario: Bridge reload of in-flight session keeps model

- **WHEN** the bridge reloads (e.g. via `/reload`) while a session has prior messages
- **AND** `session_start` re-fires with `reason === "startup"` (or `"reload"`, which is also filtered by the reason gate)
- **AND** `ctx.sessionManager.buildSessionContext().messages.length > 0`
- **THEN** the bridge SHALL NOT call `pi.setModel()`

#### Scenario: Custom provider readiness retry respects the gate

- **WHEN** a brand-new session (`messages.length === 0`) triggers default-model application but the configured model's provider is not yet registered, so `pendingDefaultModel` is set
- **AND** later the provider becomes ready and the retry fires
- **THEN** the bridge SHALL apply the default model

- **WHEN** a resumed or forked session (`messages.length > 0`) reaches `session_start` and `pendingDefaultModel` is left null (because the message-count gate returned false)
- **AND** the provider becomes ready later
- **THEN** no default-model application SHALL occur

#### Scenario: Default model not configured

- **WHEN** any session starts and `config.defaultModel` is unset
- **THEN** the bridge SHALL NOT call `pi.setModel()` regardless of message count

#### Scenario: Older pi without buildSessionContext falls back to apply

- **WHEN** the bridge runs against a pi version where `ctx.sessionManager.buildSessionContext` is undefined
- **AND** `session_start` fires with `reason === "startup"`
- **AND** `config.defaultModel` is set and resolvable
- **THEN** the bridge SHALL treat the message count as `0` (via optional-chaining `?? 0`)
- **AND** the bridge SHALL call `pi.setModel()` with the resolved default model
- **AND** the bridge SHALL prefer this "apply on resume" failure mode over the alternative "silently skip on new"

### Requirement: Bridge extension ships a universal `browser` skill

The bridge extension's `package.json` SHALL declare a `browser` skill in its `pi.skills[]` array, pointing at `.pi/skills/browser`. The extension's `files[]` array SHALL include `.pi/skills/browser/` so the directory ships in the published npm tarball.

The skill content (SKILL.md, references, UPSTREAM.md, LICENSE) is specified by the `default-browser-skill` capability; this requirement covers only the registration mechanics.

#### Scenario: pi.skills[] declares the skill

- **WHEN** `packages/extension/package.json` is parsed
- **THEN** the `pi.skills` array SHALL contain the entry `.pi/skills/browser`

#### Scenario: Skill files ship in the published package

- **WHEN** `packages/extension/package.json` is parsed
- **THEN** the `files` array SHALL contain `.pi/skills/browser/` (or an equivalent glob that includes it)

#### Scenario: Skill loads in real sessions

- **WHEN** a pi session installs the bridge extension and starts
- **THEN** `pi.getCommands()` SHALL include an entry with `name === "browser"` and `source === "skill"`

### Requirement: Bridge does not auto-install agent-browser

The bridge extension SHALL NOT attempt to install the `agent-browser` or `pi-agent-browser` package automatically at session start or during skill registration. The user remains in control of installing the CLI; the skill's Step-0 preflight handles the missing-CLI case by instructing the user.

#### Scenario: No install side-effects at registration

- **WHEN** the bridge extension registers the `browser` skill at session start
- **THEN** the bridge SHALL NOT spawn `npm install`, `pi install`, or any equivalent install command
- **AND** the bridge SHALL NOT modify the user's `.pi/settings.json` or `~/.pi/agent/settings.json` to add either package

### Requirement: Bridge SHALL flip `ctx.hasUI` to `true` after wiring the UI proxy

After the bridge has installed PromptBus wrappers on `ctx.ui.confirm`, `ctx.ui.select`, `ctx.ui.input`, `ctx.ui.editor`, `ctx.ui.multiselect`, and `ctx.ui.notify` in the `session_start` handler, the bridge SHALL assign `ctx.hasUI = true` on the live `ctx` object.

The assignment SHALL happen AFTER the bridge has captured the original `ctx.hasUI` value into its `cachedHasUI` state (used by `source-detector.detectSessionSource`). `cachedHasUI` MUST retain the pi-supplied original value; only the live `ctx.hasUI` is flipped.

The assignment SHALL be guarded with try/catch so that if a future pi release makes `ctx.hasUI` non-writable, the bridge logs a single `[dashboard] failed to flip ctx.hasUI` warning and continues without crashing.

Rationale: extensions branch on `ctx.hasUI` to decide whether to call `ctx.ui.notify`, render dialogs, or short-circuit interactive flows. The bridge already provides a working UI surface via PromptBus over the patched `ctx.ui.*` methods — `ctx.hasUI` MUST reflect that reality so extensions like `context-mode` (`/ctx-stats`, `/ctx-doctor`) and `pi-agent-browser` (binary auto-install prompt) take their UI-present branch and render output in the dashboard.

#### Scenario: Headless RPC session — flip happens
- **WHEN** the bridge's `session_start` handler runs in a dashboard-spawned `pi --mode rpc` session where pi initialized `ctx.hasUI = false`
- **AND** the bridge has executed the `ctx.ui.*` PromptBus patching block
- **THEN** `ctx.hasUI` SHALL be `true` on the live `ctx` object
- **AND** the bridge's `cachedHasUI` field SHALL be `false` (preserving the pre-flip value)

#### Scenario: Source detection unaffected
- **WHEN** the bridge calls `detectSessionSource(cachedHasUI, sessionFile)` after the flip
- **THEN** `cachedHasUI` SHALL still be the original pi-supplied value (e.g. `false` for dashboard-spawned RPC, `true` for tmux)
- **AND** session source classification ("dashboard" vs "tmux") SHALL be identical to behavior before this change

#### Scenario: Tmux session — flip is a no-op
- **WHEN** the bridge's `session_start` handler runs in a tmux-spawned session where pi initialized `ctx.hasUI = true`
- **THEN** `ctx.hasUI` SHALL remain `true` after the flip
- **AND** `cachedHasUI` SHALL be `true`

#### Scenario: Context-mode slash command renders in dashboard RPC session
- **WHEN** a user dispatches `/ctx-stats` from the dashboard in a headless-RPC session
- **AND** context-mode's handler reads `ctx.hasUI`
- **THEN** `ctx.hasUI` SHALL evaluate truthy
- **AND** context-mode SHALL call `ctx.ui.notify(text, "info")`
- **AND** the bridge's patched `notify` SHALL forward a `prompt_request` to the dashboard server
- **AND** the dashboard SHALL render the notify body as a chat card

#### Scenario: Non-writable `ctx.hasUI` is handled gracefully
- **WHEN** the bridge attempts `ctx.hasUI = true` and the assignment throws (e.g. pi made `hasUI` a getter / frozen field in a future release)
- **THEN** the bridge SHALL catch the error
- **AND** the bridge SHALL log `[dashboard] failed to flip ctx.hasUI` exactly once
- **AND** `session_start` SHALL continue without crashing

### Requirement: Bridge listens to thinking_level_select

The bridge SHALL register a `pi.on("thinking_level_select", ...)` listener (pi 0.71+) and SHALL push a `model_update` message via the existing `sendModelUpdateIfChanged` debouncer whenever the listener fires. The bridge SHALL NOT rely on `model_select` to surface thinking-level changes.

The model-tracker's equality check that gates `model_update` pushes SHALL consider both `model` and `thinkingLevel` — a change in thinkingLevel alone (model unchanged) SHALL still produce a push.

#### Scenario: Thinking level change without model change
- **WHEN** the user changes thinking level from `medium` to `high` (model unchanged)
- **AND** pi emits `thinking_level_select`
- **THEN** the bridge SHALL emit one `model_update` with the existing model and the new thinkingLevel `"high"`

#### Scenario: Repeated event with same level is a no-op
- **WHEN** `thinking_level_select` fires twice with the same value
- **THEN** the bridge SHALL push at most one `model_update` for that value (the second is suppressed by the existing debouncer)

#### Scenario: Pre-0.71 pi (unlikely under 0.73 floor)
- **WHEN** the bridge runs against a pi that does NOT emit `thinking_level_select`
- **THEN** the listener registration SHALL be a no-op and the bridge SHALL still operate (no crash, no error)

### Requirement: Bridge handles stop_after_turn for graceful exit

The bridge SHALL accept a `{ type: "stop_after_turn", sessionId }` message from the server. On receipt, the bridge SHALL set a per-session flag (`shouldStopAfterTurn = true`) and, on the next `pi.events.on("turn_end")` callback while the flag is set, SHALL call `cachedCtx.shutdown()` (graceful) — falling back to `cachedCtx.abort()` only if `shutdown` is unavailable. The flag SHALL be cleared after the shutdown call is initiated. Repeated `stop_after_turn` messages while the flag is already set SHALL be no-ops.

The `turn_end` listener SHALL be wrapped in try/catch — failure SHALL NOT crash the bridge.

#### Scenario: Stop after turn waits for clean boundary
- **WHEN** the bridge receives `stop_after_turn` while pi is mid-stream
- **THEN** the bridge SHALL set the flag and let the current turn complete
- **AND** at the next `turn_end`, SHALL call `cachedCtx.shutdown()`, clearing the flag

#### Scenario: Idempotent flag set
- **WHEN** the bridge receives `stop_after_turn` twice in rapid succession before any `turn_end` fires
- **THEN** the flag SHALL be set once and the second message SHALL be a no-op (no second shutdown)

#### Scenario: Falls back when shutdown unavailable
- **WHEN** `cachedCtx.shutdown` is not a function (e.g. older pi or invalid state)
- **THEN** the bridge SHALL call `cachedCtx.abort()` instead and log a warning, preserving the clean-termination intent at best-effort


### Requirement: Bridge reports its session's pi version

The bridge SHALL report the pi-coding-agent version of the process it runs inside, per session, via a `{ type: "pi_version_update", sessionId, version }` message to the server. The version SHALL be read from inside the bridge's own process (`createRequire(import.meta.url).resolve("@earendil-works/pi-coding-agent/package.json")` + `readFileSync`), which is the ground-truth pi for that session — distinct from the server-side `readCurrentPiVersion()` read that drives the global `/api/health.compatibility` advisory.

The bridge SHALL send the message once when the session registers, and again whenever a later read yields a version different from the last value sent (including after an out-of-band pi upgrade). A module-scoped `lastPiVersion` SHALL suppress redundant sends, including across reconnect. The version re-read SHALL piggyback on the existing git/model poll tick (`runGitPollTick`, 30s) — no dedicated timer.

A read failure SHALL log a warning and skip the send without crashing the bridge or interrupting the heartbeat; the next tick retries.

#### Scenario: Push at session register
- **WHEN** the bridge registers a session against pi 0.80.2
- **THEN** the bridge SHALL send `{ type: "pi_version_update", sessionId, version: "0.80.2" }`

#### Scenario: No push when version unchanged
- **WHEN** a poll tick re-reads the same version already sent
- **THEN** no `pi_version_update` SHALL be sent

#### Scenario: Push after out-of-band upgrade
- **WHEN** the user runs `pi update --self` so the bridge's process now resolves to a newer pi version
- **AND** the next poll tick fires
- **THEN** the bridge SHALL send `pi_version_update` with the new version

#### Scenario: Read failure is silent
- **WHEN** the pi version read throws
- **THEN** the bridge SHALL log a warning, skip the send, and keep the poll loop running

#### Scenario: Reconnect does not redundantly push
- **WHEN** the bridge reconnects against the same pi version it last sent
- **THEN** no `pi_version_update` SHALL be sent because `lastPiVersion` is unchanged

### Requirement: Server stores and broadcasts reported pi version

On receipt of `pi_version_update`, the server SHALL store `version` as `DashboardSession.piVersion` for that session and broadcast a session update to subscribed browsers, mirroring the `git_info_update` handling. Older bridges that never send the message SHALL leave `piVersion` undefined; no client behaviour depends on its presence beyond an optional read-only display in the session header.

#### Scenario: Stored and broadcast
- **WHEN** the server receives `{ type: "pi_version_update", sessionId, version: "0.80.2" }`
- **THEN** the session record's `piVersion` SHALL become `"0.80.2"`
- **AND** a session-updated broadcast carrying `{ piVersion: "0.80.2" }` SHALL be sent to that session's browser subscribers
