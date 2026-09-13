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
9. Check for `/` prefix matching a known **extension command** (`source: "extension"` in `pi.getCommands()`, excluding `DASHBOARD_NATIVE_COMMANDS`) → dispatch via `pi.dispatchCommand` (when available) OR emit `command_feedback { status: "error" }` stopgap (when unavailable)
10. Check for `/` prefix → fall through to template expansion + `pi.sendUserMessage()` (handles skills, prompt templates, unrecognized slashes)
11. Default (no `/` prefix) → `pi.sendUserMessage(text)` (existing passthrough behavior)

Note: pi-flows management commands (`/flows`, `/flows:new`, `/flows:edit`, `/flows:delete`, `/roles`) are registered by the pi-flows extension via `pi.registerCommand` and are therefore handled by step 9 (extension dispatch) when `pi.dispatchCommand` is available, or by the stopgap when it is not. The kebab-menu UI continues to invoke `flows:new-request` / `flows:edit-request` / `flow:run` / `flow:delete-request` directly via the `flow_management` WebSocket message handler of the bridge extension — that path is independent of typed-text command routing and is not covered by this requirement.

#### Scenario: Routing precedence — bang beats slash
- **WHEN** `send_prompt` text is `!!echo /ctx-stats`
- **THEN** the handler SHALL execute `echo /ctx-stats` as a silent bash command
- **AND** SHALL NOT invoke any slash routing branch

#### Scenario: Routing precedence — user-defined flow run beats extension dispatch
- **WHEN** `send_prompt` text is `/deploy-prod` AND `deploy-prod` is a user-defined flow name returned by `getFlowsList()` AND ALSO appears in `pi.getCommands()`
- **THEN** the handler SHALL emit `flow:run { flowName: "deploy-prod" }` via `pi.events.emit(...)` (step 8 wins over step 9)
- **AND** SHALL NOT call `pi.dispatchCommand(...)` for this text

#### Scenario: Routing precedence — typed `/flows:new` rides extension dispatch
- **WHEN** `send_prompt` text is `/flows:new` AND `getFlowsList()` does NOT contain a user-defined flow named `flows:new` AND `pi.getCommands()` contains `{ name: "flows:new", source: "extension" }` (registered by pi-flows)
- **THEN** step 8 SHALL NOT match (no user-defined flow)
- **AND** step 9 SHALL fire: dispatch via `pi.dispatchCommand` when available, stopgap `command_feedback { status: "error" }` otherwise
- **AND** SHALL NOT call `pi.sendUserMessage(...)` for the slash text

#### Scenario: Extension dispatch beats fall-through
- **WHEN** `send_prompt` text is `/ctx-stats` AND `ctx-stats` is an extension command AND no earlier step matches
- **THEN** step 9 fires (extension dispatch or stopgap)
- **AND** step 10's fall-through to `pi.sendUserMessage(...)` SHALL NOT execute

### Requirement: Extension slash command detection
The command handler SHALL provide a pure helper `isExtensionSlashCommand(text, commandList)` that returns true iff:
- `text` starts with `/` AND has no embedded newline
- The token between the leading `/` and the first space (or end of string) — call it `cmdName` — appears in `commandList` with `source === "extension"`
- `cmdName` is NOT in `DASHBOARD_NATIVE_COMMANDS` (the same set used by `filterHiddenCommands` in `bridge-context.ts`)

This helper SHALL be exported and used by the bridge's `sessionPrompt` callback to gate steps 11/12 of the routing order.

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

### Requirement: Bridge feature-detects pi.dispatchCommand
The bridge's `sessionPrompt` callback SHALL feature-detect the presence of `pi.dispatchCommand` at call time via `hasDispatchCommand(pi)` in `packages/extension/src/bridge-context.ts`.

`hasDispatchCommand` SHALL:
- Return `false` when `pi` is `null` or `undefined`.
- Fast path: return `true` when `typeof (pi as any).dispatchCommand === "function"`.
- Fallback: when the fast path is false, check `"dispatchCommand" in (pi as object)` and return `true` only when a guarded `typeof` on the resolved value is `"function"` (handles getter-backed / Proxy-hidden properties).
- Return `false` for non-function values.

The bridge SHALL NOT cache the feature-detection result across `sessionPrompt` invocations.

The bridge SHALL NOT use pi version strings, semver checks, or any other version-sniffing mechanism for this gate.

#### Scenario: dispatchCommand is a plain function
- **WHEN** `hasDispatchCommand({ dispatchCommand: () => {} })` is called
- **THEN** SHALL return `true`

#### Scenario: dispatchCommand is getter-backed / Proxy-hidden
- **WHEN** `hasDispatchCommand` is called with a `pi` whose `dispatchCommand` resolves to a function only via a getter or Proxy `get` trap (not enumerable via plain `typeof` access)
- **THEN** the `in`-operator fallback SHALL detect it and SHALL return `true`

#### Scenario: dispatchCommand absent
- **WHEN** `hasDispatchCommand({})` is called
- **THEN** SHALL return `false`

#### Scenario: dispatchCommand is not a function
- **WHEN** `hasDispatchCommand({ dispatchCommand: "yes" })` is called
- **THEN** SHALL return `false`

#### Scenario: pi is null or undefined
- **WHEN** `hasDispatchCommand(null)` or `hasDispatchCommand(undefined)` is called
- **THEN** SHALL return `false`
