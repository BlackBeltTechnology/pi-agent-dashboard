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

`ModelInfo` SHALL carry an optional `supportedThinkingLevels?: string[]` field
populated by a projection that reproduces pi's canonical `getSupportedThinkingLevels`
rule verbatim — the same rule pi core uses to clamp thinking level — so the dashboard and
pi agree. (The rule is inlined rather than imported from `@earendil-works/pi-ai`, whose
shipped `.d.ts` re-exports via `.ts` extensions that the repo tsconfig cannot resolve;
the contract is pinned below.)

`thinkingLevelMap` is a **sparse override table**, NOT an allowlist. Supported levels
SHALL be derived by pi's rule, not by enumerating declared keys:

- If the model is not a reasoning model (`reasoning !== true`), supported levels SHALL be
  `["off"]`.
- Otherwise, for each canonical level in order `off, minimal, low, medium, high, xhigh,
  max`: the level SHALL be included UNLESS `thinkingLevelMap[level] === null` (explicitly
  disabled), EXCEPT the opt-in high tiers `xhigh` and `max`, each of which SHALL be
  included only when its `thinkingLevelMap` entry is declared with a non-null value. The
  derivation MUST implement an explicit `max` branch (`if (level === "max") return
  maxSupported && map.max != null`) — simply appending `max` to the canonical list without
  this branch would fail OPEN (`undefined !== null` is true), advertising `max` for every
  reasoning model. `maxSupported` SHALL be passed into the derivation (not read from a
  hardcoded constant).
- **`max` is additionally runtime-capability-gated.** `max` SHALL be included ONLY when
  the **session's** pi runtime (the runtime inside which the bridge executes — the reachable
  place for `max`, e.g. pi 0.80.10) advertises `max` in its canonical thinking-level set
  AND `thinkingLevelMap["max"]` is declared non-null. When the runtime does NOT advertise
  `max`, `max` SHALL never be surfaced, regardless of `thinkingLevelMap`. The dashboard
  server's own introspection derivation (pinned pi-ai without `max`) SHALL never emit `max`.
- A level whose key is **absent** from `thinkingLevelMap` SHALL be treated as supported
  (default), not excluded.

The projection SHALL emit `supportedThinkingLevels` only when the model exposes thinking
metadata (a `reasoning` flag or a `thinkingLevelMap`). When the model carries neither
(pre-0.72 pi), the field SHALL be `undefined`.

There SHALL be exactly ONE authored `supportedThinkingLevels` derivation (in the bridge
extension), parameterized by `maxSupported`. The dashboard server SHALL NOT derive this
list — its `/api/models` route passes through the raw `thinkingLevelMap` for agent
consumers.

The dashboard's `ThinkingLevelSelector` SHALL render only the levels in
`supportedThinkingLevels` when the array is non-empty, preserving the canonical ordering
`off, minimal, low, medium, high, xhigh, max`. When the field is undefined or empty, the
selector SHALL render the default six levels (`off, minimal, low, medium, high, xhigh`)
as a fallback; `max` SHALL never appear in the fallback set.

#### Scenario: Native map opting into max on a max-capable runtime

- **GIVEN** the installed runtime advertises `max` in its canonical thinking-level set
- **WHEN** a reasoning model has `thinkingLevelMap: { minimal: null, low: null, medium: null, high: null, xhigh: null, max: "max" }`
- **THEN** `supportedThinkingLevels` SHALL be `["off", "max"]`
- **AND** the selector SHALL render `off` and `max` only

#### Scenario: max is suppressed on a runtime without max

- **GIVEN** the installed runtime's canonical set is `off, minimal, low, medium, high, xhigh` (no `max`)
- **WHEN** a reasoning model has `thinkingLevelMap: { max: "max" }`
- **THEN** `max` SHALL NOT appear in `supportedThinkingLevels`
- **AND** the selector SHALL NOT render a `max` option

#### Scenario: Sparse reasoning map surfaces all non-disabled levels

