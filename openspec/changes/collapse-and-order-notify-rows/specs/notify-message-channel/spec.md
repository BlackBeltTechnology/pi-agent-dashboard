# notify-message-channel — delta

## MODIFIED Requirements

### Requirement: Notify has a dedicated protocol message

The pi→server and server→browser protocols SHALL each define a `notify` message
distinct from `prompt_request`:

- `type`: `"notify"`
- `sessionId`: string
- `notifyId`: string (UUID)
- `message`: string
- `level`: optional `"info" | "success" | "warning" | "error"`
- `ts`: optional number — emit time, epoch milliseconds

The `level` union SHALL include `"success"` because `NotifyRenderer` already
renders that level today; adopting a narrower union would silently drop
notifications that currently display. A `level` outside the union SHALL be
normalized to `"info"` at the send site rather than forwarded untyped.

The bridge SHALL set `ts` to its own `Date.now()` when it emits a notify — the same
clock that stamps transcript events. The server SHALL forward a bridge `ts` only
when it is a finite number greater than zero; otherwise (absent, non-numeric,
non-finite, or ≤ 0) the server SHALL stamp its own receipt time. Every notify
entry the server logs, whether received from a bridge, converted from a legacy
`prompt_request`, or created by the server itself, SHALL therefore carry `ts` and be
forwarded with it. Only log entries persisted before `ts` existed replay without
it.

