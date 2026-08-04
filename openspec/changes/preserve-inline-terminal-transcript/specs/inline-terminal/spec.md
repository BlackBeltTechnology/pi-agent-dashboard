## MODIFIED Requirements

### Requirement: Inline terminal lifecycle events

The event system SHALL support `inline_terminal_open` and `inline_terminal_close` events so inline terminal cards are reconstructed on reload via event replay.

`inline_terminal_open` data SHALL contain:
- `terminalId` (string): the ephemeral PTY's terminal id.

`inline_terminal_close` data SHALL contain:
- `terminalId` (string): the closed terminal's id.
- `transcript` (string): the captured final scrollback transcript, size-bounded per the transcript-bound requirement below.

The `inline_terminal_close` event's `data` SHALL always be small enough to survive the event store's per-event serialized-size ceiling intact. The event store replaces over-ceiling `data` with a truncation placeholder that discards every field including `terminalId`; an `inline_terminal_close` event that loses `terminalId` is unmatchable by the client reducer and SHALL NOT be producible.

Inline terminal lifecycle events SHALL be treated as essential and SHALL NOT be discarded by per-session event trimming. The two events are structurally paired and position-bearing: discarding an `inline_terminal_open` while retaining its `inline_terminal_close` causes replay to reconstruct the card at the end of the stream instead of its original position.

The live path and the replay path SHALL consume identical event payloads. Handlers SHALL broadcast the event as stored, after insertion, rather than the pre-insertion value, so that any truncation applied by the store is reflected in both paths.

#### Scenario: Open event fixes card position
- **WHEN** an inline terminal is opened
- **THEN** an `inline_terminal_open` event SHALL be stored and forwarded
- **THEN** on reload, replay SHALL reconstruct a card at the same position in the chat stream

#### Scenario: Trimming under pressure preserves the open/close pair
- **WHEN** a session accumulates enough events to trigger per-session trimming
- **AND** the session contains an inline terminal `open`/`close` pair older than the trim point
- **THEN** neither event SHALL be discarded
- **AND** replay SHALL reconstruct the card at its original position

#### Scenario: Live and replay payloads are identical
- **WHEN** an inline terminal lifecycle event is emitted
- **THEN** the payload broadcast to connected clients SHALL be the payload as stored
- **AND** a client that reloads SHALL reduce to the same card state as a client that stayed connected

#### Scenario: Close event freezes transcript
- **WHEN** the user closes a live inline terminal card that received user input
- **THEN** the PTY SHALL receive SIGTERM
- **THEN** an `inline_terminal_close` event SHALL be emitted carrying the captured transcript
- **THEN** the card SHALL render as a read-only scrollable transcript

#### Scenario: Close event survives the event-store size ceiling
- **WHEN** an inline terminal accumulates scrollback far exceeding the event store's per-event serialized-size ceiling
- **AND** the user closes the card
- **THEN** the stored `inline_terminal_close` event's `data.terminalId` SHALL be present and unmodified
- **AND** `data.transcript` SHALL be present and non-empty
- **AND** the event's `data` SHALL NOT be replaced by a truncation placeholder

### Requirement: Inline terminal reattach on reload

A live inline terminal whose PTY is still alive SHALL reattach on reload via its `terminalId`, replaying the PTY ring buffer. A live inline terminal whose PTY is no longer alive SHALL render a best-effort transcript or a disconnected notice.

#### Scenario: Reattach live PTY
- **WHEN** the page reloads while an inline terminal is live and its PTY is alive
- **THEN** replay SHALL see `inline_terminal_open` with no matching `inline_terminal_close`
- **THEN** the card SHALL reconnect to `/ws/terminal/:id` and replay the ring buffer

#### Scenario: Closed terminal renders frozen
- **WHEN** the page reloads after an inline terminal was closed with a non-empty transcript
- **THEN** replay SHALL see both `inline_terminal_open` and `inline_terminal_close`
- **THEN** the card SHALL render the stored transcript read-only

## ADDED Requirements

### Requirement: Transcript survives PTY exit

The transcript of an inline terminal SHALL remain retrievable after its PTY process has exited, until the corresponding card is closed. A shell that exits on its own (for example the user typing `exit`) SHALL NOT cause the transcript to be lost.

The terminal manager SHALL retain a bounded, size-capped copy of the final scrollback when a PTY dies — on both the normal exit path and the kill-fallback path — and SHALL serve that copy from its transcript accessor once the live entry is gone. Retention SHALL NOT alter the existing removal semantics of a dead terminal: it SHALL still disappear from the terminal list, SHALL still fail to accept new attachments, and SHALL still trigger the terminal-removed broadcast.

Retention SHALL apply only to ephemeral terminals. Non-ephemeral tab terminals SHALL NOT consume retention capacity, since no consumer reads their transcripts and their churn would evict the inline entries this retention exists to preserve.

