# model-selector Specification

## Purpose

Provides the dashboard's status-bar model and thinking-level selectors, plus the surrounding protocol for model list propagation, pending-state indicators, role assignment, and reuse of the picker as a plugin UI primitive.
## Requirements
### Requirement: Model selector in status bar

The status bar SHALL display the current model name. Clicking it SHALL open an autocomplete dropdown listing all available models. The model selector component SHALL NOT contain inline roles management UI; roles management SHALL be surfaced exclusively through a `settings-section` plugin contribution (see ADDED Requirements below).

The model selector dropdown MAY still show, in read-only form, a compact "active roles" line (e.g. `@architect → claude-3-7-sonnet, @planner → gpt-4o`) to communicate the current role-to-model map at a glance. Editing, preset save/load, and preset delete actions SHALL live in the settings-section UI, NOT in the dropdown.

The component MAY still receive `roles` as a prop for backward compatibility with callers that drill it through, but the prop SHALL be used only for the optional read-only summary, never for editing controls.

#### Scenario: Display current model

- **WHEN** a session has a model selected (e.g., "anthropic/claude-4")
- **THEN** the status bar shows the model name on the left side

#### Scenario: Open model dropdown

- **WHEN** user clicks the model name
- **THEN** a dropdown appears with a text filter and scrollable list of available models

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

### Requirement: Roles UI surfaces via settings-section plugin contribution

The dashboard SHALL surface role-to-model assignment, preset save/load, preset delete, AND **deferred persistence with explicit Save / Reload affordances** through a `settings-section` plugin contribution claimed by a bundled built-in plugin. The claim SHALL target `tab: "general"`.

The contribution SHALL maintain local pending state (`pending: Record<string,string>`) for role picks the user has made but not yet saved. The pending state SHALL be the source of truth for display: the rendered value of a role pill is `pending[role] ?? rolesMap[role]`. The contribution SHALL NOT dispatch `role_set` on every pick.

The contribution SHALL render a Save and a Reload button below the preset row and above the role grid. The contribution SHALL render an inline dirty marker on each role pill whose key exists in `pending` and whose pending value differs from the persisted value.

#### Scenario: Picking a model only updates pending state

- **WHEN** the user clicks a role pill, opens the model picker, and picks a model whose label differs from the persisted value for that role
- **THEN** the contribution SHALL update its local `pending` state for that role
- **AND** the contribution SHALL NOT dispatch a `role_set` WebSocket message
- **AND** the pill SHALL render with the picked value and an inline dirty marker

#### Scenario: Picking the persisted value back clears dirty

- **WHEN** the user picks a model whose label equals `rolesMap[role]` (the current server value)
- **THEN** the contribution SHALL remove that key from `pending`
- **AND** the pill SHALL render without a dirty marker

#### Scenario: Save dispatches only changed roles

- **WHEN** the user clicks Save while `pending` contains one or more roles whose values differ from `rolesMap`
- **THEN** the contribution SHALL dispatch one `role_set` WebSocket message per such role, in arbitrary order
- **AND** each dispatched message SHALL carry `modelId` equal to the pending label and `provider` parsed as the prefix before `/`
- **AND** the contribution SHALL clear `pending` optimistically (before any `roles_list` ack arrives)
- **AND** roles where `pending[role] === rolesMap[role]` SHALL NOT trigger a dispatch

#### Scenario: Save when clean dispatches nothing

- **WHEN** the user clicks Save while `pending` is empty (or every entry matches the server value)
- **THEN** the contribution SHALL NOT dispatch any messages
- **AND** Save SHALL be rendered as disabled (`aria-disabled` true, visually muted)

#### Scenario: Reload discards pending and re-reads from server

- **WHEN** the user clicks Reload
- **THEN** the contribution SHALL clear `pending` immediately
- **AND** the contribution SHALL dispatch `{type:"request_roles", sessionId}` to force the bridge to re-emit `roles_list` from `~/.pi/agent/providers.json`
- **AND** the pills SHALL render with `rolesMap[role]` (no dirty markers) starting on the next render

#### Scenario: Inbound roles_list auto-cleans matching pending entries