- **WHEN** a reasoning model has `thinkingLevelMap: { xhigh: "xhigh" }` (e.g. `claude-opus-4-8`, `reasoning: true`) on a runtime without `max`
- **THEN** `supportedThinkingLevels` SHALL be `["off", "minimal", "low", "medium", "high", "xhigh"]`
- **AND** a session whose current level is `high` SHALL find `high` present in the dropdown (no orphaned, non-selectable trigger value)

#### Scenario: Dense map with a disabled level drops only that level

- **WHEN** a reasoning model has `thinkingLevelMap: { medium: "medium", high: "high", xhigh: null }`
- **THEN** `supportedThinkingLevels` SHALL be `["off", "minimal", "low", "medium", "high"]` (`xhigh` excluded because it is `null`; unmentioned lower levels remain supported)

#### Scenario: Non-reasoning model supports only off

- **WHEN** a model has `reasoning: false`
- **THEN** `supportedThinkingLevels` SHALL be `["off"]`

#### Scenario: Reasoning model with no map supports all levels except xhigh

- **WHEN** a model has `reasoning: true` and no `thinkingLevelMap`
- **THEN** `supportedThinkingLevels` SHALL be `["off", "minimal", "low", "medium", "high"]` (`xhigh` and `max` both excluded because each is supported only when declared with an explicit non-null `thinkingLevelMap` entry)

#### Scenario: Model without thinking metadata falls back to all six

- **WHEN** the model object has neither a `reasoning` flag nor a `thinkingLevelMap` (pre-0.72 pi)
- **THEN** `supportedThinkingLevels` SHALL be undefined
- **AND** the `ThinkingLevelSelector` SHALL render the default six canonical levels (no `max`)

#### Scenario: Filtering never removes models from the model list

- **WHEN** models carry differing `supportedThinkingLevels`
- **THEN** all available models SHALL still appear in the model selector
  regardless of their `supportedThinkingLevels` (the filter applies only to the
  thinking-level dropdown, never to the model list)

### Requirement: Roles UI SHALL let the user add a custom role (atomic name + model)

The `BuiltInRolesSettings` settings-section contribution SHALL provide an **＋ Add custom role** affordance. Activating it SHALL reveal an inline, `@`-prefixed role-name input with live validation via the shared `isValidRoleName(name, existingNames)` helper, where `existingNames` is the set of effective role names currently shown. The confirm control SHALL be disabled while the input is invalid, and an inline hint SHALL indicate why (see the validation requirement).

On a valid name being confirmed, the contribution SHALL open the shared `ui:model-selector` primitive scoped to the new name. Selecting a model SHALL stage the assignment in local `pending` state keyed by the new name (NOT dispatch immediately), exactly as an existing-role pick does. The new role SHALL therefore be created only when the unified Settings Save flushes `pending` as a `role_set` message; a custom role SHALL NOT reach disk from a name alone. Cancelling the input (Escape or the cancel control) before a model is selected SHALL add nothing.

#### Scenario: Adding a custom role stages, then Save persists

- **GIVEN** the Roles section is open and no role named `doubt-verifier-1` exists
- **WHEN** the user clicks **＋ Add custom role**, types `doubt-verifier-1`, confirms, and picks model `anthropic/claude-haiku-4-5`
- **THEN** a pill `@doubt-verifier-1` SHALL render in the Custom group with an unsaved (dirty) marker
- **AND** no `role_set` WebSocket message SHALL be dispatched yet
- **WHEN** the user triggers the unified Settings Save
- **THEN** exactly one `role_set` message SHALL be dispatched with `role = "doubt-verifier-1"` and `modelId = "anthropic/claude-haiku-4-5"`

#### Scenario: Cancelling the add flow persists nothing

- **GIVEN** the user clicked **＋ Add custom role** and typed a name
- **WHEN** the user presses Escape before selecting a model
- **THEN** no pill SHALL be added and `pending` SHALL be unchanged

### Requirement: Role names SHALL be validated inline against reserved characters and collisions

