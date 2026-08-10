# effective-launch-source-derivation Specification

## Purpose

Derive an effective launch-source label for `/api/health` from the static launch-source label plus two live signals — the active bridge count and the server uptime. The static label alone cannot distinguish a bridge server whose pi session is still live from one whose session has quit; a bridge-spawned server keeps reporting the static `bridge` label forever. The effective label promotes an abandoned bridge server to `bridge-orphaned` so consumers (tray ownership, Doctor advisories) can tell a live-session bridge server from an orphaned one. The static label itself is never mutated.

## Requirements

### Requirement: Orphaned-bridge promotion

The system SHALL report the effective launch source as `bridge-orphaned` when the static label is `bridge`, no bridges are currently connected, and the server has been running longer than the bridge-orphan grace window of 30 seconds.

#### Scenario: Bridge label with no live bridges past the grace window

- **WHEN** the static launch source is `bridge`
- **AND** the active bridge count is `0`
- **AND** the server uptime exceeds 30000 ms
- **THEN** the effective launch source is reported as `bridge-orphaned`

### Requirement: Pass-through of the static label

The system SHALL report the effective launch source identical to the static label in every case where the orphaned-bridge promotion does not apply, and SHALL never mutate the static label. The effective label is one of `electron`, `standalone`, `bridge`, or `bridge-orphaned`.

#### Scenario: Bridge label with at least one live bridge

- **WHEN** the static launch source is `bridge`
- **AND** the active bridge count is greater than `0`
- **THEN** the effective launch source is reported as `bridge`

#### Scenario: Bridge label within the grace window

- **WHEN** the static launch source is `bridge`
- **AND** the active bridge count is `0`
- **AND** the server uptime is at or below 30000 ms
- **THEN** the effective launch source is reported as `bridge`

#### Scenario: Non-bridge static labels

- **WHEN** the static launch source is `electron` or `standalone`
- **THEN** the effective launch source is reported unchanged as that same label regardless of active bridge count or uptime
