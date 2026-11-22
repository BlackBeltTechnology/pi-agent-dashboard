## MODIFIED Requirements

### Requirement: Init progress and failure render in the tier-0 banner

Init run progress and failure feedback for a directory card SHALL render inside the tier-0 banner, not inline on the git row and not as a wrapping exception beneath it. While Focus mode is on, the card renders only its slim header (the banner is hidden by the built-in profile and the compact chip is suppressed, see `session-card-section-visibility`), so no init feedback renders on the card; the full banner returns when Focus is off or the profile shows `folder-banner`.

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

#### Scenario: Focus mode suppresses card-level init feedback
- **GIVEN** Focus mode is on with `folder-banner` hidden and an init run in flight or failed for a directory
- **WHEN** the card renders
- **THEN** neither the banner nor the compact chip SHALL render for it

#### Scenario: Banner shown in Focus when the profile reveals it
- **GIVEN** Focus mode is on and the focus profile shows `folder-banner`
- **WHEN** an init run is in flight or failed
- **THEN** the progress or failure state SHALL render inside `folder-banner-<kind>-<cwd>`
