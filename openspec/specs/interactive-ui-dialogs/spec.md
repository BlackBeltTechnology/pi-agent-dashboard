## ADDED Requirements

### Requirement: UI proxy module in bridge extension
The bridge extension SHALL include a `ui-proxy.ts` module that wraps `ctx.ui` dialog methods (`confirm`, `select`, `input`, `editor`) and fire-and-forget methods (`notify`). The proxy SHALL be activated in the `session_start` handler by replacing methods on `ctx.ui`.

#### Scenario: Proxy wraps dialog methods on session start
- **WHEN** the bridge's `session_start` handler fires
- **THEN** `ctx.ui.confirm`, `ctx.ui.select`, `ctx.ui.input`, and `ctx.ui.editor` SHALL be replaced with proxy methods that forward requests to the dashboard

#### Scenario: Proxy wraps notify on session start
- **WHEN** the bridge's `session_start` handler fires
- **THEN** `ctx.ui.notify` SHALL be replaced with a proxy that both calls the original and forwards to the dashboard

### Requirement: Pending request tracking
The UI proxy SHALL maintain a `Map<requestId, { resolve, reject }>` of pending dialog requests. Each intercepted dialog call SHALL generate a unique `requestId` (UUID), store its promise resolver, and send an `extension_ui_request` message via the WebSocket connection. When the TUI wins a race, the entry SHALL be immediately deleted from the Map to prevent memory leaks.

#### Scenario: Dialog call creates pending request
- **WHEN** a wrapped dialog method (e.g., `confirm`) is called
- **THEN** the proxy SHALL generate a UUID `requestId`, store the resolver in the pending map, and send an `extension_ui_request` message

#### Scenario: Response resolves pending request
- **WHEN** an `extension_ui_response` message arrives with a matching `requestId`
- **THEN** the proxy SHALL resolve the stored promise with the response result and remove the entry from the pending map

#### Scenario: Unknown requestId response is ignored
- **WHEN** an `extension_ui_response` message arrives with a `requestId` not in the pending map
- **THEN** the proxy SHALL silently ignore it

#### Scenario: TUI wins race cleans up pending entry
- **WHEN** the TUI dialog resolves before the dashboard response
- **THEN** the proxy SHALL immediately delete the pending Map entry for that `requestId`

### Requirement: Race pattern for TUI sessions
For sessions where `ctx.hasUI` is `true`, the proxy SHALL race the original TUI dialog method against the dashboard response promise. The first resolution wins via `Promise.race`. When the dashboard wins, the proxy SHALL abort the TUI dialog by calling `abort()` on an `AbortController` whose signal was passed to the TUI call via `ExtensionUIDialogOptions.signal`. When the TUI wins, the proxy SHALL immediately delete the pending Map entry and send an `extension_ui_dismiss` message to the server so the dashboard can dismiss the stale dialog.

#### Scenario: Terminal answers first
- **WHEN** the user responds in the terminal before the dashboard
- **THEN** the original method's promise resolves first, `Promise.race` returns its value, the pending Map entry is deleted, and an `extension_ui_dismiss` message is sent to the server

#### Scenario: Dashboard answers first
- **WHEN** the dashboard user responds before the terminal
- **THEN** the dashboard promise resolves first, `Promise.race` returns its value, and the TUI dialog is dismissed via `AbortController.abort()`

#### Scenario: Both answer near-simultaneously
- **WHEN** both TUI and dashboard respond within the same event loop tick
- **THEN** `Promise.race` picks the first resolver, and the loser's cleanup handler fires immediately without error

### Requirement: Headless-only mode
For sessions where `ctx.hasUI` is `false`, the proxy SHALL NOT call the original dialog method. Only the dashboard promise is awaited.

#### Scenario: Headless session dialog
- **WHEN** `ctx.ui.confirm` is called in a headless session
- **THEN** the proxy SHALL only await the dashboard response (no TUI dialog shown)

### Requirement: Extension UI request protocol message
The extension→server protocol SHALL define `ExtensionUiRequestMessage`:
- `type`: `"extension_ui_request"`
- `sessionId`: string
- `requestId`: string (UUID for correlation)
- `method`: `"confirm" | "select" | "multiselect" | "input" | "editor" | "notify"`
- `params`: method-specific parameters object

The `params` shape per method:
- **confirm**: `{ title: string, message: string }`
- **select**: `{ title: string, options: string[] }`
- **multiselect**: `{ title: string, options: string[] }`
- **input**: `{ title: string, placeholder?: string }`
- **editor**: `{ title: string, prefill?: string }`
- **notify**: `{ message: string, level?: "info" | "warning" | "error" }`

