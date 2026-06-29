## ADDED Requirements

### Requirement: Shared flow-edge derivation

The flows plugin SHALL provide one pure edge-derivation function that maps a flow's steps to a canonical edge set, consumed by BOTH the live `FlowGraph` and the static `flow_write` Mermaid snapshot. Given a minimal step shape (`id`, `type`, `blockedBy`, optional `branches`, optional `onComplete`, optional `onError`) plus declared step order, it SHALL return a typed edge list where each edge carries `from`, `to`, optional `label`, a `kind` of `sequential` | `branch` | `route` | `implicit`, and a `backward` flag. Both renderers SHALL derive their edges from this function rather than from independent rules. The function derives only the edge classes its input carries: the live caller passes `branches` (but no `onComplete`/`onError`, which pi-flows omits from `flow:flow-started`), so `route` edges appear only in the static caller's output.

#### Scenario: Same inputs yield the same edge set
- **WHEN** the derivation runs over two step lists carrying identical `blockedBy` + `branches` data
- **THEN** it SHALL produce the same set of `{from, to}` edges (modulo renderer-specific styling)
- **AND** any `route` edges SHALL appear only when the input carries `onComplete`/`onError`

#### Scenario: Four edge classes derived
- **WHEN** a flow has `blockedBy` deps, decision `branches`, an `on_complete`/`on_error` route, and a step after a separator (`fork` / `agent-decision` / `code-decision`) with no `blockedBy`
- **THEN** the edge list SHALL include a `sequential`, a `branch`, a `route`, and an `implicit` edge respectively
- **AND** the separator set SHALL NOT include `flow-ref`

#### Scenario: Backward edge flagged
- **WHEN** a decision branch (or routing) targets a step declared earlier than its source
- **THEN** that edge SHALL have `backward: true`

#### Scenario: Duplicate edges collapse
- **WHEN** a decision branch target also appears in the same step's `blockedBy` (or an `on_complete` equals an existing sequential edge)
- **THEN** the derivation SHALL emit a single edge, preferring the labeled branch/route classification over the plain sequential one
