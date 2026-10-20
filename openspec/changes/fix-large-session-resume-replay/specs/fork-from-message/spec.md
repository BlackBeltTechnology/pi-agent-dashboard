# Spec Delta

## MODIFIED Requirements

### Requirement: Forked session has clean OpenSpec state

OpenSpec activity detection SHALL be skipped during event replay. On every replay exit (`replay_complete`, idle exit, cap exit), `openspecPhase` and `openspecChange` SHALL be explicitly cleared. This prevents stale OpenSpec state from the parent session leaking into forked sessions.

#### Scenario: OpenSpec detection skipped during replay
- **WHEN** replayed events contain `tool_execution_start` events that match OpenSpec activity patterns
- **THEN** the server SHALL NOT update `openspecPhase` or `openspecChange` from those events

#### Scenario: OpenSpec state cleared after replay
- **WHEN** `replay_complete` is received for a session
- **THEN** `openspecPhase` and `openspecChange` SHALL be set to `null`

#### Scenario: OpenSpec state cleared on idle or cap exit
- **WHEN** a replay ends through the idle or cap exit without `replay_complete`
- **THEN** `openspecPhase` and `openspecChange` SHALL be set to `null`
