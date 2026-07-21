# chat-turn-line-delta-summary Specification

## Purpose

Derive per-turn and per-file line-delta summaries ("what this turn changed") from the Edit/Write tool-call messages already present on the client, deterministically and without any network or LLM call. The counts reflect activity within each turn: a line added then later removed still shows activity in each turn, so these numbers intentionally differ from a git-net roll-up.

## Requirements

### Requirement: Per-tool-call line-delta extraction

The system SHALL compute an `additions`/`deletions` line delta for a single Edit or Write `toolResult` message by inspecting its payload shapes in a fixed precedence order, counting added and removed lines without counting unchanged context lines.

#### Scenario: Write tool counts all content lines as additions

- **WHEN** a `toolResult` message has `toolName` equal to `write` (case-insensitive) and `args.content` is a string
- **THEN** the delta additions SHALL equal the number of lines in `args.content`
- **AND** a trailing newline SHALL NOT count as an extra line
- **AND** the delta deletions SHALL be 0

#### Scenario: Pre-computed unified diff takes precedence for edits

- **WHEN** a `toolResult` message is not a Write and `toolDetails.diff` is a non-empty string
- **THEN** the delta SHALL be computed from that unified diff string
- **AND** lines beginning with `+` SHALL count as additions and lines beginning with `-` SHALL count as deletions
- **AND** file-header lines beginning with `+++` or `---` SHALL be excluded

#### Scenario: Top-level oldText/newText computed via zero-context patch

- **WHEN** `toolDetails.diff` is absent and both `args.oldText` and `args.newText` are strings
- **THEN** the delta SHALL be computed from a zero-context structured patch between `oldText` and `newText`
- **AND** only `+` and `-` hunk lines SHALL be counted, never unchanged context lines
- **AND** identical `oldText` and `newText` SHALL yield `{ additions: 0, deletions: 0 }`

#### Scenario: edits array summed op-by-op

- **WHEN** none of the prior shapes apply and `args.edits` is an array
- **THEN** each op with string `oldText` and `newText` SHALL contribute its zero-context patch delta
- **AND** each op carrying a `lines` array SHALL contribute `lines.length` additions and 0 deletions
- **AND** the op deltas SHALL be summed into a single delta

#### Scenario: No recognizable payload yields empty delta

- **WHEN** an Edit/Write `toolResult` message matches none of the recognized payload shapes
- **THEN** the delta SHALL be `{ additions: 0, deletions: 0 }`

### Requirement: Turn attribution from the flat message list

The system SHALL attribute each Edit/Write `toolResult` to a turn by walking the flat message list in a single pass, since tool events carry no `turnIndex` and only user messages do.

#### Scenario: Stamped user turnIndex sets the current turn

- **WHEN** a message with `role` `user` carries a numeric `turnIndex`
- **THEN** the current turn SHALL be set to that `turnIndex` for subsequent tool events

#### Scenario: Unstamped user message advances the turn

- **WHEN** a `user` message without a numeric `turnIndex` follows a prior user message
- **THEN** the current turn SHALL advance by one

#### Scenario: Only Edit/Write tool results are attributed

- **WHEN** a message has `role` `toolResult` and `toolName` equal to `edit` or `write` (case-insensitive)
- **THEN** its delta SHALL be attributed to the current turn
- **AND** any other message role or non-Edit/Write tool SHALL be ignored for line-delta purposes

#### Scenario: Tool event without a path is skipped

- **WHEN** an attributed Edit/Write `toolResult` has no string `args.path`
- **THEN** that event SHALL contribute nothing to the turn's file deltas

### Requirement: Per-turn multi-file aggregation

The system SHALL aggregate attributed tool deltas into per-turn, per-file summaries with turn totals.

#### Scenario: Repeated edits to one file are summed

- **WHEN** the same `args.path` receives more than one Edit/Write in a single turn
- **THEN** that file's additions and deletions SHALL be the sum of each event's delta

#### Scenario: Multiple files in a turn are listed and totaled

- **WHEN** a turn changes more than one distinct `args.path`
- **THEN** each file SHALL appear once with its summed delta
- **AND** the files SHALL be sorted by path
- **AND** the turn's `totalAdditions` and `totalDeletions` SHALL equal the sum across its files

#### Scenario: Turns with no file changes are omitted

- **WHEN** a turn attributes no Edit/Write events with a path
- **THEN** no summary entry SHALL be produced for that turn

#### Scenario: File first seen via Write is marked added

- **WHEN** a turn holds a file's first-ever event across the message list and that event's tool was `write`
- **THEN** that file's status SHALL be `added`
- **AND** otherwise the file's status SHALL be `modified`

### Requirement: Render-anchor boundary attribution

The system SHALL record, for each turn summary, the id of the user message that starts the following turn so the summary can be anchored at the end of its turn.

#### Scenario: Next user message closes the prior turn

- **WHEN** a new `user` message follows an already-open turn
- **THEN** that turn's `boundaryUserMessageId` SHALL be set to the new user message's `id`

#### Scenario: Last or in-progress turn has no boundary

- **WHEN** a turn is the last turn with no following user message
- **THEN** its `boundaryUserMessageId` SHALL be `null`
