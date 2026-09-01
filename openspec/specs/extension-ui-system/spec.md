# extension-ui-system Specification

## Purpose

Stub created by change `extension-ui-system` (design-only proposal). The capability covers a generalized, schema-driven mechanism for extensions to declare UI surfaces (modal management dialogs and live in-page decorations) that the dashboard renders in a bounded set of named slots, with no extension-authored React or runtime SDK required.

The design that motivates this capability lives in `openspec/changes/extension-ui-system/design.md`. Phase 1 requirements (management modals) and Phase 2 requirements (live decorations, shipped via `add-extension-ui-decorations`) are defined below.

## Requirements

### Requirement: Bridge SHALL emit a discovery probe for extension UI modules

The bridge MUST emit `pi.events.emit("ui:list-modules", probe)` where `probe` is `{ modules: ExtensionUiModule[] }` on three triggers: (a) every `session_start` whose `event.reason ∈ {"new","fork","resume"}`, (b) successful WebSocket reconnect after re-registration, (c) any extension-emitted `ui:invalidate` event. After each probe the bridge MUST forward the populated `probe.modules` to the server as a `ui_modules_list` protocol message.

The probe MUST be synchronous: the bridge collects whatever extensions push into `probe.modules` during the `pi.events.emit` call and forwards immediately. The bridge MUST NOT poll, MUST NOT cache module lists across probes, and MUST NOT register modules on the extension's behalf.

#### Scenario: Probe fires on session start
- **WHEN** the bridge processes a `session_start` event with `reason: "new"`
- **THEN** the bridge emits `pi.events.emit("ui:list-modules", probe)` exactly once and forwards a `ui_modules_list` message containing every descriptor pushed by listeners

#### Scenario: Probe re-fires on reconnect
- **WHEN** the bridge's WebSocket connection closes and reconnects successfully
- **AND** session re-registration completes
- **THEN** the bridge emits a fresh `ui:list-modules` probe and forwards an updated `ui_modules_list` containing the current set of modules

#### Scenario: Invalidate triggers re-probe
- **WHEN** an extension emits `pi.events.emit("ui:invalidate", { id: "judo-status" })`
- **THEN** the bridge emits a fresh `ui:list-modules` probe and forwards an updated `ui_modules_list`
- **AND** the optional `id` parameter is recorded for telemetry only — the bridge always re-lists the full module set

#### Scenario: Last-write-wins on duplicate id
- **WHEN** two listeners push descriptors with the same `id` into a single probe
- **THEN** the bridge logs a warning naming the duplicate `id` and forwards only the last-pushed descriptor for that `id`

#### Scenario: No-dashboard fallback
- **WHEN** the bridge has no active dashboard server connection
- **THEN** the bridge does not emit `ui:list-modules` and does not attempt to forward a `ui_modules_list`
- **AND** extension listeners remain dormant; existing slash-command and TUI behavior is unaffected

### Requirement: Module schema SHALL describe Phase-1 view types

The shared package `@blackbelt-technology/pi-dashboard-shared` MUST export `ExtensionUiModule`, `UiView`, `UiField`, `UiAction`, and `UiSection` types. `ExtensionUiModule.kind` MUST equal the literal `"management-modal"` for Phase 1. `UiView.kind` MUST be one of `"table" | "grid" | "form"`. `UiField.kind` MUST be one of `"text" | "number" | "boolean" | "select" | "code" | "datetime" | "textarea"`. `UiAction.icon` and `ExtensionUiModule.icon` MUST refer to keys exported by `@mdi/js`; unknown icon keys MUST render no icon (no error).

`ExtensionUiModule` MUST carry: `kind`, `id`, `command` (exact slash-command string), `title`, and `view`. `command` matching is case-sensitive and exact. Phase 1 does NOT introduce a `namespace` field on the module.

#### Scenario: Table view module is well-formed
- **WHEN** an extension pushes `{ kind: "management-modal", id: "judo-status", command: "/judo:status", title: "Judo Status", view: { kind: "table", fields: [...], dataEvent: "judo:status-rows", rowActions: [...] } }`
- **THEN** the descriptor passes runtime type validation in the shared package
- **AND** the dashboard interprets `view.kind === "table"` and prepares to fetch rows via `view.dataEvent`

