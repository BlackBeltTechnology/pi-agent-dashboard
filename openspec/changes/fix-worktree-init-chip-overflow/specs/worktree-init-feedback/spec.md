## ADDED Requirements

### Requirement: Init feedback fits its banner
Worktree-init feedback rendered in a folder action banner (running, done, failed) SHALL stay within the banner's horizontal bounds. Long content SHALL truncate or wrap instead of overflowing.

#### Scenario: Running chip fits a narrow card
- **WHEN** an init run is in flight for a folder whose banner is narrower than the chip's natural width
- **AND** the last log line is longer than the banner
- **THEN** no part of the feedback (status, progress bar, last-line preview, opened log) SHALL extend past the banner's right edge
- **AND** the last-line preview SHALL be truncated with an ellipsis

#### Scenario: Unbroken path in the log wraps
- **WHEN** the opened log contains a single token longer than the banner width (e.g. an absolute file path)
- **THEN** the log SHALL wrap that token within the banner, with no horizontal overflow

#### Scenario: Failure with a long unbroken summary fits
- **WHEN** a run fails with a failure message containing a token longer than the banner width
- **THEN** the failure line SHALL wrap within the banner
- **AND** the Retry action SHALL remain visible inside the banner

### Requirement: Init feedback meets the type floor
Worktree-init feedback text in a folder action banner SHALL be at least 11 px, and at least 12 px inside an interactive element (the log disclosure toggle, the Retry action).

#### Scenario: Interactive text meets the 12 px floor
- **WHEN** the log disclosure toggle or the Retry action renders
- **THEN** its text SHALL be at least 12 px

#### Scenario: Body text meets the 11 px floor
- **WHEN** the elapsed time, last-line preview, failure message line or opened log renders
- **THEN** its text SHALL be at least 11 px

## MODIFIED Requirements

### Requirement: Feedback replaces raw terminal output
Init feedback SHALL present a one-line status (label + elapsed) with the last log line as a
de-emphasised preview (a smaller monospace line in secondary text colour, never `--text-muted`, which fails AA as readable
text); the full log SHALL be opt-in behind a collapsed disclosure, not rendered inline by default.

#### Scenario: Running shows status not a wall of output
- **WHEN** a run is in flight
- **THEN** the client SHALL show a status chip with elapsed time and the last log line
- **AND** the full log SHALL be hidden until the user opens the disclosure

#### Scenario: Success confirmation then collapse
- **WHEN** a run completes successfully
- **THEN** the client SHALL briefly show a success confirmation, then collapse the feedback

#### Scenario: Failure is sticky and retryable
- **WHEN** a run fails
- **THEN** the client SHALL show a plain-language failure summary with a Retry action
- **AND** the failure feedback SHALL NOT auto-dismiss on a timer

### Requirement: Init progress and failure render in the tier-0 banner

Init run progress and failure feedback for a directory card SHALL render inside the tier-0 banner, not inline on the git row and not as a wrapping exception beneath it.

The existing feedback contract is preserved verbatim within the banner: elapsed time plus the last log line as a de-emphasised preview while running (smaller monospace, painted `--text-secondary` per `folder-action-banner`); the full log behind an opt-in collapsed disclosure and never as an inline raw output block; a failure summary in plain language (exit code + short command) with a Retry action and the stderr tail behind the same disclosure; and no auto-dismiss on a timer.

This supersedes the implementation note in `SessionList.tsx` that a wide init state "SHALL wrap to its own line rather than overflow the git row" — that was a banner without a name.

#### Scenario: Running state renders in the banner

- **GIVEN** an init run is in flight for a directory
- **WHEN** the card renders
- **THEN** the progress state SHALL render inside `folder-banner-<kind>-<cwd>`
- **AND** SHALL NOT render inline on the git row

#### Scenario: Failure keeps its retry and opt-in log

- **GIVEN** an init run failed
- **WHEN** the banner renders
- **THEN** it SHALL show a plain-language summary with a Retry action
- **AND** the stderr tail SHALL remain behind an opt-in disclosure
- **AND** the banner SHALL NOT auto-dismiss on a timer

#### Scenario: Success clears the banner

- **GIVEN** an init run succeeds
- **WHEN** init-status is re-fetched and the gate reports no further need
- **THEN** the banner SHALL disappear
