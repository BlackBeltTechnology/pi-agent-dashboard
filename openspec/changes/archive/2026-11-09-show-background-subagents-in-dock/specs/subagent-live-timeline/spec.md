# Spec Delta

## ADDED Requirements

### Requirement: Retry steps SHALL render in the timeline

A timeline entry `{ kind: "retry", attempt, maxAttempts, delayMs, text }` from the producer SHALL render at its streamed position the way the timeline renders a failed step: an error step naming the attempt and budget, the scheduled delay and the provider error. A retry entry SHALL NOT render as an unknown entry.

#### Scenario: Retry step during a run
- **GIVEN** an open inspector for a running subagent
- **WHEN** an entry `{ kind: "retry", attempt: 1, maxAttempts: 18, delayMs: 4000, text: "503 service unavailable" }` arrives
- **THEN** the timeline SHALL show an error step reading `Retry 1/18 in 4s: 503 service unavailable`

#### Scenario: Delay reads like the producer's activity text
- **WHEN** retry entries have `delayMs` 0, 400, 4500, 150000 and 3660000
- **THEN** their steps SHALL read the delays as `0s`, `1s`, `5s`, `2m 30s` and `1h 1m` (positive delays round to whole seconds, at least `1s`)

#### Scenario: Recovered run keeps its retry step
- **GIVEN** a subagent whose timeline holds a retry step
- **WHEN** the retried attempt succeeds and the subagent completes
- **THEN** the retry step SHALL stay in the timeline, before the steps of the retried attempt

#### Scenario: No unknown-entry fallback for retries
- **WHEN** the timeline holds a retry entry
- **THEN** the timeline SHALL NOT show "(unknown entry)" for it

### Requirement: A malformed retry entry SHALL render its valid parts

When a retry entry's field is missing or invalid, its step SHALL read `Retry` followed by only the valid parts: `N/M` when `attempt` and `maxAttempts` are positive integers, `in <delay>` when `delayMs` is a finite number, and `: <error>` when `text` is a non-empty string. It SHALL NOT render as an unknown entry.

#### Scenario: Retry entry with missing fields
- **WHEN** a retry entry carries `delayMs: 4000` and no `attempt`, `maxAttempts` or `text`
- **THEN** its step SHALL read `Retry in 4s`
- **AND** an entry with only `attempt: 2`, `maxAttempts: 18` and `text: ""` SHALL read `Retry 2/18`

### Requirement: A pending retry backoff SHALL show on the activity line

While a retry backoff is pending, the producer's activity text (`retrying (attempt N/M) in <delay>…`) SHALL show where the subagent's activity shows today: the inspector header and the running card.

#### Scenario: Backoff shows on the activity line
- **WHEN** the subagent's details carry activity `retrying (attempt 1/18) in 4s…`
- **THEN** the inspector and the running card SHALL show that activity text