Retained transcripts SHALL be bounded in count and released when their card is closed, whether the release is requested before or after the PTY dies. Release SHALL be order-independent: a release requested while the PTY is still alive SHALL suppress the later retention write rather than racing it, and the suppression SHALL persist so that a terminal with more than one exit path cannot re-create a retained transcript after its card was closed. Suppression records SHALL be bounded by age rather than by count, with a lifetime that exceeds the slowest terminal-exit fallback by a wide margin, so that reclaiming them can never defeat the suppression they exist to provide. If a retained transcript has been evicted before its card is closed, the close SHALL proceed with an empty transcript rather than failing.

Closing an inline terminal SHALL be idempotent. A repeated close for a terminal that has already been closed SHALL NOT emit a second `inline_terminal_close` carrying an empty transcript, and SHALL NOT cause an already-frozen card to be removed. Idempotency SHALL be decided by the already-closed condition alone, evaluated before any liveness or retention lookup, so that a concurrent second close arriving while the process is still terminating is also suppressed. A close for an unknown terminal SHALL emit nothing.

#### Scenario: Exit then close preserves the transcript
- **WHEN** a user runs commands in an inline terminal and then types `exit`
- **AND** the user subsequently closes the card
- **THEN** the emitted `inline_terminal_close` SHALL carry the scrollback produced before the exit
- **AND** the card SHALL render that transcript read-only

#### Scenario: Dead terminal removal semantics unchanged
- **WHEN** a PTY exits
- **THEN** the terminal SHALL NOT appear in the terminal list
- **AND** an attach attempt for that terminal SHALL fail
- **AND** the terminal-removed broadcast SHALL fire exactly as before

#### Scenario: Retention is bounded
- **WHEN** more dead ephemeral terminals accumulate retained transcripts than the retention count bound allows
- **THEN** the oldest retained transcripts SHALL be evicted
- **AND** closing a card whose transcript was evicted SHALL emit an `inline_terminal_close` with an empty transcript rather than erroring

#### Scenario: Non-ephemeral terminals do not consume retention capacity
- **WHEN** many non-ephemeral tab terminals are spawned and exit
- **THEN** no retained transcript SHALL be created for them
- **AND** a previously retained ephemeral transcript SHALL still be retrievable

#### Scenario: Closing a live card leaves no retained transcript
- **WHEN** the user closes an inline terminal card whose PTY is still alive
- **THEN** the transcript SHALL be read from the live terminal
- **AND** after the PTY subsequently exits, no retained transcript SHALL remain for that terminal

#### Scenario: A second exit path cannot resurrect a released transcript
- **WHEN** a terminal is killed and its fallback cleanup path completes
- **AND** the card is then closed
- **AND** the underlying process's real exit notification arrives afterwards
- **THEN** no retained transcript SHALL exist for that terminal

#### Scenario: Double close does not destroy a frozen card
- **WHEN** the user triggers close twice for the same inline terminal
- **THEN** the second close SHALL NOT emit an `inline_terminal_close` with an empty transcript
- **AND** the card frozen by the first close SHALL retain its transcript, live and on replay

#### Scenario: Concurrent close from a second browser is suppressed
- **WHEN** two browsers are subscribed to the same session and both close the same inline terminal card
- **AND** the second close arrives while the terminal process is still terminating
- **THEN** exactly one `inline_terminal_close` SHALL be emitted
- **AND** the transcript rendered live SHALL match the transcript rendered on replay

#### Scenario: Close for an unknown terminal emits nothing
- **WHEN** a close arrives for a terminal id that never existed
- **THEN** no `inline_terminal_close` SHALL be stored or broadcast

### Requirement: Transcript size bound

A transcript carried by `inline_terminal_close` SHALL be capped to a budget derived from the event store's per-event serialized-size ceiling in force at runtime. The budget SHALL NOT be an independent constant that merely happens to be smaller than the default ceiling: the ceiling is a constructor parameter, so an unlinked literal would silently stop protecting `terminalId` if that parameter were ever configured.

The system SHALL validate the truncation configuration at startup and fail loudly when the combination cannot guarantee `terminalId` survival. Validation SHALL cover both truncation controls, not only the serialized-size ceiling: a per-field string cap measured in string length can re-expand past a byte-measured ceiling under escape-heavy content, at a worst case of six serialized bytes per code unit. Startup SHALL fail when a non-zero per-field cap multiplied by that worst-case factor reaches the serialized-size ceiling. When the serialized-size ceiling is disabled, the budget SHALL fall back to the default rather than collapsing to zero.

The budget SHALL be measured in **serialized JSON bytes**, using the same accounting the event store applies when enforcing its ceiling — not in string length. A length-based cap does not bound the serialized size: multi-byte characters and escaped control characters expand on serialization (roughly 3× for CJK, 4× for emoji, up to 6× per escape character in colorized output), so a length-capped transcript can still exceed the ceiling and trigger the placeholder that destroys `terminalId`.