- **WHEN** the contribution receives a `roles_list` (via `usePluginConfig` update) where `roles[role] === pending[role]`
- **THEN** the contribution SHALL remove that key from `pending`
- **AND** the pill SHALL render without a dirty marker

#### Scenario: Inbound roles_list preserves conflicting pending entries

- **WHEN** the contribution receives a `roles_list` where `roles[role]` differs from BOTH the previous `rolesMap[role]` AND the user's `pending[role]`
- **THEN** the contribution SHALL leave `pending[role]` unchanged
- **AND** the dirty marker SHALL remain visible

#### Scenario: Preset Load while dirty surfaces a confirmation

- **WHEN** the user clicks a preset's Load button while `pending` is non-empty
- **THEN** the contribution SHALL show a confirmation prompt ("Discard unsaved role changes?")
- **AND** on confirm, the contribution SHALL clear `pending` and dispatch `role_preset_load`
- **AND** on cancel, the contribution SHALL leave `pending` untouched and SHALL NOT dispatch `role_preset_load`

#### Scenario: Preset Save while dirty saves edits first

- **WHEN** the user names and confirms saving a preset while `pending` is non-empty
- **THEN** the contribution SHALL run the Save logic (one `role_set` per dirty role) FIRST
- **AND** then dispatch `role_preset_save` with the chosen name
- **AND** SHALL render a one-line hint above the input ("Unsaved edits will be saved first.") for the duration of the saving-preset flow when `pending` is non-empty

### Requirement: Status bar always visible
The status bar SHALL be always visible between ChatView and CommandInput, replacing the WorkingIndicator which only appeared during streaming.

#### Scenario: Idle state
- **WHEN** the session is idle
- **THEN** the status bar shows the model selector on the left, right side is empty

#### Scenario: Streaming state
- **WHEN** the session is streaming
- **THEN** the status bar shows the model selector on the left and working status on the right

### Requirement: Thinking level selector
The status bar SHALL include a thinking level selector next to the model selector. Clicking it SHALL open a dropdown with available thinking levels.

Available levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.

#### Scenario: Display current thinking level
- **WHEN** a session has a thinking level set
- **THEN** the status bar shows the current level

#### Scenario: Change thinking level
- **WHEN** user selects a different level from the dropdown
- **THEN** a `set_thinking_level` message SHALL be sent to the server, which forwards it to the bridge extension

#### Scenario: Bridge applies thinking level
- **WHEN** the bridge receives a `set_thinking_level` message
- **THEN** it SHALL call `pi.setThinkingLevel(level)` and send a `model_update` message back with the new level

### Requirement: Models list from extension
The extension SHALL send a `models_list` message on session_start with all available models from `modelRegistry.getAvailable()`.

#### Scenario: Models sent on session start
- **WHEN** a pi session starts
- **THEN** the extension sends `models_list` with available models

#### Scenario: Browser requests models refresh
- **WHEN** the browser sends `request_models`
- **THEN** the extension responds with `models_list`

### Requirement: Multi-token AND search
The model filter input SHALL support space-separated search tokens. Each token MUST match somewhere in the combined `provider/modelId` string. ALL tokens MUST match for a model to appear in results (AND logic).

#### Scenario: Single token search
- **WHEN** the user types "claude" in the model filter
- **THEN** all models containing "claude" in their provider or model ID are shown

#### Scenario: Multi-token AND search
- **WHEN** the user types "anthropic opus" in the model filter
- **THEN** only models where BOTH "anthropic" AND "opus" appear in `provider/id` are shown

#### Scenario: Empty filter shows all models
- **WHEN** the filter input is empty
- **THEN** all models are displayed (filtered only by provider dropdown if set)

### Requirement: Provider filter dropdown
The model selector SHALL include a provider filter dropdown above or beside the text filter input. The dropdown SHALL list "All Providers" as the default option followed by all unique provider names extracted from the available models. When a provider is selected, only models from that provider SHALL be shown in the list (before text filter is applied).

#### Scenario: Default shows all providers
- **WHEN** the model selector opens
- **THEN** the provider dropdown shows "All Providers" selected
- **AND** models from all providers are listed