#### Scenario: Confirm request message shape
- **WHEN** the bridge sends an `extension_ui_request` with `method: "confirm"`
- **THEN** `params` SHALL contain `title` (string) and `message` (string)

#### Scenario: Select request message shape
- **WHEN** the bridge sends an `extension_ui_request` with `method: "select"`
- **THEN** `params` SHALL contain `title` (string) and `options` (string array)

#### Scenario: Multiselect request message shape
- **WHEN** the bridge sends an `extension_ui_request` with `method: "multiselect"`
- **THEN** `params` SHALL contain `title` (string) and `options` (string array)

#### Scenario: Input request message shape
- **WHEN** the bridge sends an `extension_ui_request` with `method: "input"`
- **THEN** `params` SHALL contain `title` (string) and optional `placeholder` (string)

#### Scenario: Editor request message shape
- **WHEN** the bridge sends an `extension_ui_request` with `method: "editor"`
- **THEN** `params` SHALL contain `title` (string) and optional `prefill` (string)

#### Scenario: Notify request message shape
- **WHEN** the bridge sends an `extension_ui_request` with `method: "notify"`
- **THEN** `params` SHALL contain `message` (string) and optional `level` (string)

### Requirement: Extension UI response protocol message
The server→extension protocol SHALL define `ExtensionUiResponseMessage`:
- `type`: `"extension_ui_response"`
- `sessionId`: string
- `requestId`: string (matches the request)
- `result`: method-specific result (see below)
- `cancelled`: optional boolean

Result shapes:
- **confirm**: `{ confirmed: boolean }`
- **select**: `{ value: string }`
- **input**: `{ value: string }`
- **editor**: `{ value: string }`

When `cancelled` is `true`, the result field is ignored and the dialog resolves as: `false` for confirm, `undefined` for select/input/editor.

#### Scenario: Confirm response with confirmed true
- **WHEN** the browser sends a response with `result: { confirmed: true }`
- **THEN** the proxy SHALL resolve the confirm promise with `true`

#### Scenario: Cancelled dialog response
- **WHEN** the browser sends a response with `cancelled: true`
- **THEN** the proxy SHALL resolve confirm with `false`, and select/input/editor with `undefined`

### Requirement: Server routes requests to browsers
The dashboard server SHALL forward `extension_ui_request` messages from the bridge to all browser WebSocket clients subscribed to that session. The server→browser message SHALL use `BrowserExtensionUiRequestMessage` with the same fields.

#### Scenario: Request forwarded to subscribers
- **WHEN** the server receives an `extension_ui_request` for session X
- **THEN** the server SHALL send a `extension_ui_request` to all browser clients subscribed to session X