The contribution SHALL reject, before staging, any custom role name that fails `isValidRoleName`: empty/whitespace-only names, names containing `/`, whitespace, `@`, or `.`, names not matching `^[A-Za-z0-9][A-Za-z0-9_-]*$`, and names that collide with an existing effective role name (built-in or custom). An invalid name SHALL surface an inline error hint and SHALL NOT open the model picker.

#### Scenario: Reserved character is rejected inline

- **GIVEN** the add-custom-role input is open
- **WHEN** the user types `doubt/verifier`
- **THEN** an inline error hint SHALL show and the confirm control SHALL be disabled
- **AND** the model picker SHALL NOT open

#### Scenario: Duplicate of an existing role is rejected

- **GIVEN** a role named `fast` already exists (built-in)
- **WHEN** the user types `fast` in the add-custom-role input
- **THEN** the name SHALL be rejected as a collision and the confirm control SHALL be disabled

### Requirement: Roles UI SHALL group Built-in and Custom roles using `builtinRoleNames`

The contribution SHALL render two labelled groups — Built-in and Custom — classifying each role by membership in the `builtinRoleNames` array carried on the `roles_list` payload. A role whose name is in `builtinRoleNames` is Built-in; every other role is Custom. The rendered role set SHALL be the union of persisted role keys (`rolesMap`) and pending-only names (`pending`), deduped, so an in-flight custom role appears before Save. When `builtinRoleNames` is absent (older server), the contribution SHALL render all roles in a single flat group (back-compatible).

The Built-in set SHALL include the `naming` role, which selects the model used for automatic session topic-naming.

An install that already carries a USER-CREATED custom role named `naming` SHALL have that assignment preserved — the name is reclassified from Custom to Built-in and its assigned model continues to be used, now as the naming model. The reclassification SHALL NOT delete the assignment.

#### Scenario: A pending-only custom name renders in the Custom group

- **GIVEN** `builtinRoleNames` contains `planning, coding, compact, fast, vision, research, naming`
- **AND** the user has staged a pick for a new name `doubt-verifier-x` not yet in `rolesMap`
- **THEN** `@doubt-verifier-x` SHALL render in the Custom group with a dirty marker
- **AND** `@planning` SHALL render in the Built-in group

#### Scenario: The naming role renders as built-in

- **GIVEN** `builtinRoleNames` contains `naming`
- **WHEN** the Roles UI renders
- **THEN** `@naming` SHALL render in the Built-in group

#### Scenario: A pre-existing custom naming role keeps its assignment

- **GIVEN** an install whose `rolesMap` already contains a user-created role named `naming` with an assigned model
- **WHEN** the Roles UI renders after `naming` becomes a built-in name
- **THEN** the assigned model SHALL still be reported for `naming`
- **AND** `naming` SHALL render in the Built-in group

### Requirement: Custom roles SHALL be removable; built-in roles SHALL NOT

Each Custom role pill SHALL expose a **×** remove control; Built-in role pills SHALL NOT. Activating **×** SHALL prompt for confirmation (`window.confirm`); on confirm the contribution SHALL dispatch a `role_remove` WebSocket message for that role and SHALL drop any `pending` entry for it; on cancel it SHALL do nothing. Removal SHALL take effect immediately (not staged through the Settings Save buffer), consistent with preset deletion.

#### Scenario: Removing a custom role dispatches role_remove

- **GIVEN** a custom role `@doubt-verifier-1` is shown with a **×** control
- **WHEN** the user clicks **×** and confirms
- **THEN** a `role_remove` message with `role = "doubt-verifier-1"` SHALL be dispatched
- **AND** any `pending["doubt-verifier-1"]` entry SHALL be cleared

#### Scenario: Built-in roles expose no removal control

- **GIVEN** the built-in role `@planning` is rendered
- **THEN** its pill SHALL NOT expose a **×** remove control

### Requirement: Model list refresh on dropdown open

