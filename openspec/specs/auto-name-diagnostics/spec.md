# auto-name-diagnostics Specification

## Purpose
TBD - created by archiving change fix-auto-naming-reasoning-model. Update Purpose after archive.
## Requirements
### Requirement: Last auto-naming attempt is retained per session within a bound

The server SHALL retain, per session, the LAST auto-naming attempt outcome reported by the bridge, together with its reason, the naming model reference where one exists, and a timestamp. Retention SHALL be in-memory only; no new persisted file or schema is introduced.

Retention SHALL be BOUNDED: the map SHALL NOT grow without limit as sessions accumulate. A session store on the order of thousands of sessions SHALL NOT translate into an unbounded retention map.

The retention bound SHALL be exactly **500** entries.

Eviction SHALL protect `stopped` entries: a non-`stopped` entry SHALL always be evicted before a `stopped` entry. When `stopped` entries ALONE reach the bound, the OLDEST `stopped` entry SHALL be evicted — the bound is absolute and protection is a preference order, not an exemption, so a misconfigured naming model that stops every session cannot grow the map without limit.

Outcome reports are deduplicated on the wire (see the bridge requirement), so routine terminal-state churn does not by itself drive eviction.

#### Scenario: Outcome replaces the previous one

- **WHEN** the bridge reports a second attempt outcome for a session
- **THEN** the server SHALL retain only the most recent outcome for that session

#### Scenario: Retention is bounded

- **WHEN** outcomes have been reported for more sessions than the retention bound
- **THEN** the retained map SHALL NOT exceed the bound
- **AND** eviction SHALL remove the least recently updated entries first

#### Scenario: A stopped outcome is not evicted by routine churn

- **GIVEN** a session whose retained outcome is `stopped`
- **WHEN** other sessions report routine outcomes until the retention bound is reached
- **THEN** the `stopped` entry SHALL be retained in preference to those entries

#### Scenario: Stopped entries alone cannot exceed the bound

- **GIVEN** more sessions in the `stopped` state than the retention bound
- **WHEN** a further `stopped` outcome is reported
- **THEN** the retained map SHALL still NOT exceed the bound
- **AND** the oldest `stopped` entry SHALL be evicted

#### Scenario: No attempt reported

- **GIVEN** a session for which no attempt outcome has been reported
- **WHEN** the diagnostics data is read
- **THEN** that session SHALL report no auto-naming outcome rather than a fabricated one

#### Scenario: Retention does not persist

- **WHEN** the dashboard server restarts
- **THEN** previously retained attempt outcomes MAY be absent
- **AND** no persisted file SHALL have been written to carry them

### Requirement: Auto-naming diagnostics are retrievable, not broadcast-only

The Settings → Diagnostics section SHALL render the retained auto-naming outcome so that a non-terminal wait state is observable without reading the server log.

The data SHALL be retrievable when the diagnostics surface mounts, NOT solely delivered by a live broadcast. A client that mounts after an attempt was reported SHALL still see the retained outcome.

Retrieval SHALL use the existing browser-protocol request/response channel. It SHALL NOT introduce a new REST route, and it SHALL NOT be carried by the global doctor report, which is point-in-time and whole-system while this data is per-session and updated every turn.

The rendering SHALL include the outcome, the reason, and the naming model reference that was used.

#### Scenario: A silent wait state is visible

- **GIVEN** a session whose last attempt outcome is `waiting`
- **WHEN** the operator opens Settings → Diagnostics
- **THEN** the outcome `waiting` and its reason SHALL be shown for that session

#### Scenario: A late-mounting client still sees the outcome

- **GIVEN** an attempt outcome reported before the diagnostics surface was opened
- **WHEN** the operator opens Settings → Diagnostics afterwards
- **THEN** the retained outcome SHALL be shown
- **AND** the surface SHALL NOT depend on having received the live broadcast

#### Scenario: A hard stop is visible with its reason

- **GIVEN** a session whose last attempt outcome is `stopped`
- **WHEN** the operator opens Settings → Diagnostics
- **THEN** the outcome `stopped` SHALL be shown together with the actionable reason and the naming model reference

#### Scenario: Starvation is distinguishable from waiting

- **GIVEN** a session whose last attempt outcome is `starved`
- **WHEN** the operator opens Settings → Diagnostics
- **THEN** the outcome SHALL be presented distinctly from `waiting`
- **AND** SHALL convey that the model was truncated rather than that no topic was found

### Requirement: A hard stop reaches the operator even when the session is unwatched

An `auto_name_error` SHALL be observable to an operator who was not subscribed to that session when it was emitted. Delivery SHALL NOT rely solely on a per-subscriber push that an unwatched session never receives.

#### Scenario: Unwatched session stop is still surfaced

- **GIVEN** a session with no subscribed browser client at the moment naming stops
- **WHEN** the operator later opens the dashboard
- **THEN** the stop SHALL be discoverable through the retained diagnostics outcome
- **AND** SHALL NOT exist only as a `server.log` line