`notifyId` SHALL serve as the stable render key for the resulting chat row and as
the row's dedup key. Dedup SHALL be by `notifyId`, NOT by message text — two
identical notifications are two distinct events and both SHALL be retained as
separate rows in client state. Rendering MAY present adjacent identical rows as a
single collapsed row with a repeat count (see "Adjacent identical notify rows
render collapsed with a repeat count").

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
- **THEN** the session's `messages` SHALL contain two notify rows
- **AND** dedup SHALL NOT merge them by text
- **AND** the rendered transcript SHALL account for both — two rows, or one collapsed row showing a repeat count of 2

#### Scenario: Bridge stamps the emit time

- **WHEN** an extension calls `ctx.ui.notify(message)`
- **THEN** the emitted `notify` SHALL carry a numeric `ts` equal to the bridge's `Date.now()` at emit

#### Scenario: Server keeps a valid bridge ts

- **WHEN** the server receives a `notify` with `ts: 1758650000000`
- **THEN** the log entry and the server→browser `notify` SHALL carry `ts: 1758650000000`

#### Scenario: Server stamps receipt time when ts is missing or invalid

- **WHEN** the server receives a `notify` with no `ts`, or with `ts` equal to `"x"`, `NaN`, `Infinity`, `0`, or `-5`
- **THEN** the log entry and the server→browser `notify` SHALL carry `ts` equal to the server's receipt time

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
Each entry SHALL persist its `ts`, and replay SHALL forward it unchanged. An entry
persisted without `ts` SHALL replay without `ts`.

#### Scenario: Notify survives a browser refresh

- **WHEN** a session receives a notify
- **AND** a browser subsequently subscribes to that session
- **THEN** the subscribing browser SHALL receive the notification
- **AND** the chat row SHALL appear as it did before the refresh, with the same time and in the same place relative to the turns around it
- **AND** it SHALL NOT be moved to the end of the transcript

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
- **THEN** a browser opening that session SHALL still receive them, each with its original `ts`
- **AND** the transcript SHALL match its pre-restart content, including notify row positions

#### Scenario: A legacy entry without ts replays unchanged

- **WHEN** a persisted notify log entry has no `ts`
- **AND** a browser subscribes
- **THEN** the replayed `notify` SHALL carry no `ts`

### Requirement: A notify produces a chat row but never a pending interactive request

The client SHALL render a notification as an `interactiveUi` row in the session's
`messages` list, preserving its position in the transcript, and SHALL NOT add an
entry to the session's `interactiveRequests` list.

When the `notify` carries `ts`, the row's `timestamp` SHALL be `ts`, and its
position SHALL be found by scanning `messages` from the end in array order,
skipping `historyGap` rows. The row SHALL be inserted immediately after the first
row encountered whose `timestamp` is less than or equal to `ts`, so on equal
timestamps the existing row stays first. When no non-`historyGap` row qualifies,
the row SHALL be inserted immediately before the first non-`historyGap` row, which
puts it after a leading divider, or at the start when there is no divider. When
`messages` holds no non-`historyGap` row at all, the row SHALL be appended. When the
`notify` carries no `ts`, the row SHALL be appended with `timestamp` set to the
client's current time, as before.

After a history-backfill segment is spliced into `messages`, every notify row
placed by `ts` SHALL be re-placed by the same rule, in ascending `ts` order, so a
backfilled row older than the notify ends up above it.

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
- **THEN** an `interactiveUi` row SHALL be added to that session's `messages`
- **AND** it SHALL render through `NotifyRenderer`

#### Scenario: Replayed notify is placed chronologically

- **WHEN** a session's `messages` holds rows with timestamps 100, 200, 300
- **AND** the client receives a `notify` with `ts: 250`
- **THEN** the notify row SHALL sit between the rows stamped 200 and 300
- **AND** its `timestamp` SHALL be 250

#### Scenario: Equal timestamp keeps arrival order

- **WHEN** `messages` holds a row stamped 200 and the client receives a `notify` with `ts: 200`
- **THEN** the notify row SHALL be placed after that row

#### Scenario: Notify older than the loaded window

- **WHEN** `messages` starts with a `historyGap` row followed by rows stamped 500 and 600
- **AND** the client receives a `notify` with `ts: 100`
- **THEN** the notify row SHALL be placed directly after the `historyGap` row

#### Scenario: A mid-list divider is never an anchor

- **WHEN** `messages` holds rows stamped 100, 200, then a `historyGap` row stamped 9999, then rows stamped 800, 900
- **AND** the client receives a `notify` with `ts: 300`
- **THEN** the notify row SHALL be placed after the row stamped 200 and before the `historyGap` row

#### Scenario: Backfill re-seats an older notify

- **WHEN** `messages` holds a leading `historyGap`, then a ts-placed notify with `ts: 150`, then rows stamped 500 and 600
- **AND** a history-backfill segment with rows stamped 100 and 200 is spliced after the divider
- **THEN** the notify row SHALL end up between the rows stamped 100 and 200

#### Scenario: Notify without ts appends as before

- **WHEN** the client receives a `notify` with no `ts`
- **THEN** the row SHALL be appended at the end of `messages`
- **AND** its `timestamp` SHALL be the client's current time

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
- **AND** both SHALL place a `ts`-bearing notify by the same chronological rule

#### Scenario: A genuine prompt still creates an interactive request

- **WHEN** the client receives a `prompt_request` whose `prompt.type` is `"select"`
- **THEN** an `interactiveRequests` entry SHALL be added keyed by its `promptId`

## ADDED Requirements

### Requirement: Adjacent identical notify rows render collapsed with a repeat count

The chat view SHALL present a run of two or more consecutive rendered notify rows
that share the same normalized level and byte-identical rendered text as a single
row. The rendered text is `params.message` when it is a string, otherwise
`params.title` when it is a string (the legacy fallback), otherwise empty. A
notify whose rendered text is empty SHALL never join a run, because it renders
nothing that could carry the count. That row SHALL show the repeat count and the time of the first and last
member.

Adjacency SHALL be evaluated over the rows actually rendered, after level gating
(`notifyMinLevel`) and every other visibility filter. A row hidden by those filters
SHALL NOT break a run. Any rendered row that is not a matching notify SHALL break
the run, including a tool group, a message, or a notify with a different level or
text.

The collapse SHALL be presentation-only. The session's `messages` SHALL keep one
row per `notifyId`, and no stored row SHALL be mutated by it. Dedup SHALL remain by
`notifyId`. The virtualizer SHALL count the collapsed list. The collapsed row SHALL keep the
render key of the run's first member, so a run that grows live does not remount.
The repeat count and time range SHALL be exposed as text to assistive technology,
not by colour alone.

A single notify, with no adjacent identical sibling, SHALL render exactly as it
did before this requirement.

#### Scenario: Ten identical warnings render as one row

- **WHEN** ten consecutive rendered notify rows carry level `warning` and the message `Observational memory: observer failed: Observer: all model candidates exhausted`
- **THEN** exactly one notify row SHALL render for them
- **AND** it SHALL show a repeat count of 10
- **AND** it SHALL show the first and last member's time

#### Scenario: Different text breaks the run

- **WHEN** rendered notify rows read A, A, B, A with equal level
- **THEN** three rows SHALL render: A with count 2, B, and A

#### Scenario: Different level breaks the run

- **WHEN** two consecutive rendered notify rows carry identical text, one at `warning` and one at `error`
- **THEN** two rows SHALL render and neither SHALL show a repeat count

#### Scenario: An intervening message breaks the run

- **WHEN** two identical notify rows are separated by a rendered assistant message
- **THEN** both notify rows SHALL render separately

#### Scenario: A hidden row does not break the run

- **WHEN** `notifyMinLevel` is `warnings`
- **AND** the rows read: warning X, info Y, warning X
- **THEN** one row SHALL render for warning X with a repeat count of 2

#### Scenario: Legacy title-only rows with different titles do not collapse

- **WHEN** two consecutive rendered notify rows have no `params.message`, equal level, and `params.title` values `A` and `B`
- **THEN** two rows SHALL render

#### Scenario: Empty-text notifies never collapse

- **WHEN** two consecutive rendered notify rows both have empty rendered text and equal level
- **THEN** neither SHALL be annotated with a repeat count

#### Scenario: The badge text is localized

- **WHEN** the UI language is `hu` or `zh-CN` and a collapsed notify row renders
- **THEN** the repeat badge and its accessible label SHALL come from that language's catalog, not the English fallback

#### Scenario: Collapse does not alter state

- **WHEN** ten identical adjacent notifies are rendered collapsed
- **THEN** the session's `messages` SHALL still contain ten notify rows with distinct `notifyId`s
- **AND** none of those stored rows SHALL carry a repeat annotation

#### Scenario: A growing run keeps its render key

- **WHEN** a collapsed run of 3 identical notifies receives a 4th identical notify live
- **THEN** the collapsed row SHALL keep the first member's render key
- **AND** its count SHALL become 4

#### Scenario: A single notify renders unchanged

- **WHEN** a notify row has no adjacent identical sibling
- **THEN** it SHALL render with no repeat count and no time range
