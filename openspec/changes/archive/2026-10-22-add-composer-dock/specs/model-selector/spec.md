## RENAMED Requirements

- FROM: `### Requirement: Model selector in status bar`
- TO: `### Requirement: Model selector in the composer`

## MODIFIED Requirements

### Requirement: Model selector in the composer

The composer's merged model chip SHALL display the current model name together with the thinking level. Clicking it SHALL open a popover whose model part is an autocomplete dropdown listing all available models. The model selector component SHALL NOT contain inline roles management UI; roles management SHALL be surfaced exclusively through a `settings-section` plugin contribution (see ADDED Requirements below).

The model selector dropdown MAY still show, in read-only form, a compact "active roles" line (e.g. `@architect → claude-3-7-sonnet, @planner → gpt-4o`) to communicate the current role-to-model map at a glance. Editing, preset save/load, and preset delete actions SHALL live in the settings-section UI, NOT in the dropdown.

The component MAY still receive `roles` as a prop for backward compatibility with callers that drill it through, but the prop SHALL be used only for the optional read-only summary, never for editing controls.

#### Scenario: Display current model

- **WHEN** a session has a model selected (e.g., "anthropic/claude-4")
- **THEN** the composer's merged model chip shows the model name

#### Scenario: Open model dropdown

- **WHEN** user clicks the merged model chip
- **THEN** a popover appears with a text filter and scrollable list of available models

#### Scenario: Filter models

- **WHEN** user types in the filter input
- **THEN** the list filters to models matching the query (provider or id)

#### Scenario: Select model

- **WHEN** user clicks a model in the dropdown
- **THEN** a `set_model` message SHALL be sent with `{ provider, modelId }` extracted from the selected model string
- **AND** the dropdown closes
- **AND** the selector SHALL display the selected model name with a pending indicator (⏳)

#### Scenario: Pending model indicator clears on confirmation

- **WHEN** the server confirms the model change via `session_updated` or `model_select` event
- **THEN** the pending indicator SHALL be removed and the selector SHALL show the confirmed model name

#### Scenario: Pending model indicator timeout

- **WHEN** no model confirmation is received within 10 seconds
- **THEN** the pending indicator SHALL be removed and the selector SHALL revert to showing the current model

#### Scenario: No models available

- **WHEN** no models list has been received from the extension
- **THEN** the model name is shown as plain text (not clickable)

#### Scenario: Roles editing controls are not in the dropdown

- **WHEN** the user opens the model dropdown
- **THEN** the rendered dropdown SHALL NOT contain the "Roles" collapse header, preset save/load/delete row, or the editable role grid
- **AND** any read-only roles summary line SHALL be informational only (no buttons, no inputs)

### Requirement: Thinking level selector
The composer's merged model chip SHALL show the current thinking level on its face, and its popover SHALL offer the available thinking levels as a single-choice group next to the model list. The levels offered SHALL follow "Thinking-level selector filters per model".

Available levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.

#### Scenario: Display current thinking level
- **WHEN** a session has a thinking level set
- **THEN** the merged model chip shows the current level

#### Scenario: Change thinking level
- **WHEN** user selects a different level in the merged chip's popover
- **THEN** a `set_thinking_level` message SHALL be sent to the server, which forwards it to the bridge extension

#### Scenario: Bridge applies thinking level
- **WHEN** the bridge receives a `set_thinking_level` message
- **THEN** it SHALL call `pi.setThinkingLevel(level)` and send a `model_update` message back with the new level

### Requirement: Thinking level updates propagate to both UI surfaces

