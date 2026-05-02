## MODIFIED Requirements

### Requirement: wrappedHandleSend has no flow-specific interceptors

The chat input's send handler (`wrappedHandleSend` in `App.tsx`) SHALL NOT contain hard-coded interception branches for `/flows`, `/flows:new`, or any other extension-provided slash command. Routing precedence on every submit SHALL be:

1. **Extension UI module match** — if the trimmed text starts with `/` and matches an `ExtensionUiModule.command` whose value is NOT in `BUILTIN_SLASH_COMMANDS`, the shell SHALL open that module's modal and SHALL NOT forward the text to the bridge.
2. **Built-in slash collision warning** — if a UI module declares a `command` value present in `BUILTIN_SLASH_COMMANDS`, the shell SHALL log a warning naming the offending module id and drop the module (i.e. the universal forward path applies). This branch is unchanged from today.
3. **Default forward** — otherwise, the shell SHALL pass the text and any pending images to `handleSend` (the underlying WebSocket send + reducer pipeline).

The `BUILTIN_SLASH_COMMANDS` Set SHALL retain its current membership of nine entries (`/flows`, `/flows:new`, `/flows:edit`, `/flows:delete`, `/compact`, `/reload`, `/new`, `/model`, `/roles`). The Set's purpose is reduced to preventing extension UI modules from claiming reserved command strings; the App SHALL NOT branch on the Set for any other reason.

The App SHALL NOT contain any `useState` hook whose role is to drive a slash-command-triggered flow dialog (`flowPickerOpen`, `flowNewOpen`, `flowEditPickerOpen`, `flowEditFlowName`, `flowDeletePickerOpen`, `flowDeleteFlowName`, `flowLaunchTarget`). All flow-dialog ownership lives outside `App.tsx`.

#### Scenario: /flows submitted falls through to bridge

- **WHEN** the user types `/flows` in the chat input and submits
- **THEN** `wrappedHandleSend` SHALL call `handleSend("/flows", undefined)` (or with the current pending images), no dashboard dialog SHALL open, and `App.tsx` SHALL contain no state mutation related to flow dialogs.

#### Scenario: /flows:new submitted falls through to bridge

- **WHEN** the user types `/flows:new` in the chat input and submits
- **THEN** the same default-forward path SHALL apply; the bridge receives the slash text; pi-flows' registered `flows:new` handler runs and prompts via `ctx.ui.input` rendered through PromptBus.

#### Scenario: Extension UI module collision still warns and drops

- **WHEN** an extension declares a UI module with `command: "/compact"` (a `BUILTIN_SLASH_COMMANDS` entry)
- **THEN** the shell SHALL log a warning naming the module id and drop the module from the autocomplete and from the routing match, and `/compact` SHALL forward to the bridge as today.

#### Scenario: Extension UI module match for non-built-in command opens its modal

- **WHEN** an extension declares a UI module with `command: "/myext:status"` and the user types that command and submits
- **THEN** the shell SHALL open the extension UI module modal exactly as today (this path is unchanged by this change).

#### Scenario: SessionFlowActions on session card unchanged

- **WHEN** the user clicks the flow action button on a session card (rendered by the flows-plugin's `session-card-action-bar` slot claim)
- **THEN** the plugin-owned rich picker SHALL render exactly as today, regardless of slash-command routing changes in `App.tsx`.
