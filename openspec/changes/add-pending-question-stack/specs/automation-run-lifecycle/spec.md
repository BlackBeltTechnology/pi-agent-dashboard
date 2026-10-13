## ADDED Requirements

### Requirement: Automation run sessions wait indefinitely for answers

Automation run sessions SHALL be spawned with the per-session ask_user timeout
override set to infinite wait (`extensionConfig: { "pi-dashboard": {
askUserPromptTimeoutSeconds: "0" } }`), in addition to every spawn field the run
already carries. A question raised by a run SHALL stay answerable until it is
answered, the run is stopped, or the run is finalized by the stale-run reaper;
because a finalized run terminates its spawned session, the session's questions
SHALL then leave the question stack.

#### Scenario: Run question outlives the global timeout

- **GIVEN** the global ask_user timeout is 300 seconds
- **WHEN** an automation run session asks a question and nobody answers for 10 minutes
- **THEN** the question SHALL still be pending

#### Scenario: Reaped run clears its question

- **WHEN** a run waiting on an unanswered question is finalized by the stale-run reaper
- **THEN** its session SHALL be terminated and the question SHALL leave the question stack
