# pending-question-stack Specification

## Purpose
Surface every open agent question in one global stack so questions from sessions the user is not viewing — including hidden and headless sessions — can be understood and answered without opening the chat log.

## Requirements

### Requirement: The question stack lists every open question the user may see

The client SHALL render a global question stack, anchored in the dashboard header
as a pill showing the open-question count that opens a dropdown panel, listing
every pending
prompt (PromptBus prompt request) of every session the current principal is
allowed to see, regardless of whether the session's card or chat is on screen and
regardless of whether the session is hidden, headless, an automation run or a goal
driver. Covered session kinds: board sessions, hidden sessions, headless
sessions, automation run sessions, goal driver sessions. Ended sessions have no
pending prompts and SHALL NOT appear.

Entries SHALL be ordered newest-first. Each entry SHALL show the session label
(and attached change name when present), a question preview of at most 140
characters, the time since it was asked, and an origin marker when the prompt is a
file-access prompt (agent path-gate prompt or its confirmation), a prompt of a
chat-gateway session, or a widget-bar prompt. The pill SHALL
show the total count and SHALL NOT render when there are no open questions. The
panel SHALL show the newest 5 entries followed by a "+N more" row when more exist;
activating that row SHALL expand the panel into a scrollable list no taller than
60% of the viewport height.
Notify-shaped prompt requests (which never enter the pending-prompt registry)
SHALL NOT create entries. Widget-bar prompts SHALL be listed; the existing card
pulse suppression for widget-bar prompts SHALL remain unchanged.

#### Scenario: Questions from a visible and a hidden session

- **GIVEN** a visible session `A` and a hidden automation session `B` each with one pending question
- **WHEN** the stack renders
- **THEN** the pill SHALL show 2 and the panel SHALL list two entries, newest first

#### Scenario: More than five open questions

- **GIVEN** 8 open questions
- **WHEN** the panel opens
- **THEN** it SHALL show the newest 5 entries and a "+3 more" row
- **AND** activating "+3 more" SHALL show all 8 in a list scrollable within 60% of the viewport height

#### Scenario: No open questions

- **WHEN** no visible-to-the-user session has a pending question
- **THEN** the stack SHALL NOT render

#### Scenario: Notify is not a question

- **WHEN** a session emits a notify, including a legacy notify-shaped prompt request
- **THEN** no stack entry SHALL be created, no context snapshot SHALL be taken and no model call SHALL be made

#### Scenario: Removal is immediate on every path

- **GIVEN** a question listed in the stack
- **WHEN** an answer for it is transmitted (chat, dialog, another device, REST), or it is cancelled, timed out, dismissed, dropped on reconnect reconciliation, or its session ends
- **THEN** its entry SHALL disappear from the stack on every connected browser without a debounce delay, within 1 second at the 95th percentile

### Requirement: Questions follow session visibility

Every road that exposes questions — the stack broadcast (filtered per receiving
socket), the list route, the detail route and the answer route — SHALL expose a
question if and only if the caller may see its session on the session list road.
When no ownership resolver is active, every session's questions SHALL be exposed.
When a resolver is active, owner equality SHALL apply per item, so ownerless
sessions (including automation runs not stamped with an owner) SHALL NOT expose
their questions to human principals. The detail and answer routes SHALL respond
`404` for a question the caller may not see.

#### Scenario: Single-user dashboard

- **GIVEN** no ownership resolver is active
- **WHEN** a hidden automation run asks a question
- **THEN** every connected browser SHALL list it

#### Scenario: Other owner's question hidden

- **GIVEN** principal `P1` owns session `S1` with a pending question
- **WHEN** principal `P2` lists questions, reads `S1`'s question, or posts an answer to it
- **THEN** the list SHALL NOT contain it and the detail and answer routes SHALL return `404`
- **AND** `P2`'s browser SHALL NOT receive the entry in the stack broadcast

### Requirement: Activating an entry routes by session visibility

A session is **visible** when it is a board session that is not hidden. Activating
a stack entry for a visible session SHALL select that session (revealing it if
filtered out or inside a collapsed folder), open it, and bring the question into
view: the chat's pending prompt for chat-placed prompts, or the owning slot for a
widget-bar prompt. Activating an entry for a non-visible session SHALL open the
question dialog. The dialog SHALL offer an "Open session" action.

#### Scenario: Visible session navigates

- **GIVEN** an entry for a visible session with a chat-placed prompt
- **WHEN** the user activates the entry
- **THEN** the dashboard SHALL select the session, open its chat and scroll the pending prompt into view
- **AND** no dialog SHALL open

#### Scenario: Visible session with a widget-bar prompt

