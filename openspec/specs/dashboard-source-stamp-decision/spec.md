# dashboard-source-stamp-decision Specification

## Purpose

Decide, from a single `session_register`, whether the session's source SHALL be stamped `source: "dashboard"` — and, when stamped, whether the tag SHALL be persisted to the on-disk session sidecar or applied only to in-memory / broadcast state. The decision reconciles a strong restart-survival signal (the bridge advertises it was dashboard-spawned) with a legacy weak signal (a per-cwd FIFO counter of pending dashboard spawns), so that new bridges are trusted unconditionally while old bridges keep correct FIFO accounting without corrupting the sidecar.

## Requirements

### Requirement: Strong dashboard-spawn signal

The system SHALL stamp `source: "dashboard"` unconditionally when the bridge advertises it was dashboard-spawned, and SHALL persist that tag so it survives a dashboard restart, without consuming the legacy FIFO counter.

#### Scenario: Bridge advertises dashboard spawn

- WHEN a register reports the bridge was dashboard-spawned
- THEN the session SHALL be stamped `source: "dashboard"`
- AND the tag SHALL be persisted to the session sidecar
- AND the legacy FIFO counter SHALL NOT be consumed

#### Scenario: Strong signal overrides strict mode and counter state

- WHEN a register reports the bridge was dashboard-spawned
- THEN the session SHALL be stamped and persisted
- AND the outcome SHALL be independent of strict-correlation mode, the pending counter, and whether the session is new

### Requirement: Legacy FIFO fallback

The system SHALL stamp `source: "dashboard"` from the legacy per-cwd FIFO counter only on the first register for a session and only while a pending spawn is counted for that cwd, applying the tag in memory but never persisting it, and consuming one from the counter.

#### Scenario: First register with a pending spawn counted

- WHEN a register does not advertise a dashboard spawn
- AND strict-correlation mode is off
- AND it is the first register for the session
- AND the pending-spawn counter for the cwd is greater than zero
- THEN the session SHALL be stamped `source: "dashboard"`
- AND the legacy FIFO counter SHALL be consumed by one
- AND the tag SHALL NOT be persisted to the sidecar

#### Scenario: Repeat register does not stamp from the counter

- WHEN a register does not advertise a dashboard spawn
- AND strict-correlation mode is off
- AND it is not the first register for the session
- THEN the session SHALL NOT be stamped
- AND the FIFO counter SHALL NOT be consumed
- AND no tag SHALL be persisted

#### Scenario: First register with no pending spawn counted

- WHEN a register does not advertise a dashboard spawn
- AND strict-correlation mode is off
- AND it is the first register for the session
- AND the pending-spawn counter for the cwd is zero
- THEN the session SHALL NOT be stamped
- AND the FIFO counter SHALL NOT be consumed
- AND no tag SHALL be persisted

### Requirement: Strict-correlation suppression

The system SHALL suppress the legacy FIFO fallback entirely when strict-correlation mode is on, so that only the strong dashboard-spawn signal can stamp `source: "dashboard"`.

#### Scenario: Strict mode blocks the legacy fallback

- WHEN strict-correlation mode is on
- AND the register does not advertise a dashboard spawn
- THEN the session SHALL NOT be stamped regardless of the pending counter or whether the session is new
- AND the FIFO counter SHALL NOT be consumed
- AND no tag SHALL be persisted
