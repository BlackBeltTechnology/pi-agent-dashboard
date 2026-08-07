# notify-message-channel

## ADDED Requirements

### Requirement: Notify has a dedicated protocol message

The pi→server and server→browser protocols SHALL each define a `notify` message
distinct from `prompt_request`:

- `type`: `"notify"`
- `sessionId`: string
- `notifyId`: string (UUID)
- `message`: string
- `level`: optional `"info" | "success" | "warning" | "error"`

The `level` union SHALL include `"success"` because `NotifyRenderer` already
renders that level today; adopting a narrower union would silently drop
notifications that currently display. A `level` outside the union SHALL be
normalized to `"info"` at the send site rather than forwarded untyped.

`notifyId` SHALL serve as the stable render key for the resulting chat row and as
the row's dedup key. Dedup SHALL be by `notifyId`, NOT by message text — two
identical notifications are two distinct events and both SHALL render.

A `notify` message SHALL NOT carry a `promptId`, `prompt`, `component`, or
`placement` field. `placement` is omitted deliberately: the client's widget-bar
suppression keys off the prompt component type, not the wire `placement` field,
which has no consumer.
`PromptRequestMessage` SHALL retain its exact current shape.

#### Scenario: Notify message shape

- **WHEN** the bridge emits a notify for a session
- **THEN** the message SHALL have `type: "notify"` with `sessionId`, `notifyId`, and `message`
- **AND** SHALL NOT contain a `promptId` or `placement` field

#### Scenario: Notify is a valid protocol discriminant

- **WHEN** a consumer switches on the message `type` discriminant
- **THEN** `"notify"` SHALL be a statically known member of the union
- **AND** SHALL NOT require an `as any` cast at the send site

#### Scenario: Level is optional

- **WHEN** the bridge emits a notify whose originating `ctx.ui.notify` call passed no level
- **THEN** `level` SHALL be absent
- **AND** the message SHALL still be valid

#### Scenario: Success level survives the split

- **WHEN** an extension calls `ctx.ui.notify(message, "success")`
- **THEN** the emitted `notify` SHALL carry `level: "success"`
- **AND** the rendered row SHALL use the success styling it uses today

#### Scenario: Unrecognized level is normalized at the send site

- **WHEN** an extension calls `ctx.ui.notify(message, "debug")`
- **THEN** the emitted `notify` SHALL carry `level: "info"`
- **AND** the send site SHALL NOT require a cast

#### Scenario: Two identical notifications both render

- **WHEN** a session receives two notifications with identical `message` text and distinct `notifyId`s
- **THEN** two chat rows SHALL render
- **AND** dedup SHALL NOT collapse them by text

### Requirement: The bridge sends notify over the notify channel

The bridge's `ctx.ui.notify` proxy SHALL call the original notify and then send a
`notify` message. It SHALL NOT send a `prompt_request` for a notification, and it
SHALL NOT register the notification with `PromptBus`.

#### Scenario: Notify proxy emits the notify message

- **WHEN** an extension calls `ctx.ui.notify("hello", "info")` in a bridged session
- **THEN** the original notify SHALL be called
- **AND** a single `notify` message SHALL be sent with `message: "hello"` and `level: "info"`
- **AND** no `prompt_request` message SHALL be sent

#### Scenario: Notify does not enter PromptBus

- **WHEN** `ctx.ui.notify` is called
- **THEN** `promptBus.getPendingRequests()` SHALL NOT gain an entry for it
- **AND** no `prompt_dismiss` SHALL be expected for it

#### Scenario: Notify is not re-sent by the bridge on reconnect

- **WHEN** the bridge reconnects and replays its pending PromptBus requests
- **THEN** previously sent notifications SHALL NOT be among them
- **AND** transcript durability SHALL instead be provided by the server-side notify log

### Requirement: The server routes notify to subscribers without pending-ask effects

On receiving a `notify` for a session it owns, the server SHALL forward the
message to that session's browser subscribers and SHALL perform none of the
pending-prompt side effects: no `trackPromptRequest`, no `currentTool` write, no
unread stamp, and no `questionFirst` reorder.

A `notify` for an unknown or `ended` session SHALL be dropped, matching the
existing `prompt_request` ownership guard.

#### Scenario: Notify reaches browser subscribers

- **WHEN** a `notify` arrives for a live owned session
- **THEN** the message SHALL be delivered to that session's subscribers

#### Scenario: Notify does not create a pending prompt

- **WHEN** a `notify` arrives for a session with no pending prompts
- **THEN** `hasPendingPromptRequests(sessionId)` SHALL remain `false`

