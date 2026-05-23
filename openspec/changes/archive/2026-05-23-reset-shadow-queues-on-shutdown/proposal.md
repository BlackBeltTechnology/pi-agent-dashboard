## Why

When a dashboard user shuts down a session with queued steering or follow-up messages, the bridge silently exits without resetting its shadow queues or telling pi to clear its native queues. The browser's last cached `pendingQueues` continues to show stale chips for the few hundred milliseconds before the session leaves the list, and pi's internal queues are at the mercy of `cachedCtx.shutdown()`'s cleanup behavior with no defensive clear.

The current `mid-turn-prompt-queue` spec covers the analogous case for session-change events (new/fork/resume) — "different session — old queue is meaningless" — but the shutdown case is unspecified. Shutdown is the same situation, more so: there is no next session. Queued messages are not meant to "carry over" or "drain through" — the user clicked Shutdown to stop.

## What Changes

- **Bridge (`packages/extension/src/bridge.ts`)** — the `shutdown` extension command (the bridge function pi calls during teardown) gains a pre-step that:
  - calls `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()` defensively (best-effort, swallows errors / missing-API)
  - resets `bridgeSteering` and `bridgeFollowUp` to `[]`
  - emits one final `queue_update { steering: [], followUp: [] }` via the existing `emitQueueUpdate` helper
  - THEN runs the existing `cachedCtx.shutdown()` + `setTimeout(process.exit, 500)`

  The reset SHALL be a no-op when both shadows are already empty (no spurious `queue_update`).

- **Spec delta on `mid-turn-prompt-queue`** — add a new requirement "Session shutdown resets shadow queues" with scenarios mirroring the existing session-change reset rule. This tightens the contract; no other requirements change.

- **Bridge `abort` command (scope expanded mid-implementation, see design)** — mirrors shutdown: defensive `pi.clearSteeringQueue` + `clearFollowUpQueue`, conditional shadow reset + final `queue_update`, THEN existing `cachedCtx.abort()` + retry-tracker calls. User-tested: "Stop" cancelling both queues matches user mental model.

- **Client editor restore on abort (scope expanded mid-implementation)** — `App.tsx` wraps `handleAbort` to merge `pendingQueues.steering` + `pendingQueues.followUp` + current draft into the command-input before dispatching the WS `abort` message. Matches pi-TUI's `restoreQueuedMessagesToEditor` (`interactive-mode.js:3040`). Order: `steering[]` then `followUp[]` (each `\n\n`-joined), then current draft.

- **Out of scope (deliberate)**:
  - Persisting queues across session restarts.
  - Any change to the per-entry drain matcher at `turn_end` / `agent_end`.
  - Any change to the session-change reset semantics.
  - Image-attachment restoration on abort (only text is restored).
  - Restoring queue text on `force_kill` (intentional — force-kill is a nuke, not a graceful stop).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mid-turn-prompt-queue` — adds three new requirements peer-level to "Bridge maintains shadow steering and follow-up queues":
  - **Session shutdown resets shadow queues** — shutdown SHALL reset both arrays to `[]` + emit final `queue_update`, with defensive `pi.clearSteeringQueue` / `clearFollowUpQueue`.
  - **User abort resets shadow queues** — symmetric to shutdown but runs before `cachedCtx.abort()`; preserves the existing `retryTracker.noteAbort` + `usageLimitOrderer.noteRetryEnd` calls after.
  - **Client restores aborted queue text into the command-input draft** — client snapshots `pendingQueues` BEFORE dispatching `abort` and merges `steering[]` + `followUp[]` + current draft into the editor (`\n\n`-joined, empty entries dropped).

## Impact

- **Bridge**: ~20 lines added across two extension commands (`shutdown` + `abort`) in `bridge.ts`. No new dependencies, no new protocol messages, no new event types.
- **Client**: `App.tsx` adds `wrappedHandleAbort` (~20 lines) that snapshots `pendingQueues` + current draft, merges, and dispatches via existing `handleAbort` from `useSessionActions`. Two existing `onAbort={handleAbort}` references updated to use the wrapper.
- **Spec**: three new requirements + ~12 scenarios under `openspec/specs/mid-turn-prompt-queue/spec.md`.
- **Server**: zero changes. The existing `queue_update` forward path covers the final empty broadcast.
- **Tests**: bridge unit test for shutdown-resets-shadow (`bridge-shutdown-reset.test.ts`, 9 tests). Pure model mirrors production code. No client test yet — verified manually.
- **Risk**: extremely low. Additive on teardown / user-initiated cancel paths; failure modes bounded by existing safety nets (`setTimeout(process.exit, 500)` for shutdown, `cachedCtx.abort()` already idempotent).
