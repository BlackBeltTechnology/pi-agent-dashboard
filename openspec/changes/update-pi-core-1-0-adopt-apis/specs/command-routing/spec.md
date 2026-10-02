## ADDED Requirements

### Requirement: Extension slash command dispatch via sendUserMessage without a pi version gate

When `isExtensionSlashCommand(text, pi.getCommands())` is true, the bridge
SHALL dispatch the command in-process by calling
`pi.sendUserMessage(text, { expandPromptTemplates: true, deliverAs })`, where
`deliverAs` is the requested delivery (`"steer"` | `"followUp"`, default
`"followUp"`). This SHALL apply to every session kind — headless RPC, tmux,
terminal, user-launched — with no session-kind probe and no pi-version probe.

Feedback contract (exactly one `started` and exactly one terminal event per
invocation):
- `command_feedback {command, status:"started"}` before the call;
- `command_feedback {status:"completed"}` immediately after the call returns —
  meaning pi accepted the text for dispatch (fire-and-forget; pi runs
  `prompt()` asynchronously and swallows its own rejections);
- `command_feedback {status:"error", message}` if the call throws synchronously
  (pi's `assertActive` on a stale extension context).

Handler outcome is NOT observable by the bridge and SHALL NOT be claimed.

The bridge SHALL NOT read the running pi's version to decide dispatch: the
`1.0.0` floor guarantees `expandPromptTemplates` support, so the former old-pi
gate and its "requires pi 0.84.2+" error are withdrawn.

The bridge SHALL NOT feature-detect `pi.dispatchCommand` and SHALL NOT emit
`dispatch_extension_command`.

#### Scenario: Extension command in a headless RPC session
- **WHEN** `send_prompt` text is `/ctx-stats` in a dashboard-spawned headless session
- **THEN** the bridge SHALL emit `command_feedback {status:"started"}`
- **AND** SHALL call `pi.sendUserMessage("/ctx-stats", { expandPromptTemplates: true, deliverAs: "followUp" })`
- **AND** SHALL emit `command_feedback {status:"completed"}`
- **AND** SHALL NOT send `dispatch_extension_command` to the server

#### Scenario: Extension command in a tmux / terminal session
- **WHEN** `send_prompt` text is `/ctx-stats` in a user-launched or tmux session
- **THEN** the bridge SHALL dispatch exactly as in the headless scenario

#### Scenario: Extension command while the agent is streaming, steer delivery
- **WHEN** `send_prompt` text is `/curator` with `delivery: "steer"` and the agent is streaming
- **THEN** the bridge SHALL pass `deliverAs: "steer"`
- **AND** pi SHALL run the extension command immediately regardless of `deliverAs`

#### Scenario: Stale extension context throws synchronously
- **WHEN** `pi.sendUserMessage` throws synchronously
- **THEN** the bridge SHALL emit `command_feedback {status:"error", message: <thrown message>}`
- **AND** SHALL NOT emit `completed`

#### Scenario: No version read on dispatch
- **WHEN** any extension slash command is dispatched
- **THEN** the bridge SHALL NOT read a pi `package.json` to decide whether to call `pi.sendUserMessage`
- **AND** SHALL NOT emit an error mentioning a minimum pi version

#### Scenario: Exactly one terminal event
- **WHEN** any single dispatch invocation fires
- **THEN** the recorded `command_feedback` events for that command text SHALL contain EXACTLY ONE `started` and EXACTLY ONE terminal event (`completed` xor `error`)

## MODIFIED Requirements

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
9. Check for `/` prefix matching a known **extension command** (`source: "extension"` in `pi.getCommands()`, excluding `DASHBOARD_NATIVE_COMMANDS` and `__`-prefixed names; evaluated inside `tryDispatchExtensionCommand`, which returns `false` if `getCommands()` throws) → dispatch in-process via `pi.sendUserMessage(text, { expandPromptTemplates: true, deliverAs })`
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
- **THEN** step 9 fires (in-process dispatch)
- **AND** step 10's fall-through to template expansion SHALL NOT execute

## REMOVED Requirements

### Requirement: Extension slash command dispatch via sendUserMessage

**Reason**: The old-pi gate (reading the running pi's version and refusing dispatch below 0.84.2, including the `@mariozechner` case) is unreachable at the 1.0.0 floor.

**Migration**: Replaced by "Extension slash command dispatch via sendUserMessage without a pi version gate": same dispatch and feedback contract, no version read.