#### Scenario: Filtering by provider
- **WHEN** the user selects "anthropic" from the provider dropdown
- **THEN** only models with `provider === "anthropic"` are shown
- **AND** the text filter still applies within the filtered set

#### Scenario: Combined provider and text filter
- **WHEN** the user selects "openai" from the provider dropdown and types "gpt" in the filter
- **THEN** only openai models containing "gpt" are shown

### Requirement: Thinking level updates propagate to both UI surfaces

When the bridge sends a `model_update` message (via `modelTracker.sendModelUpdateIfChanged` after `set_thinking_level`), the server SHALL patch both the `DashboardSession` registry (observed by session cards and the session header) AND the browser-side `sessionStates[sessionId]` state (observed by the bottom StatusBar selector), so the thinking level displayed in every UI surface stays consistent.

Protocol-level responsibility: the server's `model_update` handler in `event-wiring.ts` continues to update `sessionManager` and broadcast `session_updated`. The client's `session_updated` handler in `useMessageHandler.ts` SHALL, in addition to patching the `sessions` Map, mirror `thinkingLevel` and `model` fields from `msg.updates` into `sessionStates[msg.sessionId]` (creating a fresh `SessionState` via `createInitialState()` when the session has no state yet).

Rationale: the StatusBar component reads `selectedState.thinkingLevel ?? selectedSession?.thinkingLevel`, preferring event-reducer state over the DashboardSession. Without the mirror, the server-pushed thinking level updates `sessions[id].thinkingLevel` but not `sessionStates[id].thinkingLevel`, causing the StatusBar to silently fall back to a stale value while the SessionCard refreshes correctly.

Only `thinkingLevel` and `model` are mirrored; other `DashboardSession`-only fields (`name`, `cost`, `contextTokens`, `contextWindow`, etc.) stay unmirrored because no event-reducer-driven UI surface reads them.

#### Scenario: StatusBar and SessionCard update together when user clicks a thinking level

- **WHEN** the user clicks `medium` in the bottom StatusBar's thinking level dropdown on a session that previously displayed `off`
- **AND** the bridge receives `set_thinking_level`, calls `pi.setThinkingLevel("medium")`, and sends `model_update` with `thinkingLevel: "medium"` back to the server
- **AND** the server patches `DashboardSession.thinkingLevel = "medium"` and broadcasts `session_updated`
- **THEN** the client's `session_updated` handler SHALL update both `sessions[sessionId].thinkingLevel` AND `sessionStates[sessionId].thinkingLevel` to `"medium"`
- **AND** the SessionCard's `{session.thinkingLevel}` text SHALL read `medium`
- **AND** the StatusBar's `ThinkingLevelSelector.current` prop (fed by `selectedState.thinkingLevel`) SHALL also read `medium`
- **AND** neither surface SHALL revert after the round-trip settles

#### Scenario: Model change propagates to both surfaces

- **WHEN** the user selects a different model from the StatusBar ModelSelector
- **AND** the server broadcasts `session_updated` with `updates: { model: "proxy/cc/claude-opus-4-7" }`
- **THEN** both `sessions[sessionId].model` AND `sessionStates[sessionId].model` SHALL be updated
- **AND** the SessionCard's model label AND the StatusBar's ModelSelector current value SHALL both reflect the new selection

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

The same `ModelSelector` component used by `StatusBar` SHALL be reachable from any plugin via `useUiPrimitive("ui:model-selector")` without the plugin importing client internals or declaring `@blackbelt-technology/pi-dashboard-web` as a dependency. Plugins consuming the primitive SHALL get identical behavior (provider filter, typeahead, keyboard navigation, pending-state with 10 s timeout) to the StatusBar's usage.

#### Scenario: Builtins-plugin consumes the primitive

- **WHEN** the builtins-plugin's `BuiltInRolesSettings` renders the per-role model picker
- **THEN** it SHALL obtain the picker via `useUiPrimitive("ui:model-selector")`
- **AND** SHALL NOT contain its own inline picker JSX duplicating provider filter / typeahead behavior
- **AND** SHALL NOT add `@blackbelt-technology/pi-dashboard-web` to its `dependencies`