- **GIVEN** an entry for a visible session whose prompt belongs to a flow's widget-bar slot
- **WHEN** the user activates the entry
- **THEN** the dashboard SHALL select the session and bring the owning slot into view, with no chat focus attempt

#### Scenario: Hidden session opens the dialog

- **GIVEN** an entry for a hidden automation session
- **WHEN** the user activates the entry
- **THEN** a question dialog SHALL open for that question

### Requirement: The question dialog answers in place with context

The question dialog SHALL render the question with the same input affordances as
the inline renderer for its type (confirm, select, multiselect, input, editor,
batch). Above the inputs it SHALL show the brief (labelled "generated" when
generated) and, collapsible, the context snapshot: the last assistant message
before the question, the most recent tool calls (at most 5, one line each), and
the workflow-run summary when the prompt carries workflow-run metadata. A
"Summarize" action SHALL be available whenever the brief is not a generated one;
it requests a generated brief, which replaces the shown brief once ready and is
stored like an automatic one. When an on-demand generation fails or times out,
the dialog SHALL keep the current brief and show an inline error with a Retry
action. Submitting SHALL answer the question; "Later" SHALL
close without answering.

File-access prompts SHALL render read-only in the dialog with an explanation and
a link to the existing access-prompt approval surface; they SHALL NOT be
answerable from the dialog. Prompts of chat-gateway sessions SHALL be answerable
under the same rules as answering them in the dashboard chat.

#### Scenario: Answer from the dialog

- **WHEN** the user selects an option and submits
- **THEN** the answer SHALL be transmitted to the asking session and the question SHALL leave the stack

#### Scenario: Brief still being generated

- **GIVEN** a question whose brief generation is pending
- **WHEN** the dialog opens
- **THEN** the context SHALL be shown expanded with a "summarizing" indicator and the inputs SHALL be usable immediately

#### Scenario: On-demand Summarize fails

- **WHEN** the user activates Summarize and generation times out
- **THEN** the current brief SHALL stay shown with an inline error and a Retry action

#### Scenario: Question answered while the dialog is open

- **WHEN** the question is answered elsewhere while its dialog is open
- **THEN** the dialog SHALL show "already answered" and disable its inputs

#### Scenario: File-access prompt is read-only

- **WHEN** the dialog opens for an agent file-access prompt
- **THEN** no answer inputs SHALL render and a link to the access-prompt approval surface SHALL be shown

### Requirement: Every question carries a stored context snapshot and brief

When a question is first observed, the server SHALL take a best-effort context
snapshot: the last assistant message text of the session before the question (at
most 8 KB), at most 5 most recent tool calls (name and a one-line summary), and
the workflow-run metadata if the prompt carries it. Missing parts SHALL be
recorded as absent with a reason (`none` — never produced, or `evicted` — no
longer retained); the snapshot SHALL NOT be completed retroactively. Values
matching known secret patterns SHALL be redacted before storage or generation.

The brief SHALL be the ask's context message when that message is at least the
configured minimum length (default 240 characters). Otherwise, unless auto-brief
is disabled, the server SHALL generate a brief with the `@fast` model role from
the question, options, context message and snapshot, and store it. A generated
brief SHALL be understandable without the chat log and SHALL state what the agent
was working on, what led to the question, and — for prompt types with options —
what each option leads to. When the snapshot has no assistant text, a generated
brief SHALL be labelled as based on limited context.

`briefStatus` SHALL be one of `provided` (context message used), `pending`,
`ready`, `failed`, `unavailable` (`@fast` does not resolve or generation is
disabled). Generation SHALL be asynchronous, SHALL NOT delay listing or answering,
SHALL run at most once per question automatically (a failure is recorded and not
retried, also across a server restart), and concurrent generations SHALL be
capped. The snapshot, brief and status SHALL be stored durably with the question
and survive a dashboard server restart for as long as the session is present in the
persisted session store and not recorded as ended; they SHALL be deleted when the question leaves the registry or its
session ends, and SHALL NOT be deleted merely because the bridge has not yet
reconnected.

#### Scenario: Short context triggers generation

- **GIVEN** a question "Resume or hand back?" with no context message
- **WHEN** the server observes it
- **THEN** it SHALL generate a brief with `@fast`, store it, and set `briefStatus: ready`
- **AND** later reads SHALL return the stored brief without regenerating

#### Scenario: Sufficient skill-provided context

- **GIVEN** a question whose context message has at least the minimum length
- **THEN** that message SHALL be the brief, `briefStatus` SHALL be `provided` and no model call SHALL be made

#### Scenario: Generation fails and stays failed across restart

- **WHEN** generation fails or times out and the server later restarts while the question is pending
- **THEN** `briefStatus` SHALL be `failed`, the question SHALL stay answerable with its snapshot, and no automatic model call SHALL be made again

