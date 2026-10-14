## MODIFIED Requirements

### Requirement: Debounced automatic check

When `grammar.autoCheck` is `true`, the client SHALL run a check automatically
`grammar.debounceMs` after the last draft change, only when the draft length is at least
`grammar.minChars`. A new draft change SHALL reset the timer and abort any in-flight check.
Auto-check SHALL be skipped while the session is `streaming` and when the draft is a slash
command (`/…`) or a bare `!`/`!!` shell input.

The session status the skip reads is the reconciled composer liveness handed to composer
plugin panels — the server-held session status when the server holds one, else the
event-derived chat status — not the raw event-derived status. A run the
client only knows about through the server therefore also suppresses auto-check.

#### Scenario: Auto-check fires after typing stops
- **WHEN** auto-check is on and the user stops typing for `debounceMs` with a draft ≥
  `minChars`
- **THEN** exactly one check SHALL run for that idle draft

#### Scenario: New keystroke cancels in-flight check
- **WHEN** an auto-check request is in flight and the user types another character
- **THEN** the in-flight request SHALL be aborted and the debounce timer SHALL reset

#### Scenario: Draft too short
- **WHEN** the draft length is below `minChars`
- **THEN** no auto-check SHALL run

#### Scenario: Skipped while streaming
- **WHEN** the session status is `streaming`
- **THEN** auto-check SHALL NOT run

#### Scenario: Skipped while only the server reports the run
- **GIVEN** the event-derived chat status reads `idle` after a reload
- **WHEN** the server-held status for the session is `streaming`
- **THEN** the panel SHALL receive `streaming` and auto-check SHALL NOT run

#### Scenario: Skipped for command / shell drafts
- **WHEN** the draft starts with `/`, `!`, or `!!`
- **THEN** auto-check SHALL NOT run