Opening the model selector dropdown SHALL re-request the available model list for the currently selected session. The open transition SHALL send a `request_models` message scoped to the selected session, deliberately bypassing the client's "fetch once per session" guard (`!modelsMap.has(sessionId)`), so a live session pulls a fresh list every time the user goes looking for a model. The resulting `models_list` push SHALL update the dropdown through the existing per-session update path.

Opening the dropdown SHALL be the only refresh trigger. The dropdown SHALL NOT render a separate manual refresh control in its footer: it duplicated the open-transition request without offering any capability the open transition does not already provide, and its busy indicator implied the list was otherwise stale.

The refresh capability SHALL remain optional on the selector; when the host provides no refresh handler (e.g. no session selected) opening the dropdown SHALL simply render the last-known list without requesting an update.

#### Scenario: Opening the dropdown refreshes a stale list

- **WHEN** a session is live and the user opens the model dropdown
- **THEN** the client sends `request_models` for the selected session
- **AND** on receipt of the `models_list` for that session the dropdown shows the updated models

#### Scenario: Refresh bypasses the fetch-once guard

- **WHEN** the selected session already has an entry in `modelsMap`
- **AND** the user opens the model dropdown
- **THEN** the client still sends `request_models` for that session (the `!modelsMap.has(sessionId)` guard does not suppress the open-transition request)

#### Scenario: No manual refresh control is rendered

- **WHEN** the user opens the model dropdown
- **THEN** the dropdown SHALL NOT present a manual refresh button
- **AND** the dropdown SHALL NOT present a refresh busy indicator

#### Scenario: No request without a handler

- **WHEN** the selector is opened and the host provided no refresh handler
- **THEN** no `request_models` message SHALL be sent
- **AND** the dropdown SHALL render the last-known list

### Requirement: Model dropdown surfaces provider refresh failures

When the `models_list` for the selected session reports that one or more providers failed to refresh **and the resulting list is non-empty**, the model selector dropdown SHALL render a single non-blocking footer line stating a count of unavailable providers (e.g. "1 provider unavailable") together with a `Providers` link (gear icon, no arrow) to Settings → Providers. The footer SHALL NOT name individual providers and SHALL NOT restate the per-provider messages; per-provider names and verbatim error text live in Settings → Providers (see `surface-provider-health-in-settings`). The notice SHALL NOT prevent selecting any model in the list.

When no provider failure is reported, the footer SHALL render no notice — a clean refresh SHALL be silent.

The notice SHALL NOT be presented as a toast or other transient global alert, because the refresh fires on every dropdown open and a persistently failing provider would otherwise alert repeatedly.

Design mockup: `mockups/empty-model-selector.html` state 4 ("partial failure"); decision D1-B.

#### Scenario: One provider fails to refresh

- **WHEN** the dropdown is open, the list is non-empty, and the session's `models_list` reports a refresh failure for a provider
- **THEN** the footer SHALL show a count of unavailable providers and a `Providers` link
- **AND** the footer SHALL NOT name the provider
- **AND** the models already in the list SHALL remain selectable

#### Scenario: Several providers fail to refresh

- **WHEN** the session's `models_list` reports refresh failures for more than one provider and the list is non-empty
- **THEN** the footer SHALL show the total count of unavailable providers (not individual names)

#### Scenario: Clean refresh is silent

- **WHEN** the session's `models_list` reports no refresh failure
- **THEN** the footer SHALL render no refresh notice

#### Scenario: Failure is not raised as a toast

- **WHEN** a refresh failure is reported
- **THEN** no toast or global alert SHALL be raised for it

### Requirement: Model selector trigger is openable with an empty catalogue

The model selector trigger SHALL be openable when the model list is empty (`models.length === 0`). It SHALL NOT be rendered `disabled` in that state, and clicking it SHALL open the popover the same way it does with a populated list. The chevron affordance SHALL be shown so the control reads as interactive.

Design mockup: `mockups/empty-model-selector.html` (state "Today (bug)" is the pre-change dead button; state 1 is the fixed openable trigger).

#### Scenario: Empty catalogue opens the popover