#### Scenario: Role does not resolve

- **WHEN** the `@fast` role has no binding
- **THEN** `briefStatus` SHALL be `unavailable` and no model call SHALL be made

#### Scenario: No preceding assistant text

- **WHEN** a question arrives before any assistant text in the session
- **THEN** it SHALL be listed immediately and the snapshot SHALL record the assistant message as absent with reason `none`

#### Scenario: Restart keeps snapshot and brief

- **GIVEN** a pending question with a stored snapshot and generated brief in a headless session that survives a server restart
- **WHEN** the bridge re-sends the prompt after reconnect
- **THEN** the stored snapshot and brief SHALL be reused and no model call SHALL be made

### Requirement: Questions are accessible through a REST API

The server SHALL expose, owner-scoped as above:

- `GET /api/questions` (`observe`) — rows: id, session id, session label, change
  name, preview, prompt type, origin, age, `briefStatus`; no context bodies.
- `GET /api/questions/:id` (`observe`) — full question, options, brief, snapshot,
  `briefStatus`, answerable flag; `404` when unknown, not pending, or not visible
  to the caller.
- `POST /api/questions/:id/answer` (`control`) — body either `{ answer: string }`
  or `{ cancelled: true }`; both or neither → `400`.

Question ids SHALL be opaque, URL-safe, unguessable, and stable for the lifetime
of the pending prompt including across bridge re-sends after reconnect (prompt ids
are unique per prompt, so a repeated prompt id is a re-send of the same prompt).

The `answer` string SHALL use the same encoding the dashboard chat sends for that
prompt type: `confirm` → `"true"`/`"false"`; `select` → one of the options;
`multiselect` → a JSON-encoded array of distinct options (empty array allowed,
distinct from cancel); `input` and `editor` → any string including empty;
`batch` → a JSON-encoded array with one entry per sub-question, each valid for
that sub-question's type. Invalid → `400`, nothing transmitted. REST answers are
text-only: image attachments that the dashboard chat can add to `input` and
`batch` answers are not supported on this road.

At most one user answer SHALL ever be transmitted per question, regardless of
concurrent answers from any road (REST, dashboard chat, dialog, another device).
The claim SHALL be released if transmission fails, so the question can be answered
again. The route SHALL respond with `{ transmitted: boolean }` (not a delivery
guarantee). An answer for a question whose answer was transmitted within the last
10 minutes SHALL return `409` naming that disposition (this window is held in
server memory and does not survive a restart); otherwise an unknown id SHALL
return `404`. Transmitting an answer SHALL remove the entry from the stack at once
while the pending prompt itself stays registered until the session confirms it. Answers to file-access prompts SHALL return `403`. Answers to
prompts of chat-gateway sessions SHALL follow the same authorization as answering
them in the dashboard chat.

#### Scenario: Answer through the API

- **WHEN** a `control`-tier caller posts a valid answer for an open question it may see
- **THEN** the response SHALL be `{ transmitted: true }` and the question SHALL leave the stack

#### Scenario: Concurrent double answer

- **WHEN** two answers for the same question arrive concurrently from the API and the chat
- **THEN** exactly one SHALL be transmitted and the other SHALL be rejected (`409` on the API road)

#### Scenario: Transmission fails

- **GIVEN** the asking session's bridge is disconnected
- **WHEN** an answer is posted
- **THEN** the response SHALL be `{ transmitted: false }`, the question SHALL stay open, and a later answer SHALL be accepted

#### Scenario: Invalid option

- **WHEN** a select answer is not one of the options
- **THEN** the server SHALL return `400` and the question SHALL stay open

#### Scenario: Both answer and cancel

- **WHEN** the body has both `answer` and `cancelled: true`
- **THEN** the server SHALL return `400`

#### Scenario: File-access prompt

- **WHEN** an answer is posted for an agent file-access prompt
- **THEN** the server SHALL return `403` and the prompt SHALL stay pending

#### Scenario: Insufficient tier

- **WHEN** an `observe`-tier caller posts an answer
- **THEN** the server SHALL reject it and the question SHALL stay open

### Requirement: The stack stays usable on small screens

In the dashboard's mobile layout tier the header pill SHALL remain, activating it
SHALL open the list as a bottom sheet, and question dialogs SHALL render
full-screen. Neither the panel nor the sheet SHALL cover the chat composer while
closed, and touch targets SHALL be at least 44 by 44 CSS pixels.

#### Scenario: Mobile badge

- **WHEN** the mobile layout tier is active and two questions are open
- **THEN** the header pill SHALL show 2 and activating it SHALL open a bottom sheet listing both