#### Scenario: Selection emits `"provider/modelId"` to the host

- **WHEN** the user picks a model from the picker rendered inside `BuiltInRolesSettings`
- **THEN** the host's `onSelect` callback SHALL be invoked with the full `"<provider>/<id>"` string (matching `StatusBar`'s existing semantics)
- **AND** the host SHALL forward that exact string as the `modelId` field of the outgoing `role_set` WebSocket message

### Requirement: Role values persist in `"provider/modelId"` form

When `BuiltInRolesSettings` writes a role assignment, the `modelId` field of the `role_set` WebSocket message SHALL be the full `"<provider>/<id>"` string. Bridge extension (`packages/extension/src/bridge.ts`) and pi-flows `role-manager.ts` already pass the `modelId` value through verbatim, so the persisted role entry in `~/.pi/agent/providers.json#roles` SHALL contain the full `"<provider>/<id>"` string after this change lands.

This makes the persisted role value resolvable unambiguously by pi-flows' `flow-engine/execution.ts` — its existing `modelId.split("/")` path picks the provider-aware `modelRegistry.find(provider, id)` branch when `parts.length >= 2`, so the architect agent (which uses `model: @planning`) SHALL find the correct model in the registry.

#### Scenario: Writing a role yields a slash-form value on disk

- **GIVEN** a user assigns the model labeled `proxy/cc/deepseek-v4-flash` to role `planning` via `BuiltInRolesSettings`
- **WHEN** the dashboard finishes its WebSocket round-trip with pi-flows
- **THEN** `~/.pi/agent/providers.json#roles.planning` SHALL equal `"proxy/cc/deepseek-v4-flash"`

#### Scenario: pi-flows resolves the role via the provider-aware path

- **GIVEN** `roles.planning` is `"proxy/cc/deepseek-v4-flash"`
- **WHEN** pi-flows spawns the architect (which declares `model: @planning`)
- **THEN** `resolveModel("@planning", …)` SHALL return `{ modelId: "proxy/cc/deepseek-v4-flash" }`
- **AND** `execution.ts` SHALL call `options.modelRegistry.find("proxy", "cc/deepseek-v4-flash")`
- **AND** the lookup SHALL succeed (assuming the proxy provider is registered and has that model)
- **AND** the architect SHALL spawn against the correct provider's credentials and base URL

### Requirement: Read-time migration of legacy bare-id role values

`BuiltInRolesSettings` SHALL handle legacy role entries whose stored value is a bare model id (no `/`) without throwing or rendering nonsense. When rendering the current selection for such a role, the component SHALL look up the first model in the live `models` list whose `.id === stored` and synthesize the `current` prop as `"${that.provider}/${stored}"`. If no live model matches, the component SHALL pass the bare value through as `current` and let the primitive render it as plain text.

Migration SHALL be read-only — the component MUST NOT write to disk on load. The first time the user re-picks a role, the canonical `"provider/id"` form is written, which over time normalizes the file.

#### Scenario: Bare-id entry displays correctly

- **GIVEN** `~/.pi/agent/providers.json#roles.planning` is the legacy bare value `"deepseek-v4-flash"`
- **AND** the live `models` list contains `{ provider: "proxy", id: "deepseek-v4-flash", … }`
- **WHEN** the user opens the Settings → Roles page
- **THEN** the `@planning` role pill SHALL display the model label sourced from `"proxy/deepseek-v4-flash"`
- **AND** the primitive's `current` prop SHALL be `"proxy/deepseek-v4-flash"`
- **AND** no write SHALL be issued to `providers.json`

#### Scenario: Bare-id entry with no live match degrades gracefully

- **GIVEN** `roles.planning` is `"some-removed-model"`
- **AND** no live model has `.id === "some-removed-model"`
- **WHEN** the Roles page renders
- **THEN** the pill SHALL display `"some-removed-model"` as plain text
- **AND** the primitive SHALL render its non-interactive fallback (matching its existing `models === undefined` behavior)
- **AND** no error SHALL be thrown

### Requirement: Dirty count visible on Save button