- **WHEN** the selector is rendered with `models: []` and the user clicks the trigger
- **THEN** the popover SHALL open
- **AND** the trigger SHALL NOT be `disabled`

#### Scenario: Populated catalogue is unchanged

- **WHEN** the selector is rendered with a non-empty `models` list
- **THEN** the trigger SHALL open and behave exactly as before this change

### Requirement: Open triggers a refresh in the empty case

Opening the selector with an empty catalogue SHALL fire the same open-transition `request_models` reload defined by `reload-models-on-selector-open`, exactly once per closed→open transition (not per render). This makes the operator's first click the recovery action: a provider configured after session start is picked up without restarting the session.

While the open-triggered refresh is in flight the popover SHALL show a transient "refreshing" body, not a recovery link.

#### Scenario: Opening an empty selector requests a fresh list

- **WHEN** the selector is opened with `models: []` and an `onRefresh` handler is wired
- **THEN** exactly one `request_models` SHALL be sent on the open transition
- **AND** the popover SHALL show the refreshing body until a `models_list` for the session arrives

#### Scenario: No handler does not error

- **WHEN** the empty selector is opened without an `onRefresh` handler
- **THEN** no `request_models` SHALL be sent
- **AND** the popover SHALL open showing the empty state without throwing

### Requirement: Recovery link when genuinely empty

After an open-triggered refresh has completed and the list is still empty, the empty-state body SHALL render a recovery link labelled `Open provider settings` with a settings (gear) icon and no directional arrow. Activating it SHALL navigate to the dashboard's Settings → Providers surface.

The link SHALL NOT be rendered while the selector is still awaiting the first `models_list` after opening (the `awaitingRefresh` window). The window ENDS — and the empty state is treated as settled — on the FIRST of: (a) a `models_list` for the selected session arriving since the open-triggered `request_models`, or (b) the open-triggered refresh's safety timeout elapsing without any such `models_list`. When the window ends with the list still empty (either path), the recovery link SHALL be shown; a refresh that never returns therefore falls back to the link rather than stranding the operator on the refreshing body. This still prevents a premature "no models" affordance during a normal in-flight refresh.

Design mockup: `mockups/empty-model-selector.html` state 2 ("genuinely empty"); decision D4-A in `mockups/selector-decisions.html`.

#### Scenario: Link appears only after a post-open empty result

- **WHEN** the selector was opened (open-triggered `request_models` sent) and no `models_list` has yet arrived
- **THEN** the empty state SHALL show the refreshing body and SHALL NOT show the recovery link
- **WHEN** a `models_list` for the session then arrives with an empty `models` array
- **THEN** the empty state SHALL show the `Open provider settings` link

#### Scenario: Safety timeout with no response reveals the link

- **WHEN** the selector was opened (open-triggered `request_models` sent) and no `models_list` arrives before the safety timeout elapses
- **THEN** the `awaitingRefresh` window SHALL end
- **AND** with the list still empty the empty state SHALL show the `Open provider settings` link

#### Scenario: Link navigates to provider settings

- **WHEN** the user activates the `Open provider settings` link
- **THEN** the dashboard SHALL open the Settings → Providers surface

### Requirement: Empty-and-errored state uses reopen-to-retry

When the post-refresh empty state coincides with one or more `refreshErrors`, the empty state SHALL present the same `Providers` recovery link (gear icon, no arrow) and SHALL NOT render an inline "Retry" control. Retrying a refresh is performed by closing and reopening the selector, keeping the open transition the single refresh trigger (consistent with the removal of the manual ↻ control).

Design mockup: `mockups/empty-model-selector.html` state 3; decision D5-B.

#### Scenario: Empty + error shows no inline Retry

- **WHEN** a post-open `models_list` arrives empty and carries `refreshErrors`
- **THEN** the empty state SHALL show the `Providers` link
- **AND** SHALL NOT render an inline Retry control
- **WHEN** the user closes and reopens the selector
- **THEN** a new open-triggered `request_models` SHALL be sent