#### Scenario: No subscribers — request not lost
- **WHEN** the server receives an `extension_ui_request` but no browser is subscribed
- **THEN** the server SHALL hold the request (it will timeout via pi's built-in dialog timeout)

### Requirement: Server routes responses to bridge
The dashboard server SHALL forward `BrowserExtensionUiResponseMessage` from the browser to the bridge extension connection for that session. The server→extension message SHALL use `ExtensionUiResponseMessage`.

#### Scenario: Response forwarded to bridge
- **WHEN** the server receives an `extension_ui_response` from a browser for session X
- **THEN** the server SHALL forward it to the bridge WebSocket connection for session X

#### Scenario: Bridge disconnected — response dropped
- **WHEN** the server receives an `extension_ui_response` but the bridge for that session is not connected
- **THEN** the server SHALL silently drop the response

### Requirement: Interactive renderer registry
The web client SHALL include an interactive renderer registry at `src/client/components/interactive-renderers/registry.ts` following the tool renderer pattern. It SHALL export `getInteractiveRenderer(method)` returning a React component for the given method, with a fallback to a generic renderer.

#### Scenario: Known method returns specific renderer
- **WHEN** `getInteractiveRenderer("confirm")` is called
- **THEN** it SHALL return the `ConfirmRenderer` component

#### Scenario: Unknown method returns generic renderer
- **WHEN** `getInteractiveRenderer("unknown_method")` is called
- **THEN** it SHALL return a `GenericInteractiveRenderer` component

### Requirement: Confirm renderer
The `ConfirmRenderer` SHALL display the title and message as rendered markdown when pending. The title SHALL use inline markdown (no block elements) in both pending and resolved states. The message SHALL use full markdown rendering. When resolved, it SHALL collapse to a single line showing the title (inline markdown) and result (✅ Allowed or ❌ Denied).

#### Scenario: Pending confirm display
- **WHEN** a confirm request is pending with title `"Allow **dangerous** operation?"` and message `"This will:\n- Delete files\n- Reset config"`
- **THEN** the renderer SHALL render the title with bold formatting and the message as a markdown list

#### Scenario: Clicking Allow
- **WHEN** the user clicks [Allow]
- **THEN** the renderer SHALL call `onRespond({ confirmed: true })`

#### Scenario: Resolved confirm display
- **WHEN** a confirm request is resolved with `confirmed: true` and title `"Allow **dangerous** operation?"`
- **THEN** the renderer SHALL show a compact card with the title rendered as inline markdown and "✅ Allowed"

### Requirement: Select renderer
The `SelectRenderer` SHALL display the title as rendered markdown when pending and as inline markdown when resolved. When resolved, it SHALL show the selected value.

#### Scenario: Pending select display
- **WHEN** a select request is pending with title `"Choose a \`format\`"` and `options: ["JSON", "YAML"]`
- **THEN** the renderer SHALL render the title with code formatting and show a button for each option

#### Scenario: Clicking an option
- **WHEN** the user clicks option "JSON"
- **THEN** the renderer SHALL call `onRespond({ value: "JSON" })`

#### Scenario: Resolved select display
- **WHEN** a select request is resolved with `value: "JSON"` and title containing markdown
- **THEN** the renderer SHALL show a compact card with the title rendered as inline markdown and the selected value

### Requirement: Input renderer
The `InputRenderer` SHALL display the title as rendered markdown when pending and as inline markdown when resolved. When resolved, it SHALL show the entered value.

#### Scenario: Pending input display
- **WHEN** an input request is pending with title `"Enter the **project name**"`
- **THEN** the renderer SHALL render the title with bold formatting and show a text input with submit button

#### Scenario: Submitting input
- **WHEN** the user types "hello" and clicks [Submit]
- **THEN** the renderer SHALL call `onRespond({ value: "hello" })`

#### Scenario: Resolved input display
- **WHEN** an input request is resolved with `value: "hello"` and title containing markdown
- **THEN** the renderer SHALL show a compact card with the title rendered as inline markdown and the entered value

### Requirement: Editor renderer
The `EditorRenderer` SHALL display the title and a textarea (prefilled if `prefill` provided) with submit button when pending. When resolved, it SHALL show a truncated preview of the edited text.

#### Scenario: Pending editor display
- **WHEN** an editor request is pending with `prefill: "line1\nline2"`
- **THEN** the renderer SHALL show the title and a textarea prefilled with the text

#### Scenario: Resolved editor display
- **WHEN** an editor request is resolved
- **THEN** the renderer SHALL show a compact card with a truncated preview of the text

### Requirement: Notify renderer
The `NotifyRenderer` SHALL display an inline notification with appropriate color based on `level`: blue for info, yellow for warning, red for error.

#### Scenario: Info notification
- **WHEN** a notify event arrives with `level: "info"` and `message: "Done!"`
- **THEN** the renderer SHALL display the message in blue/info styling

#### Scenario: Error notification
- **WHEN** a notify event arrives with `level: "error"`
- **THEN** the renderer SHALL display the message in red/error styling

### Requirement: Chat view renders interactive UI inline
The `ChatView` SHALL render interactive UI requests as inline cards in the conversation flow. The event reducer SHALL add interactive requests to the `messages` array as `role: "interactiveUi"` entries so they appear in chronological order alongside other messages. The `interactiveRequests` array SHALL be maintained as a lookup index for resolving responses.

#### Scenario: Interactive request appears in chat
- **WHEN** the client receives an `extension_ui_request` for a subscribed session
- **THEN** a new `interactiveUi` message SHALL be added to the messages array and rendered inline at the current position

#### Scenario: Interactive request resolves in chat
- **WHEN** the user responds to a pending interactive UI card
- **THEN** both the message entry and the `interactiveRequests` entry SHALL be updated to resolved status with the result

### Requirement: Inline markdown component for interactive renderers
The interactive renderers SHALL use a shared `InlineMarkdown` component for rendering titles in compact/resolved states. This component SHALL render markdown restricted to inline elements only (`strong`, `em`, `code`, `a`) using `ReactMarkdown` with `allowedElements` and `unwrapDisallowed` to prevent block elements from breaking the single-line layout.

#### Scenario: Inline markdown renders bold and code
- **WHEN** `InlineMarkdown` receives content `"Allow **dangerous** \`rm -rf\` command?"`
- **THEN** it SHALL render `dangerous` as bold and `rm -rf` as inline code, without wrapping in `<p>` or other block elements

#### Scenario: Inline markdown strips block elements
- **WHEN** `InlineMarkdown` receives content containing a markdown list or heading
- **THEN** it SHALL strip the block elements and render only the text content inline

### Requirement: Cleanup of ExtensionUI component
The orphaned `ExtensionUI.tsx` component SHALL be removed. The old `extension_ui_event` message types (`ExtensionUiEventMessage` in protocol.ts, `BrowserExtensionUiEventMessage` in browser-protocol.ts) SHALL be removed and replaced by the new request/response types.

#### Scenario: Old message types removed
- **WHEN** the protocol types are compiled
- **THEN** `ExtensionUiEventMessage` and `BrowserExtensionUiEventMessage` SHALL NOT exist

#### Scenario: Old component removed
- **WHEN** the client code is compiled
- **THEN** `ExtensionUI.tsx` SHALL NOT exist

### Requirement: Extension UI dismiss protocol message
The extension→server protocol SHALL define `ExtensionUiDismissMessage` with fields: `type: "extension_ui_dismiss"`, `sessionId: string`, `requestId: string`. This message is sent by the bridge when the TUI wins a race, instructing the server to dismiss the corresponding dashboard dialog.

#### Scenario: Dismiss message sent when TUI wins
- **WHEN** the TUI dialog resolves before the dashboard
- **THEN** the bridge SHALL send an `extension_ui_dismiss` message with the matching `requestId`

#### Scenario: Server forwards dismiss to browser
- **WHEN** the server receives an `extension_ui_dismiss` for session X
- **THEN** the server SHALL forward a `ui_dismiss` message to all browser clients subscribed to session X

### Requirement: Server routes dismiss to browsers
The dashboard server SHALL forward `extension_ui_dismiss` messages from the bridge to all browser WebSocket clients subscribed to that session. The server→browser message SHALL use `BrowserUiDismissMessage` with fields: `type: "ui_dismiss"`, `sessionId: string`, `requestId: string`.

#### Scenario: Dismiss forwarded to subscribers
- **WHEN** the server receives an `extension_ui_dismiss` for session X
- **THEN** the server SHALL send a `ui_dismiss` message to all browser clients subscribed to session X

#### Scenario: No subscribers — dismiss is dropped
- **WHEN** the server receives an `extension_ui_dismiss` but no browser is subscribed
- **THEN** the server SHALL silently drop the message

### Requirement: Dismissed state for interactive dialogs
The interactive UI dialog system SHALL support a `"dismissed"` status in addition to `"pending"`, `"resolved"`, and `"cancelled"`. When a `ui_dismiss` message is received for a pending dialog, the event reducer SHALL transition it to `"dismissed"` status. The interactive renderers SHALL display dismissed dialogs as compact cards with an "Answered in terminal" indicator.

#### Scenario: Dismiss message transitions pending dialog
- **WHEN** a `ui_dismiss` message arrives for a pending interactive request
- **THEN** the event reducer SHALL update the request status to `"dismissed"`

#### Scenario: Dismiss for non-pending dialog is ignored
- **WHEN** a `ui_dismiss` message arrives for an already resolved or cancelled request
- **THEN** the event reducer SHALL not change the request status

#### Scenario: Dismissed dialog renders as compact card
- **WHEN** an interactive dialog has status `"dismissed"`
- **THEN** the renderer SHALL display a compact card showing the title and an "Answered in terminal" indicator, similar to the resolved state styling

### Requirement: ask_user Tool Call Rendering

`ToolCallStep` SHALL NOT render `ask_user` tool calls using interactive renderers. The interactive UI for ask_user questions SHALL be rendered exclusively by the `interactiveUi` message created from `extension_ui_request`.

When a live `interactiveUi` message is present for the same question — identified by a shared `toolCallId` — the `ask_user` tool card SHALL NOT be rendered at all. The `interactiveUi` message SHALL be the single card for that question, avoiding a duplicated title/description.

When NO paired `interactiveUi` message is present (e.g. history reload, where the server replays only pending prompts and an already-answered `ask_user` has no live `interactiveUi` message), `ToolCallStep` SHALL render the `ask_user` tool card as the sole surviving record of the question and its answer.

#### Scenario: paired interactive card suppresses the tool card

- **WHEN** the message list contains a `toolResult` with `toolName: "ask_user"` and `toolCallId: t1` AND an `interactiveUi` message with matching `toolCallId: t1`
- **THEN** the `ask_user` tool card SHALL NOT be rendered
- **AND** the `interactiveUi` message SHALL be the only card for that question

#### Scenario: answered prompt on history reload keeps the tool card

- **WHEN** the message list contains a `toolResult` with `toolName: "ask_user"` and NO `interactiveUi` message shares its `toolCallId`
- **THEN** `ToolCallStep` SHALL render the `ask_user` tool card with its reconstructed answer summary

#### Scenario: Interactive UI request appears in chat

- **WHEN** an `extension_ui_request` message is received for an ask_user dialog
- **THEN** a single `interactiveUi` message SHALL be rendered with the appropriate `InteractiveRenderer`
- **AND** this SHALL be the only interactive card for that question
