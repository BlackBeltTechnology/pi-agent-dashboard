## ADDED Requirements

### Requirement: Session shutdown resets shadow queues and clears pi's native queues

When the bridge's `shutdown` extension command is invoked (typically via a browser `shutdown { sessionId }` message routed through the server to pi), the bridge SHALL — before invoking `cachedCtx.shutdown()` and before the `setTimeout(process.exit, 500)` safety net — perform a shadow-queue reset:

1. The bridge SHALL call `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()` defensively (guarded by `typeof === "function"` for pi-version skew and wrapped in `try/catch` so teardown never throws). Both calls SHALL run unconditionally regardless of shadow state — external (non-dashboard) consumers may have mutated pi's queues without the bridge knowing.
2. If either `bridgeSteering` or `bridgeFollowUp` is non-empty, the bridge SHALL reset both arrays to `[]` AND emit one final `queue_update { sessionId, steering: [], followUp: [] }` via the existing `emitQueueUpdate` helper. If both shadows are already empty, the bridge SHALL NOT emit `queue_update` (avoids wire noise on the common path).
3. The bridge SHALL THEN invoke the existing `cachedCtx.shutdown()` call.
4. The existing `setTimeout(() => process.exit(0), 500)` safety net is unchanged.

This mirrors the session-change reset semantics (new / fork / resume): different session — old queue is meaningless. Shutdown is the same situation, more so: there is no next session.

The reset SHALL run BEFORE `cachedCtx.shutdown()` so the bridge is still in a known-good state when the final `queue_update` is emitted; pi's own teardown may fire events the bridge no longer processes after `cachedCtx.shutdown()`.

#### Scenario: Shutdown with non-empty steering queue resets and emits

- **WHEN** `bridgeSteering` is `["focus on X"]` and `bridgeFollowUp` is `[]`
- **AND** the bridge's `shutdown` extension command is invoked
- **THEN** the bridge SHALL call `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()` (best-effort)
- **AND** the bridge SHALL set `bridgeSteering` to `[]`
- **AND** the bridge SHALL emit `queue_update { sessionId, steering: [], followUp: [] }` exactly once
- **AND** the bridge SHALL THEN invoke `cachedCtx.shutdown()`
- **AND** the existing `setTimeout(process.exit, 500)` safety net SHALL fire as before

#### Scenario: Shutdown with non-empty follow-up queue resets and emits

- **WHEN** `bridgeFollowUp` is `["run tests when done"]` and `bridgeSteering` is `[]`
- **AND** the bridge's `shutdown` extension command is invoked
- **THEN** the bridge SHALL call `pi.clearFollowUpQueue()` (best-effort)
- **AND** the bridge SHALL set `bridgeFollowUp` to `[]`
- **AND** the bridge SHALL emit `queue_update { sessionId, steering: [], followUp: [] }` exactly once

#### Scenario: Shutdown with both queues non-empty resets both

- **WHEN** `bridgeSteering` is `["a", "b"]` and `bridgeFollowUp` is `["c"]`
- **AND** the bridge's `shutdown` extension command is invoked
- **THEN** the bridge SHALL call BOTH `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()`
- **AND** the bridge SHALL set both shadow arrays to `[]`
- **AND** the bridge SHALL emit `queue_update { sessionId, steering: [], followUp: [] }` exactly once (not twice)

#### Scenario: Shutdown with both queues empty does NOT emit queue_update

