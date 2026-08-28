## ADDED Requirements

### Requirement: Ordered per-session greeting retention and on-connect replay

The server SHALL retain greeting-type `ib_domain_event` frames as a **per-session,
insertion-ordered stream** — not collapsed to a latest-per-key entry — and SHALL
replay that stream, in the order the greetings were emitted, to a browser **on
connect**, each replayed frame marked with an additive `replay: true` field. This
guarantees a client that mounts or reconnects after greetings were emitted receives
the full chronological greeting stream, so the greeting stream survives as long as
the session's chat does.

Each greeting frame SHALL carry a stable identifier and an ordering key so a
consumer can position it chronologically and apply it idempotently across
re-replay. The retained greeting stream SHALL be bounded per session to protect
server memory; when the bound is exceeded the oldest greeting in that session SHALL
be dropped first. A dropped browser connection SHALL NOT corrupt the retained
greeting stream, and session death SHALL clear that session's retained greetings.

#### Scenario: Full greeting stream replays in order on connect

- **WHEN** a session emits greetings for `partner_pending`, then
  `pending_approval`, then `exported`, before a browser connects
- **THEN** the connecting browser SHALL receive all three greeting frames marked
  `replay: true`
- **AND** they SHALL arrive in the order the greetings were emitted
- **AND** the stream SHALL NOT be collapsed to only the newest (`exported`) frame

#### Scenario: Reconnecting mid-session preserves earlier greetings

- **WHEN** a browser that has been subscribed for a while disconnects and
  reconnects
- **THEN** it SHALL be replayed the session's full ordered greeting stream marked
  `replay: true`
- **AND** it SHALL then receive subsequently-emitted greetings as live frames

#### Scenario: Live greeting is not marked replay

- **WHEN** the server broadcasts a newly-emitted greeting to connected browsers
- **THEN** the frame SHALL NOT carry `replay: true` (the field is absent)

#### Scenario: Session death clears retained greetings

- **WHEN** a session ends
- **THEN** the server SHALL clear that session's retained greeting stream
- **AND** a later connect SHALL NOT replay greetings from the ended session

### Requirement: Greeting frames fold into chronological chat rows

The chat reducer SHALL fold greeting `ib_domain_event` frames — both live and
replayed — into chat rows, positioned chronologically relative to ordinary
assistant and user rows. The folding SHALL be idempotent across re-replay by the
greeting's stable identifier, so a greeting delivered both as a replay frame and as
a live frame (or replayed more than once) renders exactly one row. A greeting whose
frame is marked `replay: true` and a subsequently-delivered live copy of the same
greeting SHALL NOT produce two rows.

#### Scenario: Greeting renders as a chat row in chronological order

- **WHEN** the reducer receives a greeting frame between two ordinary chat rows in
  emission order
- **THEN** it SHALL produce exactly one greeting chat row
- **AND** that row SHALL be ordered between the surrounding assistant/user rows
  according to the greeting's ordering key

#### Scenario: Idempotent across live and replay delivery

- **WHEN** the same greeting is delivered as a `replay: true` frame and again as a
  live frame
- **THEN** the reducer SHALL render exactly one row for that greeting

### Requirement: Greeting state survives the fold onto the chat row

The chat reducer's fold of a greeting frame into a chat row SHALL carry the
greeting's structured `state` onto the resulting chat message as an additive,
optional field (in the idiom of the existing optional chat-message fields). The
`state` SHALL NOT be embedded in, or scraped from, the rendered message content —
it SHALL travel as a structured field so a consumer reads it directly. A greeting
chat row SHALL retain its `state` across re-replay and live re-delivery of the same
greeting.

#### Scenario: Folded greeting message carries the structured state

- **WHEN** the reducer folds a greeting frame whose structured `state` is
  `exported` into a chat row
- **THEN** the resulting chat message SHALL carry `state` equal to `exported` as a
  structured field
- **AND** the `state` SHALL NOT be derived by parsing the message content

#### Scenario: State is preserved across idempotent re-fold

- **WHEN** the same greeting is folded again (replay then live, or replayed twice)
- **THEN** the single chat row for that greeting SHALL still carry its structured
  `state`

### Requirement: Greeting row exposes a queryable state marker

A greeting chat row SHALL expose its structured `state` as a row-level DOM
attribute `data-greeting-marker="<state>"`, derived from the structured field —
not from message content and not from an HTML comment (rendered HTML comments are
dropped and carry no DOM node). The attribute SHALL be present ONLY on greeting
rows: ordinary assistant and user rows SHALL render byte-identical output with no
such attribute. The marker SHALL be emitted by a greeting-specific branch/wrapper
in the chat view, leaving the shared message-bubble renderer used by every
assistant row unmodified.

#### Scenario: Greeting row carries the state marker attribute

- **WHEN** a greeting whose structured `state` is `pending_approval` renders as a
  chat row
- **THEN** the row SHALL expose `data-greeting-marker="pending_approval"` as a
  queryable DOM attribute

#### Scenario: Non-greeting rows are unaffected

- **WHEN** an ordinary assistant or user message renders
- **THEN** the row SHALL NOT carry a `data-greeting-marker` attribute
- **AND** the shared message-bubble renderer SHALL be unchanged from its
  pre-change output for that row

### Requirement: Producer-authored glyph renders as raw inline HTML

Greeting content MAY carry a producer-authored per-state glyph as raw inline HTML
(e.g. `<svg><path/></svg>`), and this repo's markdown renderer SHALL render that
raw HTML as real DOM rather than escaping or stripping it. This is a deliberate
property of the design: server-authored greeting content is rendered as raw HTML.
The raw-HTML rendering path (the markdown renderer configured with raw-HTML
pass-through and NO HTML sanitizer) SHALL be pinned by a test, so that adding an
HTML sanitizer later fails that test loudly instead of silently stripping every
greeting glyph.

#### Scenario: Raw inline SVG glyph in greeting content renders as DOM

- **WHEN** greeting content contains a raw inline `<svg><path/></svg>` glyph
- **THEN** the rendered chat row SHALL contain a real `<svg>` (and its `<path>`)
  DOM node
- **AND** the glyph SHALL NOT be escaped to text or stripped

#### Scenario: Raw-HTML contract is pinned against silent sanitization

- **WHEN** an HTML sanitizer is introduced into the markdown render pipeline that
  would strip producer-authored raw HTML
- **THEN** the pinning test SHALL fail

### Requirement: Transcript greeting copy remains non-rendered

The `display:false` custom-message copy of a greeting persisted to the transcript
for model context SHALL continue to render nowhere. Introducing the greeting stream
SHALL NOT cause the transcript's `display:false` copy to render, and SHALL NOT
double-render a greeting that is both persisted (as `display:false`) and delivered
as a domain-event frame.

#### Scenario: display:false transcript copy does not render

- **WHEN** the chat reducer or the replay path processes a `display:false`
  custom-message greeting entry from the transcript
- **THEN** it SHALL NOT produce a chat row for that entry

#### Scenario: No double render between transcript copy and domain-event frame

- **WHEN** a greeting exists both as a `display:false` transcript entry and as a
  greeting domain-event frame
- **THEN** exactly one greeting chat row SHALL render, sourced from the
  domain-event frame