When the scrollback exceeds the budget, the **tail** SHALL be retained and the head elided, with a visible marker indicating that content was hidden. The marker SHALL be counted within the budget. The same cap SHALL be applied both to the retained post-exit copy and to the value emitted at close time, so the two cannot diverge.

#### Scenario: Oversized scrollback keeps the tail
- **WHEN** an inline terminal's scrollback exceeds the transcript budget
- **AND** the card is closed
- **THEN** the emitted transcript SHALL end with the most recent scrollback content
- **AND** SHALL begin with an elision marker reporting the number of hidden characters
- **AND** its serialized size including the marker SHALL NOT exceed the budget

#### Scenario: Startup rejects an unsafe truncation configuration
- **WHEN** the server starts with a non-zero per-field string cap whose worst-case serialized expansion reaches the per-event size ceiling
- **THEN** startup SHALL fail with a diagnostic naming both values

#### Scenario: Disabled size ceiling does not collapse the budget
- **WHEN** the server starts with the per-event serialized-size ceiling disabled
- **THEN** the transcript budget SHALL be the default-derived value
- **AND** SHALL NOT be zero

#### Scenario: Multi-byte scrollback is bounded by serialized size
- **WHEN** an inline terminal's scrollback consists of multi-byte characters and ANSI escape sequences whose serialized size exceeds the budget while its string length does not
- **AND** the card is closed
- **THEN** the emitted transcript's serialized size SHALL NOT exceed the budget
- **AND** the stored event SHALL retain `data.terminalId`

#### Scenario: Under-budget scrollback is verbatim
- **WHEN** an inline terminal's scrollback is within the transcript budget
- **AND** the card is closed
- **THEN** the emitted transcript SHALL be the scrollback verbatim with no elision marker

### Requirement: Close-to-frozen latency

Closing an inline terminal card SHALL result in a frozen, read-only card within a bounded time, measured end to end from the user's close action to the rendered frozen transcript.

#### Scenario: Close renders frozen within budget
- **WHEN** a user closes an inline terminal card holding a full scrollback buffer
- **THEN** the frozen read-only card SHALL be rendered with p95 under 500 ms

### Requirement: Untouched terminal cards are removed

A closed inline terminal that the user never interacted with SHALL leave no card in the chat stream. The row SHALL be removed rather than frozen, both when the close arrives live and when it is reconstructed from event replay.

Interaction SHALL be determined by tracking whether the terminal ever received user input, NOT by inspecting the rendered transcript text. When a terminal received no input, the emitted transcript SHALL be empty.

The client SHALL remove the card when, and only when, the transcript is the empty string. The client SHALL NOT inspect transcript text to decide removal — no line counting, no whitespace analysis, no ANSI stripping. Text-inspection rules are prohibited for two reasons: they disagree with the input-tracking predicate in the harmful direction (input consisting only of cursor keys yields a transcript that strips to nothing, deleting a card the user did interact with), and a line-count variant additionally inverts whenever the control-character strip removes line separators. Concentrating the decision in the server's input tracking makes the live path and the replay path agree by construction, because there is only one predicate.

#### Scenario: Open and close without typing leaves no card
- **WHEN** the user opens an inline terminal and closes it without typing anything
- **THEN** the emitted transcript SHALL be empty
- **AND** the inline terminal card SHALL be removed from the chat stream
- **AND** no "terminal closed" placeholder SHALL remain

#### Scenario: Multi-line shell prompt does not defeat removal
- **WHEN** the shell renders a prompt spanning several lines
- **AND** the user opens an inline terminal and closes it without typing anything
- **THEN** the inline terminal card SHALL be removed from the chat stream

#### Scenario: A single-line interaction is preserved
- **WHEN** the user types only `exit` in an inline terminal and then closes the card
- **THEN** the card SHALL freeze to a read-only transcript
- **AND** SHALL NOT be removed

#### Scenario: Non-printing input is treated as interaction
- **WHEN** the user sends only non-printing input such as arrow keys or Tab, and then closes the card
- **THEN** the terminal SHALL be treated as interacted-with
- **AND** the emitted transcript SHALL NOT be empty
- **AND** the card SHALL NOT be removed

#### Scenario: A resize control message is not interaction
- **WHEN** an inline terminal receives only a resize control message and no user keystrokes
- **AND** the card is closed
- **THEN** the terminal SHALL be treated as never interacted with
- **AND** the card SHALL be removed

#### Scenario: Empty close is also suppressed on replay
- **WHEN** the page reloads after an `inline_terminal_open` followed by an `inline_terminal_close` with an empty transcript
- **THEN** replay SHALL produce no inline terminal card at that position

#### Scenario: Non-empty transcript is preserved
- **WHEN** the user runs at least one command in an inline terminal and then closes it
- **THEN** the card SHALL freeze to a read-only transcript
- **AND** SHALL NOT be removed

#### Scenario: Close without a matching open and empty transcript adds nothing
- **WHEN** an `inline_terminal_close` with an empty transcript is processed with no matching `inline_terminal_open` in the reduced state
- **THEN** no inline terminal card SHALL be appended