#### Scenario: Notify does not set the ask_user tool state

- **WHEN** a `notify` arrives for a session whose `currentTool` is `null`
- **THEN** the session's `currentTool` SHALL remain `null`
- **AND** no `session_updated` broadcast SHALL be emitted for the notify

#### Scenario: Notify does not mark the session unread

- **WHEN** a `notify` arrives for a live session no browser is viewing
- **THEN** the session SHALL NOT be marked unread
- **AND** the `questionFirst` reorder SHALL NOT fire

#### Scenario: Notify for a dead session is dropped

- **WHEN** a `notify` arrives for a session that is unknown or whose status is `ended`
- **THEN** it SHALL be dropped without delivery, logging, or session-state effect

### Requirement: Notify durability is provided by a bounded notify log

The server SHALL retain delivered notifications for a session in a notify log and
SHALL replay that log to each browser socket that subscribes to the session, so a
notification survives a page refresh as it does today.

The notify log SHALL be strictly separate from the pending-ask registries. It
SHALL NOT contribute to `hasPendingPromptRequests`, to the embed-lifecycle
`hasPendingAsk` union, or to the `currentTool` derivation.

The log SHALL hold at most 50 entries per session, evicting oldest-first.

The log SHALL be retained when a session ends, so an ended session's transcript
keeps the notifications it displayed while alive. Reapability is protected by the
separation above — the reclamation gate never reads the log — not by deleting it.

The log SHALL be persisted alongside the session record so it survives a server
restart, matching the rest of the transcript, which survives via the event store.

#### Scenario: Notify survives a browser refresh

- **WHEN** a session receives a notify
- **AND** a browser subsequently subscribes to that session
- **THEN** the subscribing browser SHALL receive the notification
- **AND** the chat row SHALL appear as it did before the refresh

#### Scenario: The notify log is not a pending ask

- **WHEN** a session's notify log holds one or more entries and it has no genuine pending prompt
- **THEN** `hasPendingPromptRequests(sessionId)` SHALL return `false`
- **AND** the embed-lifecycle `hasPendingAsk` union SHALL report no pending ask
- **AND** the session SHALL remain eligible for reclamation

#### Scenario: The notify log holds exactly the cap

- **WHEN** a session has received exactly 50 notifications
- **THEN** all 50 SHALL be present in the log
- **AND** none SHALL have been evicted

#### Scenario: The notify log evicts oldest-first past the cap

- **WHEN** a session receives a 51st notification
- **THEN** the log SHALL hold 50 entries
- **AND** the first notification SHALL have been evicted
- **AND** the 51st SHALL be present

#### Scenario: An ended session keeps its notification rows

- **WHEN** a session that received notifications is unregistered
- **AND** a browser subsequently opens that ended session
- **THEN** the notification rows SHALL still render in its transcript

#### Scenario: A retained log does not keep a dead session alive

- **WHEN** an ended session's notify log holds entries
- **THEN** the embed-lifecycle `hasPendingAsk` union SHALL report no pending ask for it
- **AND** the session SHALL be eligible for reclamation

#### Scenario: The notify log survives a server restart

- **WHEN** a session has received notifications
- **AND** the server is restarted
- **THEN** a browser opening that session SHALL still receive them
- **AND** the transcript SHALL match its pre-restart content

### Requirement: A notify does not survive a turn as a blocking indicator

Because a notify creates no pending-prompt entry, the pending-prompt fold SHALL
NOT re-derive `"ask_user"` from it at the end of a turn.

#### Scenario: currentTool clears normally after a notify

- **WHEN** a session receives a `notify`
- **AND** subsequently a `tool_execution_start` naming `bash` followed by a `tool_execution_end`
- **THEN** the session's `currentTool` SHALL be `null` after the end event
- **AND** SHALL NOT be `"ask_user"`

#### Scenario: Notify-only session stays reapable

- **WHEN** a session's only prompt-shaped traffic is one or more notifications
- **THEN** the embed-lifecycle pending-ask union SHALL report no pending ask for it
- **AND** the session SHALL remain eligible for reclamation

### Requirement: Legacy notify-shaped prompt_request is treated as a notify

Because the bridge is published independently of the server, a server SHALL
accept a `prompt_request` whose `prompt.type` is `"notify"` from an older bridge
and SHALL normalize it into the `notify` shape, then handle it exactly as a
`notify`: log it, deliver it to subscribers, and apply none of the pending-prompt
side effects.

The guard SHALL be evaluated after the session ownership check and before
`trackPromptRequest`, because every downstream effect of the defect flows from
that call.

