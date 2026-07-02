# lazy-expand-full-fidelity

## Purpose

Trim replay bandwidth for heavy tool results by pre-truncating them to the
display form during replay, while preserving the existing "Show full output"
full-fidelity affordance (provided by change `adopt-pi-071-072-073-features`).

> Reconciliation note: the user-facing "Show full output" feature (truncation
> marker + on-demand fetch by `toolCallId` from the in-memory store) shipped
> independently on `develop` via `adopt-pi-071-072-073-features` while this
> change was in flight. This capability was reconciled to LAYER on that
> mechanism: it adds only the server-side replay-bandwidth optimization and an
> idempotency guard, reusing develop's client render + fetch route verbatim.

## Requirements

### Requirement: Heavy tool results are pre-truncated during replay

The server SHALL pre-truncate a finalized tool result that exceeds the display
line cap to the display form (`«N earlier lines hidden»` marker + last N lines)
during replay, so the full body is not re-shipped on every full replay. The
in-memory store SHALL retain the full result so the "Show full output" route can
still serve it. Results at or below the cap SHALL replay inline unchanged.

#### Scenario: Large tool result replays in truncated display form

- **WHEN** the server replays a finalized `tool_execution_end` whose result
  exceeds the display line cap
- **THEN** the replayed event's `result` SHALL be the truncated display form
  (marker + last N lines)
- **AND** SHALL NOT include the full multi-screen body

#### Scenario: Small tool result replays inline

- **WHEN** the server replays a finalized tool result at or below the cap
- **THEN** the event SHALL be replayed inline with its body unchanged

#### Scenario: Streaming tool result is never pre-truncated

- **WHEN** a tool result is still streaming (not finalized)
- **THEN** it SHALL be delivered inline via the live path, never pre-truncated
  on replay

### Requirement: Display truncation is idempotent on the marker form

The client display-truncation helper SHALL pass a result already in the
truncated display form through unchanged, so the server's pre-truncated replay
renders identically to the live path and the "N earlier lines hidden" count is
never corrupted by a second truncation.

#### Scenario: Re-truncating the marker form is a no-op

- **WHEN** the client truncates a result that already starts with the
  truncation marker
- **THEN** it SHALL return the result unchanged

### Requirement: Full body remains fetchable on expand

Expanding a truncated tool result SHALL fetch the full, untruncated body from
the existing `toolCallId`-keyed route (backed by the in-memory store), unchanged
by this capability.

#### Scenario: Expand reveals full fidelity

- **WHEN** the user expands a truncated tool result
- **THEN** the client SHALL fetch the full body by `toolCallId`
- **AND** SHALL render the untruncated content