The Save button SHALL render the count of dirty roles in its label when `pending` is non-empty (e.g. `Save (3)`). When `pending` is empty, the button SHALL render its label as `Save` without a count and SHALL be disabled.

#### Scenario: Count reflects dirty entries

- **WHEN** the user has picked new values for two roles (neither matching the server value)
- **THEN** the Save button label SHALL read `Save (2)`

#### Scenario: Count excludes entries that round-tripped back to server value

- **WHEN** the user has three entries in `pending` but one matches `rolesMap`
- **THEN** the Save button label SHALL read `Save (2)`
- **AND** the round-tripped entry's pill SHALL NOT render a dirty marker

### Requirement: ModelInfo SHALL carry capability metadata

The `ModelInfo` wire type SHALL include optional `name`, `reasoning`, `vision`,
`contextWindow`, and `metadataSource` fields in addition to `provider` and `id`.
The bridge SHALL populate them from pi's `ModelRegistry` at every `models_list`
push site, replacing the prior `{ provider, id }`-only projection.

#### Scenario: Catalog-resolved model carries real capabilities

- **GIVEN** a model whose `enrichModelMetadata()` probe hit pi's registry
- **WHEN** the bridge pushes `models_list`
- **THEN** the `ModelInfo` SHALL carry `metadataSource: "catalog"`, `reasoning`
  and `vision` reflecting the real `Model` fields (`vision` = `input.includes("image")`),
  plus `name` and `contextWindow`

#### Scenario: Fallback model is flagged as assumed

- **GIVEN** a custom-provider model whose upstream `/v1/models` reported no
  capability data (no catalog match)
- **WHEN** the bridge pushes `models_list`
- **THEN** the `ModelInfo` SHALL carry `metadataSource: "fallback"`, `vision: true`
  (forced default), and `reasoning: false` (forced default)

#### Scenario: Old bridge omitting new fields still works

- **GIVEN** a bridge that pushes `ModelInfo` with only `{ provider, id }`
- **WHEN** the client renders the selector
- **THEN** no capability badge SHALL be shown for that model and no error SHALL occur

### Requirement: Selector SHALL render capability badges with confidence

The `ModelSelector` SHALL render a `🧠` badge for `reasoning: true` and a `👁`
badge for `vision: true` ONLY when `metadataSource === "catalog"`. When
`metadataSource === "fallback"` it SHALL render muted `🧠?` and `👁?` markers.
When `metadataSource` is absent it SHALL render no capability badge.

#### Scenario: Confirmed capability shows solid badge

- **GIVEN** a model with `metadataSource: "catalog"`, `reasoning: true`, `vision: true`
- **THEN** the row SHALL show a solid `🧠` and a solid `👁`

#### Scenario: Confirmed-absent capability shows no badge

- **GIVEN** a model with `metadataSource: "catalog"`, `vision: false`
- **THEN** the row SHALL NOT show any vision marker

#### Scenario: Assumed capability shows question marker

- **GIVEN** a model with `metadataSource: "fallback"`
- **THEN** the row SHALL show muted `👁?` and `🧠?` markers (not solid badges)

### Requirement: Favorites SHALL persist server-side and broadcast

The dashboard SHALL persist favorite model labels (`"provider/id"`) in
`~/.pi/dashboard/preferences.json#favoriteModels` via `preferencesStore`. Adding
or removing a favorite SHALL broadcast `favorite_models_updated { labels }` to
all connected browsers. Favorites SHALL survive server restart.

#### Scenario: Favoriting persists and broadcasts

- **WHEN** a browser sends `favorite_model { label: "anthropic/claude-opus-4-7" }`
- **THEN** the server SHALL append the label to `favoriteModels` (deduped),
  persist it, and broadcast `favorite_models_updated` with the full label list to
  every connected browser

#### Scenario: Unfavoriting removes and broadcasts

- **GIVEN** `"anthropic/claude-opus-4-7"` is in `favoriteModels`
- **WHEN** a browser sends `unfavorite_model { label: "anthropic/claude-opus-4-7" }`
- **THEN** the server SHALL remove the label, persist, and broadcast the updated list

#### Scenario: Favorites survive restart