#### Scenario: Form view module with sections is well-formed
- **WHEN** an extension pushes a `management-modal` whose `view.kind === "form"` and `view.sections` is a non-empty array of `UiSection` entries
- **THEN** the descriptor passes runtime type validation
- **AND** the dashboard groups fields by section when rendering the form

#### Scenario: Unknown icon name is ignored
- **WHEN** a module declares `icon: "mdiTotallyMadeUpName"` not present in `@mdi/js`
- **THEN** the dashboard renders the module without an icon and emits no error to the user

### Requirement: Wire protocol SHALL include three Phase-1 messages

The protocol MUST add three messages, with identical names on bridge↔server and server↔browser legs:

- `ui_modules_list { sessionId, modules }` — extension → server → browser; cached schemas.
- `ui_data_list { sessionId, event, items }` — extension → server → browser; row data for `table`/`grid` views, keyed by `event` matching some `view.dataEvent`.
- `ui_management { sessionId, action, event, params? }` — browser → server → extension; data fetches use `action: "list"`; user actions use `action: <UiAction.id>`.

All three new browser-bound messages MUST be members of the `ServerToBrowserMessage` union and the new browser-originated message MUST be a member of the `BrowserToServerMessage` union; otherwise esbuild strips them in production.

#### Scenario: Modules list propagates extension → browser
- **WHEN** the bridge sends `ui_modules_list { sessionId: "s1", modules: [m1, m2] }` to the server
- **THEN** the server stores the modules on the Session record
- **AND** the server broadcasts an identical `ui_modules_list` message to every browser subscribed to `s1`

#### Scenario: Browser action triggers extension event
- **WHEN** a subscribed browser sends `ui_management { sessionId: "s1", action: "delete", event: "judo:delete-row", params: { id: 42 } }`
- **THEN** the server forwards the message via `piGateway.sendToSession("s1", msg)`
- **AND** the bridge re-emits it as `pi.events.emit("judo:delete-row", { id: 42, action: "delete", _reply })` for extensions to handle

### Requirement: Server SHALL cache and replay UI module state on subscribe

The server MUST cache `Session.uiModules: ExtensionUiModule[]` and `Session.uiDataMap: Record<string, unknown[]>` on the in-memory Session record. `uiDataMap[event]` MUST cap to the most recent N items (default `N = 1000`); on overflow the cached list is replaced with the most recent message's `items`.

On every `handleSubscribe` call site that currently invokes `replayPendingUiRequests(ws, sessionId)`, the server MUST also invoke an equivalent `replayUiState(ws, sessionId)` immediately after, in this order: events → pending UI requests → UI module state. `replayUiState` MUST send one `ui_modules_list` message containing `session.uiModules` (skipped when empty) and one `ui_data_list` message per `(event, items)` entry in `session.uiDataMap`.

When the session record is removed, the cached `uiModules` and `uiDataMap` MUST be removed with it; no separate cleanup is required.

#### Scenario: Modules list is replayed on subscribe
- **GIVEN** a session `s1` with `session.uiModules = [m1, m2]` cached on the server
- **WHEN** a browser subscribes to `s1`
- **THEN** the server sends a `ui_modules_list { sessionId: "s1", modules: [m1, m2] }` to that browser
- **AND** sends it after the event-replay batches and pending-UI-request replay complete

#### Scenario: Data map is replayed on subscribe
- **GIVEN** a session with `session.uiDataMap = { "judo:status-rows": [r1, r2], "judo:audit": [r3] }`
- **WHEN** a browser subscribes
- **THEN** the server sends a `ui_data_list` message for each event key in `uiDataMap`

#### Scenario: Per-event cap discards oldest data
- **GIVEN** the per-event cap is `N = 1000`
- **WHEN** an extension sends a `ui_data_list` whose `items.length === 1500`
- **THEN** the server caches only the last 1000 entries (or the entire payload if extensions choose to send fewer); never raises an error

### Requirement: Slash-command interception SHALL open the matching modal