When the bridge sends a `model_update` message (via `modelTracker.sendModelUpdateIfChanged` after `set_thinking_level`), the server SHALL patch both the `DashboardSession` registry (observed by session cards and the session header) AND the browser-side `sessionStates[sessionId]` state (observed by the composer's merged model chip), so the thinking level displayed in every UI surface stays consistent.

Protocol-level responsibility: the server's `model_update` handler in `event-wiring.ts` continues to update `sessionManager` and broadcast `session_updated`. The client's `session_updated` handler in `useMessageHandler.ts` SHALL, in addition to patching the `sessions` Map, mirror `thinkingLevel` and `model` fields from `msg.updates` into `sessionStates[msg.sessionId]` (creating a fresh `SessionState` via `createInitialState()` when the session has no state yet).

Rationale: the composer's merged model chip reads `selectedState.thinkingLevel ?? selectedSession?.thinkingLevel`, preferring event-reducer state over the DashboardSession. Without the mirror, the server-pushed thinking level updates `sessions[id].thinkingLevel` but not `sessionStates[id].thinkingLevel`, causing the chip to silently fall back to a stale value while the SessionCard refreshes correctly.

Only `thinkingLevel` and `model` are mirrored; other `DashboardSession`-only fields (`name`, `cost`, `contextTokens`, `contextWindow`, etc.) stay unmirrored because no event-reducer-driven UI surface reads them.

#### Scenario: StatusBar and SessionCard update together when user clicks a thinking level

- **WHEN** the user clicks `medium` in the composer's merged model chip popover on a session that previously displayed `off`
- **AND** the bridge receives `set_thinking_level`, calls `pi.setThinkingLevel("medium")`, and sends `model_update` with `thinkingLevel: "medium"` back to the server
- **AND** the server patches `DashboardSession.thinkingLevel = "medium"` and broadcasts `session_updated`
- **THEN** the client's `session_updated` handler SHALL update both `sessions[sessionId].thinkingLevel` AND `sessionStates[sessionId].thinkingLevel` to `"medium"`
- **AND** the SessionCard's `{session.thinkingLevel}` text SHALL read `medium`
- **AND** the composer's merged model chip (fed by `selectedState.thinkingLevel`) SHALL also read `medium`
- **AND** neither surface SHALL revert after the round-trip settles

#### Scenario: Model change propagates to both surfaces

- **WHEN** the user selects a different model from the composer's merged model chip
- **AND** the server broadcasts `session_updated` with `updates: { model: "proxy/cc/claude-opus-4-7" }`
- **THEN** both `sessions[sessionId].model` AND `sessionStates[sessionId].model` SHALL be updated
- **AND** the SessionCard's model label AND the composer's merged model chip SHALL both reflect the new selection

#### Scenario: Non-model/non-thinkingLevel session updates do not disturb sessionStates

- **WHEN** the server broadcasts `session_updated` with `updates: { name: "new session name" }` (no `model` / `thinkingLevel`)
- **THEN** the client SHALL update `sessions[sessionId].name` only
- **AND** `sessionStates[sessionId]` SHALL remain unchanged (no spurious `createInitialState()` allocation, no accidental reset of `messages` / `status` / `contextUsage`)

#### Scenario: Mirror creates initial state when session has no prior state

- **WHEN** `session_updated` arrives for a sessionId that has no entry in `sessionStates` yet
- **AND** the update includes `thinkingLevel` or `model`
- **THEN** the client SHALL call `createInitialState()` to seed the state map before applying the mirror
- **AND** the other `SessionState` fields (`messages`, `status`, `events`, …) SHALL be set to their initial empty values

### Requirement: `ModelSelector` is reachable from plugins via the primitive registry

The same `ModelSelector` component used by the composer's merged model chip SHALL be reachable from any plugin via `useUiPrimitive("ui:model-selector")` without the plugin importing client internals or declaring `@blackbelt-technology/pi-dashboard-web` as a dependency. Plugins consuming the primitive SHALL get identical behavior (provider filter, typeahead, keyboard navigation, pending-state with 10 s timeout) to the composer's usage.

#### Scenario: Builtins-plugin consumes the primitive

- **WHEN** the builtins-plugin's `BuiltInRolesSettings` renders the per-role model picker
- **THEN** it SHALL obtain the picker via `useUiPrimitive("ui:model-selector")`
- **AND** SHALL NOT contain its own inline picker JSX duplicating provider filter / typeahead behavior
- **AND** SHALL NOT add `@blackbelt-technology/pi-dashboard-web` to its `dependencies`

#### Scenario: Selection emits `"provider/modelId"` to the host

- **WHEN** the user picks a model from the picker rendered inside `BuiltInRolesSettings`
- **THEN** the host's `onSelect` callback SHALL be invoked with the full `"<provider>/<id>"` string (matching the composer's semantics)
- **AND** the host SHALL forward that exact string as the `modelId` field of the outgoing `role_set` WebSocket message

## REMOVED Requirements

### Requirement: Status bar always visible
**Reason**: The standalone status bar between the chat view and the composer no longer exists. Its model controls moved into the composer (redesign-prompt-input), and its working-status label moves into the composer toolbar with this change.
**Migration**: The working status renders as the toolbar's status word (`chat-view`, unified-composer requirement); model and thinking level render in the composer's merged model chip.