- **GIVEN** `favoriteModels` contains two labels
- **WHEN** the server restarts and a browser cold-loads `GET /api/favorite-models`
- **THEN** the response SHALL contain both labels

### Requirement: Selector SHALL provide a favorites filter and star toggles

The `ModelSelector` SHALL render models grouped by provider only (NO separate
pinned favorites group), a per-row ★ toggle that dispatches `favorite_model` /
`unfavorite_model`, and a **★ Favs** filter that narrows the list to favorites.
The **★ Favs** filter state SHALL persist per-browser in `localStorage` so it
survives reload regardless of whether it is on or off.

#### Scenario: Favorited model shows a filled star inline (no separate group)

- **GIVEN** `"anthropic/claude-opus-4-7"` is favorited
- **WHEN** the dropdown opens with provider filter = "All Providers"
- **THEN** that model SHALL appear under its provider group with a filled ★
  toggle
- **AND** there SHALL be no separate **★ Favorites** group

#### Scenario: Favorites filter narrows the list

- **GIVEN** three favorited models across two providers
- **WHEN** the user enables the **★ Favs** toggle
- **THEN** only those three models SHALL be listed, grouped by provider

#### Scenario: Favs filter persists across reload

- **GIVEN** the user enabled the **★ Favs** toggle
- **WHEN** the page reloads
- **THEN** the selector SHALL restore the **★ Favs** toggle to enabled from
  `localStorage`

#### Scenario: Provider filter still applies within favorites

- **GIVEN** favorites across `anthropic` and `proxy`, **★ Favs** enabled
- **WHEN** the provider filter is set to `anthropic`
- **THEN** only the `anthropic` favorites SHALL be listed

### Requirement: Provider filter SHALL persist per-browser

The selector's provider-filter selection SHALL persist in `localStorage` under
`modelselector.providerFilter` and restore on mount. Opening the dropdown SHALL
NOT reset the provider filter (only the transient text filter resets).

#### Scenario: Provider filter survives dropdown reopen

- **GIVEN** the user set the provider filter to `proxy`
- **WHEN** the user closes and reopens the dropdown
- **THEN** the provider filter SHALL still be `proxy`

#### Scenario: Provider filter survives page reload

- **GIVEN** the user set the provider filter to `anthropic`
- **WHEN** the page reloads
- **THEN** the selector SHALL restore the filter to `anthropic` from localStorage

#### Scenario: Text filter still resets on open

- **GIVEN** the user typed `opus` into the text filter then closed the dropdown
- **WHEN** the user reopens the dropdown
- **THEN** the text filter SHALL be empty while the provider filter is preserved

### Requirement: Thinking-level selector filters per model

`ModelInfo` SHALL carry an optional `supportedThinkingLevels?: string[]` field populated by the bridge from pi 0.72+'s per-model `thinkingLevelMap`. The bridge SHALL include only the keys whose value is non-null (a `null` value in `thinkingLevelMap` means "this pi level is not supported by this model" and SHALL NOT be surfaced).

The dashboard's `ThinkingLevelSelector` SHALL render only the levels in `supportedThinkingLevels` when the array is non-empty, preserving the canonical ordering `off, minimal, low, medium, high, xhigh`. When the field is undefined or empty (pre-0.72 pi or models without a declared map), the selector SHALL render all six levels — preserving today's behavior as a fallback.

#### Scenario: Anthropic model exposes a subset
- **WHEN** an Anthropic model has `thinkingLevelMap: { medium: "medium", high: "high", xhigh: null }`
- **THEN** `ModelInfo.supportedThinkingLevels` SHALL be `["medium", "high"]`
- **AND** the selector SHALL render exactly two options: medium and high

#### Scenario: Pre-0.72 model with no map
- **WHEN** the model object has no `thinkingLevelMap` field
- **THEN** `ModelInfo.supportedThinkingLevels` SHALL be undefined
- **AND** the selector SHALL render all six levels (today's fallback)

#### Scenario: Model selector dropdown unaffected
- **WHEN** the user opens the model selector
- **THEN** all available models SHALL still appear regardless of their `supportedThinkingLevels` (filtering applies only to the thinking-level selector)