The client MUST intercept slash-command input matching exactly some `module.command` in `session.uiModules` and open the matching `GenericExtensionDialog` in place of sending a chat prompt. Matching is case-sensitive, exact (no prefix or substring matches). The intercepted text MUST NOT be forwarded to the extension as a regular prompt and MUST clear from the input field.

If `module.command` collides with a built-in command (e.g. `/model`, `/compact`), the dashboard MUST prefer the built-in and emit a console warning identifying the conflicting module `id`.

#### Scenario: Exact-match command opens the modal
- **GIVEN** `session.uiModules` contains a module with `command: "/judo:status"`
- **WHEN** the user types `/judo:status` and presses Enter in `CommandInput`
- **THEN** `GenericExtensionDialog` opens for that module
- **AND** no `send_prompt` message is sent
- **AND** the input field is cleared

#### Scenario: Built-in command takes precedence
- **GIVEN** an extension registers a module with `command: "/model"`
- **WHEN** the user types `/model`
- **THEN** the dashboard runs the built-in `/model` handler
- **AND** the dashboard emits a console warning naming the conflicting module id

### Requirement: GenericExtensionDialog SHALL render Phase-1 view kinds

The client component `GenericExtensionDialog` MUST render `view.kind ∈ {"table", "grid", "form"}`:

- `table` — header row from `view.fields`, body rows from `session.uiDataMap[view.dataEvent]`, per-row buttons from `view.rowActions`. On mount the component MUST send `ui_management { action: "list", event: view.dataEvent }`.
- `grid` — same data lifecycle as `table` but rendered as a card grid.
- `form` — fields from `view.fields` (or grouped by `view.sections`); top-level `view.actions` are toolbar buttons.

When a `UiAction.confirm` string is set, clicking the action MUST first mount `ConfirmDialog` with that string as the message and the action's label as the confirm-button label; only on confirm does the client send the `ui_management` message. Cancel MUST NOT send the message.

#### Scenario: Table view fetches and renders rows
- **WHEN** `GenericExtensionDialog` opens for a table-view module with `view.dataEvent === "judo:status-rows"`
- **THEN** the component sends `ui_management { action: "list", event: "judo:status-rows" }`
- **AND** when a `ui_data_list` arrives for that event, the table re-renders with the new items

#### Scenario: Action confirmation gates dispatch
- **GIVEN** a row action with `confirm: "Delete this entry?"`
- **WHEN** the user clicks the action
- **THEN** the dashboard mounts `ConfirmDialog` with that message
- **AND** clicking Cancel does not send a `ui_management` message
- **AND** clicking Confirm sends `ui_management { action: <UiAction.id>, event: <UiAction.event>, params: <UiAction.params> }`

### Requirement: Pure-pi behavior SHALL be unchanged

When the bridge is not running, or no dashboard server is connected, extension listeners on `ui:list-modules` MUST remain dormant, `ui:invalidate` MUST be a no-op, slash commands MUST fall back to existing text-output behavior, and `ctx.ui.*` MUST continue to work via `pi-tui` and PromptBus.

#### Scenario: Slash command falls back without a dashboard
- **GIVEN** an extension registers a `ui:list-modules` listener pushing `{ command: "/judo:status", ... }`
- **AND** the pi session is running without a dashboard server
- **WHEN** the user types `/judo:status` in the TUI
- **THEN** the existing slash-command handler runs (text output to the chat) and the new probe-based modal path does nothing

### Requirement: Bridge SHALL partition probe results into modules and decorators

The bridge's `refreshUiModules(ctx)` (added by Phase 1) MUST partition entries pushed into `probe.modules` by `kind`. Entries with `kind === "management-modal"` MUST be forwarded as a single `ui_modules_list` message (Phase 1 behavior, unchanged). Entries with `kind ∈ {"footer-segment", "agent-metric", "breadcrumb", "gate", "toast"}` MUST each be forwarded as one `ext_ui_decorator` message with the descriptor verbatim.

The probe trigger sites are unchanged from Phase 1: `session_start` (with `event.reason ∈ {"new","fork","resume"}`), successful WebSocket reconnect after re-registration, and any extension-emitted `ui:invalidate` event. Phase 2 introduces no new probe channels.