- **WHEN** `bridgeSteering` is `[]` and `bridgeFollowUp` is `[]`
- **AND** the bridge's `shutdown` extension command is invoked
- **THEN** the bridge SHALL still call `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()` defensively (idempotent — pi's queues may be non-empty from non-dashboard sources)
- **AND** the bridge SHALL NOT emit a `queue_update` event
- **AND** the bridge SHALL invoke `cachedCtx.shutdown()` as before

#### Scenario: Pi missing clearSteeringQueue / clearFollowUpQueue is a safe no-op

- **WHEN** the running pi version does not expose `pi.clearSteeringQueue` (or `clearFollowUpQueue`) as a function
- **AND** the bridge's `shutdown` extension command is invoked with non-empty shadows
- **THEN** the bridge SHALL skip the missing call (guarded by `typeof === "function"`)
- **AND** the bridge SHALL still reset the shadow arrays to `[]` and emit the final `queue_update`
- **AND** teardown SHALL proceed to `cachedCtx.shutdown()` without throwing

#### Scenario: pi clear-queue calls throw — teardown continues

- **WHEN** `pi.clearSteeringQueue()` throws an exception during shutdown
- **THEN** the bridge SHALL catch the exception (no re-throw)
- **AND** the bridge SHALL still proceed to reset the shadow arrays
- **AND** the bridge SHALL still emit the final `queue_update`
- **AND** the bridge SHALL still invoke `cachedCtx.shutdown()`

#### Scenario: Reset runs BEFORE cachedCtx.shutdown()

- **WHEN** the bridge's `shutdown` extension command is invoked with non-empty shadows
- **THEN** the order of operations SHALL be: (1) defensive `pi.clearSteeringQueue` / `clearFollowUpQueue`, (2) shadow reset + `emitQueueUpdate`, (3) `cachedCtx.shutdown()`, (4) `setTimeout(process.exit, 500)`
- **AND** the final `queue_update` SHALL be emitted while the bridge connection is still in a known-good state

### Requirement: User abort resets shadow queues and clears pi's native queues

When the bridge's `abort` extension command is invoked (via a browser `abort { sessionId }` message routed through the server to pi), the bridge SHALL — before invoking `cachedCtx.abort()` — perform the same shadow-queue reset used by the shutdown command:

1. The bridge SHALL call `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()` defensively (guarded by `typeof === "function"` and wrapped in `try/catch`). Both run unconditionally.
2. If either `bridgeSteering` or `bridgeFollowUp` is non-empty, the bridge SHALL reset both to `[]` AND emit one final `queue_update { sessionId, steering: [], followUp: [] }`. Empty shadows SHALL NOT emit `queue_update`.
3. The bridge SHALL THEN invoke the existing `cachedCtx.abort()` call.
4. The existing `retryTracker.noteAbort(sessionId)` + `usageLimitOrderer.noteRetryEnd(sessionId)` calls SHALL remain after `cachedCtx.abort()`.

Rationale: user clicked Stop. Mental model is "stop everything" — queued messages must not be delivered after the abort settles. Matches pi-TUI's `restoreQueuedMessagesToEditor({abort: true})` behavior (`pi-coding-agent/dist/modes/interactive/interactive-mode.js:3040`).

#### Scenario: Abort with non-empty steering resets, emits, then calls cachedCtx.abort

- **WHEN** `bridgeSteering` is `["focus on X"]` and `bridgeFollowUp` is `[]`
- **AND** the bridge's `abort` extension command is invoked
- **THEN** the bridge SHALL call `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()` defensively
- **AND** the bridge SHALL set `bridgeSteering` to `[]`
- **AND** the bridge SHALL emit `queue_update { sessionId, steering: [], followUp: [] }` exactly once
- **AND** the bridge SHALL THEN invoke `cachedCtx.abort()`

#### Scenario: Abort with both queues empty does NOT emit queue_update

- **WHEN** `bridgeSteering` is `[]` and `bridgeFollowUp` is `[]`
- **AND** the bridge's `abort` extension command is invoked
- **THEN** the bridge SHALL still call `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()` defensively
- **AND** the bridge SHALL NOT emit `queue_update`
- **AND** the bridge SHALL invoke `cachedCtx.abort()` as before

#### Scenario: Pi missing clear-queue functions — abort still proceeds without throw

- **WHEN** the running pi version does not expose `pi.clearSteeringQueue` as a function
- **AND** the bridge's `abort` extension command is invoked with non-empty shadows
- **THEN** the bridge SHALL skip the missing call (guarded by `typeof === "function"`)
- **AND** the bridge SHALL still reset the shadow arrays and emit the final `queue_update`
- **AND** the bridge SHALL still invoke `cachedCtx.abort()`

### Requirement: Client restores aborted queue text into the command-input draft

When the user clicks **Stop** (dispatches `abort`), the client SHALL — BEFORE sending the WS `abort` message — snapshot the selected session's `pendingQueues` and merge the queued text into the command-input draft. This mirrors pi-TUI's `restoreQueuedMessagesToEditor` so typed messages are not silently lost.

Order of merge SHALL be:

1. Concatenate `pendingQueues.steering[]` then `pendingQueues.followUp[]` (each entry separated by `\n\n`, dropping entries that are empty after `trim()`).
2. Append the current draft text (also dropped if empty after `trim()`), separated from the queued text by `\n\n`.
3. Result: `editor = [queuedJoined, currentDraft].filter(t => t.trim()).join("\n\n")`.

The merge SHALL be a no-op (no draft change) when both queues are empty. Image attachments SHALL NOT be modified — only the text draft is updated.

#### Scenario: Stop with one steer + one followUp + typed draft restores all three

- **WHEN** `pendingQueues.steering` is `["do X"]`
- **AND** `pendingQueues.followUp` is `["then Y"]`
- **AND** the command-input draft is `"extra thought"`
- **AND** the user clicks Stop
- **THEN** the client SHALL set the draft to `"do X\n\nthen Y\n\nextra thought"` BEFORE dispatching the WS `abort` message

#### Scenario: Stop with queues but empty draft restores queued text only

- **WHEN** `pendingQueues.steering` is `["do X"]` and `pendingQueues.followUp` is `[]`
- **AND** the draft is empty (or whitespace-only)
- **AND** the user clicks Stop
- **THEN** the client SHALL set the draft to `"do X"`

#### Scenario: Stop with empty queues leaves draft untouched

- **WHEN** `pendingQueues.steering` is `[]` and `pendingQueues.followUp` is `[]`
- **AND** the draft is `"hello"`
- **AND** the user clicks Stop
- **THEN** the client SHALL NOT modify the draft
- **AND** the WS `abort` message SHALL still be dispatched

#### Scenario: Steer entries come before followUp entries in the merged draft

- **WHEN** `pendingQueues.steering` is `["steerA", "steerB"]`
- **AND** `pendingQueues.followUp` is `["followA"]`
- **AND** the draft is empty
- **AND** the user clicks Stop
- **THEN** the draft SHALL become `"steerA\n\nsteerB\n\nfollowA"`