The normalization SHALL read the notification's `level` from
`component.props.level` and map an unrecognized value to `"info"`. An already
published bridge forwards `level` unvalidated, and the new bridge's send-site
normalization cannot retro-fix it.

Because the server normalizes before delivery, a browser SHALL NOT receive a raw
`prompt_request` whose `prompt.type` is `"notify"`; the client therefore needs no
legacy branch.

#### Scenario: Old bridge notify does not create a pending prompt

- **WHEN** a `prompt_request` with `prompt.type: "notify"` arrives for a live session
- **THEN** `hasPendingPromptRequests(sessionId)` SHALL remain unchanged
- **AND** the session's `currentTool` SHALL be unchanged

#### Scenario: Old bridge notify still renders

- **WHEN** a `prompt_request` with `prompt.type: "notify"` arrives for a live session
- **THEN** the message SHALL still be delivered to that session's subscribers

#### Scenario: Old bridge notify is delivered in the normalized shape

- **WHEN** a `prompt_request` with `prompt.type: "notify"` is normalized
- **THEN** subscribers SHALL receive a `notify` message
- **AND** SHALL NOT receive the raw `prompt_request`

#### Scenario: Old bridge unrecognized level is normalized server-side

- **WHEN** a `prompt_request` with `prompt.type: "notify"` carries `component.props.level: "debug"`
- **THEN** the delivered notification SHALL carry `level: "info"`

#### Scenario: Old bridge notify does not re-arm after a turn

- **WHEN** a session receives a `prompt_request` with `prompt.type: "notify"`
- **AND** subsequently a `tool_execution_start` and `tool_execution_end`
- **THEN** the session's `currentTool` SHALL be `null` after the end event

#### Scenario: Genuine prompt_request is unaffected

- **WHEN** a `prompt_request` whose `prompt.type` is any value other than `"notify"` arrives
- **THEN** it SHALL be tracked, folded, unread-stamped, and reordered exactly as before

### Requirement: A notify produces a chat row but never a pending interactive request

The client SHALL render a notification as an `interactiveUi` row in the session's
`messages` list, preserving its position in the transcript, and SHALL NOT add an
entry to the session's `interactiveRequests` list.

The two lists carry different meanings: `messages` is the transcript, while
`interactiveRequests` means "the user is blocked". A notification produces no
`prompt_dismiss`, `prompt_cancel`, or `ui_dismiss`, so an `interactiveRequests`
entry created for it could never be removed.

Because `NotifyRenderer` is reached through the interactive-renderer registry
from an `interactiveUi` row, that registry entry SHALL be retained.

The row SHALL be keyed by `notifyId`, and dedup SHALL be by that key rather than
by message text. Dedup is load-bearing because the notify path bypasses
`addInteractiveRequest`, whose `requestId` dedup is what makes replay on a warm
reconnect idempotent today; without an equivalent guard a replayed notify log
duplicates rows that are already on screen. Dedup by text would instead collapse
distinct notifications that happen to share a message.

Both client reducers SHALL implement this: the main-app handler and the embed
session-state handler are separate switches with separate call sites.

#### Scenario: Notify adds a chat row

- **WHEN** the client receives a `notify` message for a session
- **THEN** an `interactiveUi` row SHALL be appended to that session's `messages`
- **AND** it SHALL render through `NotifyRenderer`

#### Scenario: Notify adds no interactive request

- **WHEN** the client receives a `notify` message for a session
- **THEN** the session's `interactiveRequests` SHALL be unchanged

#### Scenario: Transcript position is preserved

- **WHEN** a notification arrives between two assistant messages
- **THEN** its row SHALL appear between them in the rendered transcript
- **AND** its position SHALL match the pre-change behaviour

#### Scenario: Warm reconnect does not duplicate a delivered notification

- **WHEN** a notification has been delivered live to a subscribed browser
- **AND** that browser reconnects and the notify log is replayed to it
- **THEN** exactly one chat row SHALL exist for that `notifyId`

#### Scenario: Repeated notifications do not accumulate pending state

- **WHEN** a session receives ten notifications over its lifetime
- **THEN** the session's `interactiveRequests` SHALL remain empty
- **AND** the session card SHALL NOT display the "Needs you" indicator

#### Scenario: Both client reducers are covered

- **WHEN** a `notify` is handled by the main-app message handler or by the embed session-state reducer
- **THEN** both SHALL produce a chat row and no `interactiveRequests` entry

#### Scenario: A genuine prompt still creates an interactive request

- **WHEN** the client receives a `prompt_request` whose `prompt.type` is `"select"`
- **THEN** an `interactiveRequests` entry SHALL be added keyed by its `promptId`