#### Scenario: Mixed probe partitions correctly
- **WHEN** a probe receives one `management-modal` descriptor and three decorator descriptors of different kinds
- **THEN** the bridge forwards exactly one `ui_modules_list` message containing only the `management-modal` descriptor
- **AND** the bridge forwards exactly three `ext_ui_decorator` messages, one per decorator descriptor

#### Scenario: Decorator-only probe forwards no modules list
- **WHEN** the only descriptors pushed during a probe are decorators (no `management-modal`)
- **THEN** the bridge forwards `ui_modules_list { modules: [] }` (or skips the message — implementation choice, but MUST NOT crash)
- **AND** the bridge forwards one `ext_ui_decorator` per decorator descriptor

#### Scenario: Invalidate triggers decorator re-forwarding
- **WHEN** an extension emits `pi.events.emit("ui:invalidate", { id: "model-state" })` after pushing a `footer-segment` decorator on a previous probe with fresh payload text
- **THEN** the bridge re-runs the probe and forwards an updated `ext_ui_decorator` whose `payload.text` reflects the new state

### Requirement: Decorator descriptors SHALL carry namespace and validated id

Decorator descriptors MUST include both `namespace: string` and `id: string` fields. `namespace` MUST be a non-empty string matching `/^[a-z0-9-]+$/`. The bridge MUST drop and warn on descriptors with malformed or empty `namespace`. The cache key for server-side storage and replay MUST be the literal string `${kind}:${namespace}:${id}`.

Within a single probe pass, two pushes producing the same `(kind, namespace, id)` triple MUST cause the bridge to log a warning naming the colliding key and forward only the last-pushed descriptor. Two pushes with the same `id` but different `namespace` are NOT a collision and both MUST be forwarded.

Phase 2 does NOT retroactively introduce a `namespace` field onto Phase 1 `management-modal` modules; modules retain the `id`-only convention from Phase 1.

#### Scenario: Two namespaces, same id, both forwarded
- **WHEN** extensions `pi-judo` and `pi-flows` both push a decorator with `id: "model-state"` but different `namespace` values (`"judo"` vs `"flows"`)
- **THEN** the bridge forwards two separate `ext_ui_decorator` messages
- **AND** the server caches them under distinct keys

#### Scenario: Same triple within one probe collides
- **WHEN** a single probe pushes two `footer-segment` descriptors with the same `(namespace, id)`
- **THEN** the bridge logs a collision warning naming the cache key
- **AND** the bridge forwards only the last-pushed descriptor

#### Scenario: Empty namespace is rejected
- **WHEN** a probe pushes a decorator with `namespace: ""`
- **THEN** the bridge logs a validation warning and does NOT forward an `ext_ui_decorator` for that descriptor

### Requirement: Wire protocol SHALL include the ext_ui_decorator message

The shared package MUST export `ExtUiDecoratorMessage` carrying `{ type: "ext_ui_decorator", sessionId, descriptor: DecoratorDescriptor, removed?: boolean }`. The same message shape MUST appear on the extension↔server (`protocol.ts`) and server↔browser (`browser-protocol.ts`) legs. `ExtUiDecoratorMessage` MUST be a member of both the `ExtensionToServerMessage` union and the `ServerToBrowserMessage` union; otherwise esbuild strips the switch arms in production builds.

`DecoratorDescriptor` MUST be a discriminated union over `kind ∈ {"footer-segment", "agent-metric", "breadcrumb", "gate", "toast"}` with the per-kind `payload` shapes defined below:

- `footer-segment` — `{ text: string; tooltip?: string; icon?: string }`
- `agent-metric` — `{ agentId: string; text: string; tooltip?: string }`
- `breadcrumb` — `{ steps: { id: string; label: string; status: "pending" | "active" | "done" | "error" }[]; current?: string }`
- `gate` — `{ flowId: string; available: boolean; reason?: string }`
- `toast` — `{ level: "info" | "success" | "warn" | "error"; message: string; durationMs?: number }`

