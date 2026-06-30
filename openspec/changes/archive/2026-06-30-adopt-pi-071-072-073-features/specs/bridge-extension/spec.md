## ADDED Requirements

### Requirement: Bridge listens to thinking_level_select

The bridge SHALL register a `pi.on("thinking_level_select", ...)` listener (pi 0.71+) and SHALL push a `model_update` message via the existing `sendModelUpdateIfChanged` debouncer whenever the listener fires. The bridge SHALL NOT rely on `model_select` to surface thinking-level changes.

The model-tracker's equality check that gates `model_update` pushes SHALL consider both `model` and `thinkingLevel` — a change in thinkingLevel alone (model unchanged) SHALL still produce a push.

#### Scenario: Thinking level change without model change
- **WHEN** the user changes thinking level from `medium` to `high` (model unchanged)
- **AND** pi emits `thinking_level_select`
- **THEN** the bridge SHALL emit one `model_update` with the existing model and the new thinkingLevel `"high"`

#### Scenario: Repeated event with same level is a no-op
- **WHEN** `thinking_level_select` fires twice with the same value
- **THEN** the bridge SHALL push at most one `model_update` for that value (the second is suppressed by the existing debouncer)

#### Scenario: Pre-0.71 pi (unlikely under 0.73 floor)
- **WHEN** the bridge runs against a pi that does NOT emit `thinking_level_select`
- **THEN** the listener registration SHALL be a no-op and the bridge SHALL still operate (no crash, no error)

### Requirement: Bridge handles stop_after_turn for graceful exit

The bridge SHALL accept a `{ type: "stop_after_turn", sessionId }` message from the server. On receipt, the bridge SHALL set a per-session flag (`shouldStopAfterTurn = true`) and, on the next `pi.events.on("turn_end")` callback while the flag is set, SHALL call `cachedCtx.shutdown()` (graceful) — falling back to `cachedCtx.abort()` only if `shutdown` is unavailable. The flag SHALL be cleared after the shutdown call is initiated. Repeated `stop_after_turn` messages while the flag is already set SHALL be no-ops.

The `turn_end` listener SHALL be wrapped in try/catch — failure SHALL NOT crash the bridge.

#### Scenario: Stop after turn waits for clean boundary
- **WHEN** the bridge receives `stop_after_turn` while pi is mid-stream
- **THEN** the bridge SHALL set the flag and let the current turn complete
- **AND** at the next `turn_end`, SHALL call `cachedCtx.shutdown()`, clearing the flag

#### Scenario: Idempotent flag set
- **WHEN** the bridge receives `stop_after_turn` twice in rapid succession before any `turn_end` fires
- **THEN** the flag SHALL be set once and the second message SHALL be a no-op (no second shutdown)

#### Scenario: Falls back when shutdown unavailable
- **WHEN** `cachedCtx.shutdown` is not a function (e.g. older pi or invalid state)
- **THEN** the bridge SHALL call `cachedCtx.abort()` instead and log a warning, preserving the clean-termination intent at best-effort
