## Why

Issues:
- https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/929 — resume of a large session freezes the UI (full bridge replay, forced wipe, unwindowed `event_replay` flush).
- https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/928 — replay safety timeout leaks replayed history as live events; the OpenSpec "Replace attached proposal?" dialog reopens and stacks on resume.

Both defects sit on the same path: bridge replay on `session_register` → `replayingSessions` → `replay_complete` / 5 s safety timeout in `packages/server/src/event-wiring.ts`. The issues cross-reference each other ("fix first or together"), so one change is used.

Reported root causes (from the issues; diagnosed from code + transcript measurements, not reproduced live — re-verify during planning):

1. **Absolute 5 s safety timeout ends replay mode too early (#928).** A big session (6,531 entries → 15,213 events → 82.5 MB) replays for longer. After the timeout, `replayingSessions.delete(sessionId)` runs. Every later replayed `event_forward` then skips the `!replayingSessions.has(sessionId)` guards. As a result, history is broadcast as live events: it marks sessions unread, bumps `lastActivityAt`, moves cards to the front, runs OpenSpec detection (auto-attach + `rename_session`, or `pendingReplaceProposal`), and opens `ReplaceProposalDialog`. Nothing clears `pendingReplaceProposal`: replayed history has no `agent_end`, and the `replay_complete` cleanup clears only `openspecPhase` / `openspecChange`.
2. **Unwindowed flush (#929 F2).** The `replay_complete` flush and the timeout flush send `eventStore.getEvents(sessionId, 1)` as a single `event_replay` frame of tens of MB. That bypasses the `maxReplayEvents` / tail-only windowing that subscribe uses (`sendEventBatches` in `packages/server/src/browser-handlers/subscription-handler.ts`).
3. **Wipe never skipped after a browse (#929 F3).** `canSkipWipe` requires `msg.eventCount === session.lastEntryCount`. Only a bridge register sets `lastEntryCount`, and cold disk hydration never does. So resuming a session you just viewed always wipes the stored events and re-stores all of them.
4. **Hydration/register race (#929 R, inferred).** An in-flight cold disk load can be stored on top of the bridge replay. `cancelLoad` is only called from the unsubscribe path.

## What Changes

- The replay safety timeout becomes an **idle** timeout. It is re-armed on each replayed `event_forward`, or tied to the register's `eventCount`. It no longer ends replay mode while replay messages are still arriving.
- Every replay exit (`replay_complete` and timeout) also clears `pendingReplaceProposal`.
- The `replay_complete` flush and the timeout flush go through `sendEventBatches(..., maxReplayEvents, replayWindowMode)`. The browser gets the newest window plus `history_window` and backfills older events on scroll.
- Cold hydration records a fingerprint (entry count + leaf entry id). On register, the wipe and re-store are skipped only when the fingerprint matches the bridge's. **Any mismatch falls back to today's full wipe.**
- `session_register` cancels or ignores an in-flight cold hydration for the same session.
- Optional, to decide in design: render `ReplaceProposalDialog` from one place per session, not once per `SessionOpenSpecActions` mount.

## Capabilities

### Modified Capabilities
- `incremental-event-sync` — skip-wipe fingerprint learned from cold hydration too.
- `on-demand-session-replay` / `session-history-backfill` — replay-complete flush is windowed.
- `openspec-detection` — detection stays suppressed for the full bridge replay; replay exit clears `pendingReplaceProposal`.
- (Confirm exact capability names in planning.)

## Non-goals

- Bridge emitting events newest-first. It breaks the seq-reset rule and the passes that need the whole branch (orphan tool-call closing, usage stats, compaction boundaries, replay compaction).
- Making bridge→server replay itself cheaper.

## Discipline Skills

- `performance-optimization` — latency/size budget on resume. Measure the frame size and time-to-interactive before and after on a large transcript.
- `systematic-debugging` — the root causes are inferred, not reproduced live. Reproduce with a fake-timer `event-wiring` test first.
- `node-inspect-debugger` — replay state across WS + timers is opaque at runtime.
- `doubt-driven-review` — the skip-wipe fingerprint can show a different branch than the agent sees, so the mismatch fallback must hold.
- `review-code` — before commit.

## Impact

- `packages/server/src/event-wiring.ts` (replay timeout, `replay_complete` cleanup, flush, `canSkipWipe`).
- `packages/server/src/browser-handlers/subscription-handler.ts` (cold hydration fingerprint, `sendEventBatches` reuse).
- `packages/server/src/browser-gateway.ts` (`cancelLoad` on register).
- Possibly `packages/client` `SessionOpenSpecActions` / `ReplaceProposalDialog` mount point.
- Compatibility: no protocol change expected (`history_window` already exists). Rollback = revert. No persisted-data migration.