Icon fields (`footer-segment.icon` and any future decorator icons) MUST refer to keys exported by `@mdi/js`; unknown keys MUST render no icon and emit no user-facing error.

#### Scenario: Decorator message propagates extension → browser
- **WHEN** the bridge sends `ext_ui_decorator { sessionId: "s1", descriptor: { kind: "footer-segment", namespace: "judo", id: "model-state", payload: { text: "3 mut" } } }`
- **THEN** the server caches the descriptor under key `"footer-segment:judo:model-state"` on `Session.uiDecorators`
- **AND** the server broadcasts an identical `ext_ui_decorator` to every browser subscribed to `s1`

#### Scenario: Removed flag is forwarded verbatim
- **WHEN** the bridge sends `ext_ui_decorator { ..., removed: true }`
- **THEN** the server deletes the cache entry under the matching key
- **AND** the server broadcasts the message to subscribers with `removed: true` preserved

### Requirement: Server SHALL cache decorators and replay on subscribe

The server MUST extend the in-memory Session record with `uiDecorators?: Record<string, DecoratorDescriptor>` keyed by `${kind}:${namespace}:${id}`. On `ext_ui_decorator` from an extension:

- If `removed === true`, the server MUST delete the matching cache entry and broadcast the message verbatim. Deleting an absent key MUST be a no-op (no error, no broadcast suppression).
- Otherwise the server MUST upsert the descriptor under its cache key and broadcast.

`replayUiState(ws, sessionId)` (Phase 1 helper) MUST be extended to send one `ext_ui_decorator` message per entry in `session.uiDecorators` after the existing `ui_modules_list` and `ui_data_list` replay batches. Replay messages MUST NOT carry `removed: true` — only live entries are replayed; removed entries are already absent from the cache.

The replay ordering MUST be: events → pending UI requests → `ui_modules_list` → `ui_data_list` (per event) → `ext_ui_decorator` (per cache key).

When the Session record is removed, the cached `uiDecorators` MUST be removed with it; no separate cleanup is required.

#### Scenario: Decorators replay on subscribe after Phase-1 batches
- **WHEN** a browser subscribes to a session whose `uiDecorators` contains three live entries
- **THEN** the server sends one `ui_modules_list` (Phase 1), the corresponding `ui_data_list` messages (Phase 1), and then exactly three `ext_ui_decorator` messages (one per cache entry) — none with `removed: true`

#### Scenario: Removed decorator deletes cache entry
- **WHEN** the server receives `ext_ui_decorator { descriptor: {kind:"gate", namespace:"judo", id:"save"}, removed: true }` and the matching cache entry exists
- **THEN** the server deletes `session.uiDecorators["gate:judo:save"]`
- **AND** the server broadcasts the removal message to subscribers

#### Scenario: Removal of absent entry is a no-op
- **WHEN** the server receives `ext_ui_decorator { ..., removed: true }` for a key that is not in the cache
- **THEN** the server takes no cache action and still broadcasts the message verbatim to subscribers

### Requirement: Client SHALL render decorators in five named slots

The client MUST mount five slot components, each filtering `session.uiDecorators` by `kind` and rendering only matching descriptors:

| Slot component | Mount site | Filter |
|---|---|---|
| `FooterSegmentSlot` | `SessionHeader.tsx`, right of git info | `kind === "footer-segment"` |
| `AgentMetricSlot` | Inside `FlowAgentCard.tsx`, one per card | `kind === "agent-metric" && payload.agentId === card.agentId` |
| `BreadcrumbSlot` | Top of `FlowDashboard.tsx` | `kind === "breadcrumb"` |
| `GateSlot` | Inline in each `FlowLaunchDialog` item | `kind === "gate" && payload.flowId === item.flowId` |
| `ToastSlot` | `App.tsx`, fixed top-right tray | `kind === "toast"` |

`useMessageHandler.ts` MUST dispatch `ext_ui_decorator` (with or without `removed: true`) into a per-session reducer slot adjacent to the existing `uiModules` / `uiDataMap` state added by Phase 1. `removed: true` MUST delete the matching descriptor from the client state without affecting siblings.

`GateSlot` MUST grey out the matching `FlowLaunchDialog` item and render `payload.reason` as a hover tooltip when `available: false`. When two `gate` descriptors target the same `flowId`, the slot MUST render the most-restrictive aggregate: any `available: false` wins; reasons from all contributing descriptors are concatenated for display.

`BreadcrumbSlot` MUST render steps in the order declared by `payload.steps`. The active step (matching `payload.current`, or the first `status: "active"` step otherwise) MUST be visually highlighted; `status: "done"` steps MUST show a check; `status: "error"` steps MUST be rendered in an error style.

`ToastSlot` MUST stack concurrent toasts (no deduplication) and auto-dismiss each toast after `payload.durationMs` (default 5000ms; `0` means sticky until manually dismissed). The slot MUST cap the simultaneously-rendered toast count at 5; on overflow, the oldest visible toast MUST be evicted (FIFO). The server cache stores all toast descriptors regardless of the client display cap.

`AgentMetricSlot` MUST render `payload.text` directly under the matching `FlowAgentCard` (matched by `payload.agentId`). A descriptor whose `agentId` does not match any current agent MUST be silently ignored on the client without affecting other slots.

#### Scenario: Footer segment renders in session header
- **WHEN** `session.uiDecorators` contains `{ kind: "footer-segment", namespace: "judo", id: "model-state", payload: { text: "3 mut" } }`
- **THEN** `SessionHeader` renders "3 mut" in the footer-segment slot to the right of the git info

#### Scenario: Gate greys out flow launcher item
- **WHEN** a `gate` decorator has `payload: { flowId: "judo:save", available: false, reason: "Not in a judo workspace" }`
- **THEN** the matching `FlowLaunchDialog` item is rendered with disabled styling
- **AND** hovering the item shows the tooltip text "Not in a judo workspace"

#### Scenario: Toast auto-dismiss
- **WHEN** a `toast` decorator with `payload: { level: "info", message: "Done", durationMs: 1000 }` arrives
- **THEN** `ToastSlot` displays it and removes it from the rendered tray after 1000ms

#### Scenario: Removed flag unmounts a single decorator
- **WHEN** the client receives `ext_ui_decorator { descriptor: {kind:"footer-segment", namespace:"judo", id:"model-state"}, removed: true }` and one matching descriptor is currently rendered alongside others
- **THEN** the matching descriptor is unmounted and other footer-segment descriptors continue to render unchanged

#### Scenario: Most-restrictive gate wins on collision
- **WHEN** two `gate` descriptors target the same `flowId` and one declares `available: false` while the other declares `available: true`
- **THEN** `GateSlot` renders the item in the disabled (unavailable) state with the reason from the unavailable descriptor

### Requirement: Decorator invalidation rate SHALL be bounded

The bridge MUST cap per-session decorator-invalidation throughput at a default of 20 invalidations per second. Excess `ui:invalidate` events that would result in re-probing decorators within the rate window MUST be coalesced (the next probe runs at the end of the window) and the bridge MUST log a warning identifying the offending invalidation rate.

This cap applies to invalidation events that result in decorator changes; Phase 1 module-only probes are not subject to a separate cap.

#### Scenario: Burst of invalidations is coalesced
- **WHEN** an extension emits `ui:invalidate` 100 times within 200ms
- **THEN** the bridge runs at most a small bounded number of probes within that window (one at the start plus one trailing edge probe)
- **AND** the bridge logs a single warning naming the rate-cap event

## Related Capabilities

- `interactive-ui-dialogs` — handles `ctx.ui.*` one-shot prompts (orthogonal: PromptBus is request/response; this capability is push-based descriptors).
- `ui-proxy` — wraps `ctx.ui.*` calls in the bridge for dashboard forwarding (orthogonal: same boundary, different mechanism).
- `extension-ui-forwarding` — historical placeholder for catch-all event-bus forwarding. Its spec was never authored (0 bytes since the initial commit) and was removed; this capability supersedes it for declarative UI, and raw event-forwarding remains for arbitrary extension events.
- `pi-resource-scanner` — discovers extensions on disk; this capability operates on extensions already loaded in a pi session, after their UI listeners have registered.
