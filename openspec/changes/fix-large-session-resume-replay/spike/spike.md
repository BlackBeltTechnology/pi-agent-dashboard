# Spike — fix-large-session-resume-replay

Real-server vitest repro: `spike-large-resume-replay.test.ts` (move to
`packages/server/src/__tests__/` to run; `HOME=$(mktemp -d) npx vitest run … --silent=false --reporter=verbose`).
Prototype of the idle timeout: `idle-timeout-prototype.diff` (reverted from tree).

## Root causes — reproduced on develop (baseline)

| # | Scenario | Result |
|---|---|---|
| S1b | register → replay streams ~5.9 s (event every 450 ms) → historical `Write openspec/changes/change-b/…` | `pendingReplaceProposal = "change-b"` + broadcast; survives `replay_complete`. #928 confirmed. |
| S1 | same, but a 5.3 s silent gap | leaks too (expected — real silence; an idle timeout also exits here) |
| S2 | **new**: register, `replay_complete`, re-register at t=4 s, historical Write at t=5.3 s | leaks. First register's un-cleared 5 s timer ends the SECOND register's replay after 1.3 s. Each register arms a fresh `setTimeout`; none is ever cleared (`event-wiring.ts` register block). |
| S3 | 3,000 replayed events, `maxReplayEvents` default 2,000 | `replay_complete` flush = 1 `event_replay` frame, 3,000 events, 466 KB, 0 `history_window`. #929 F2 confirmed. Scales to ~82 MB at 15 k events. |
| S4 | ended session, browser subscribe → cold hydration (12 events) → register `eventCount: 6` (= branch length) | `lastEntryCount` still undefined after hydration; register wipes (1 `session_state_reset`, store → 0). #929 F3 confirmed. |
| S5 | subscribe a 20,000-entry transcript, register + 50 replayed events + `replay_complete` while the load is in flight | store = 20,050 → hydration inserted on top of the bridge replay (real bridge re-sends all 20 k → ~2× transcript). #929 R confirmed, no longer "inferred". |

## Prototype — idle timeout (S1b, S2 flip)

Per-session timer map; re-armed on every `event_forward` while replaying;
cleared on `replay_complete` and on each new register; 120 s hard cap.
- S1b: `pendingReplaceProposal` stays unset. S2: unset.
- Regression: 77 server test files touching `replay_complete` / `session_register` — 727 passed, 0 failed.

## Validation findings (proposal corrections)

1. **Wrong path.** `packages/server/src/browser-gateway.ts` → `packages/server/src/pairing/browser-gateway.ts`. `cancelLoad` lives on `directoryService` (already a dep of `event-wiring.ts`), so the register-side cancel belongs in `event-wiring.ts`.
2. **"No protocol change" is false for the fingerprint.** `session_register` carries `eventCount` only (= `sessionManager.getBranch().length`, `lifecycle.ts:536`, `session-sync.ts:96/253`). No leaf id. Fingerprint needs an optional additive `leafEntryId` (old bridge ⇒ absent ⇒ full wipe).
3. **Hydration count is available but dropped.** `session-load-worker.ts` returns `entryCount` (branch length, same leaf rule as pi-core `_buildIndex`: last entry id); `directory-service.ts` uses it only for metrics; `LoadResult` lacks it. Needs threading + leaf id. Retained-transcript arm (`readRetainedTranscript`) needs the same.
4. **Live-tail hazard for skip-wipe.** Hydration calls `replayEntriesAsEvents` WITHOUT `liveTailOpen`; it fabricates `session_ended` ends for open calls. Bridge passes `liveTailOpen: isLive(...)`. Server restart while pi is mid-turn → browser hydrates → bridge reconnects with matching fingerprint → skip keeps fabricated ends (regresses `fix-replay-fabricates-orphan-end-for-live-calls`). Skip must also require the bridge to report not-live (register has no liveness field; `agentRunning` is heartbeat-only) — or never skip when hydrated events contain fabricated ends.
5. **Idle timeout needs a hard cap.** No replay marker on `event_forward`; live events after a lost `replay_complete` would re-arm forever and suppress live broadcasts. Cap (prototype 120 s) or additive `replay: true` marker on replayed `event_forward`.
6. **Blanket `pendingReplaceProposal` clear is too broad.** It is in-memory only (not in meta). A genuine pending set by live events before a bridge reconnect (no server restart) would be dropped. Prefer snapshot at register → restore at replay exit. With the idle fix, detection is already suppressed for the full replay.
7. **Hydration race needs more than `cancelLoad`.** `cancelLoad` only stops a job still in the worker; a load already resolved and in its async fan-out (`subscription-handler.ts` `loaded.then`) still inserts. Add a per-session register generation checked before insert. The retained arm has its own cancel path.
8. **Windowed flush constraints.** `sendToSubscribers` also feeds in-process subscribers (`deliverInProcess`, chat gateway) — decide whether they get the window or the full stream. Spec `on-demand-session-replay` "A windowed replay resets client state explicitly" ⇒ send `session_state_reset` before the windowed flush (a browser that subscribed mid-replay already holds a partial store). `sendEventBatches` closes the replay-pill gap noted in archived `show-replay-in-flight-indicator`.
9. **Dialog mount item — drop it.** `ReplaceProposalDialog` renders from one place per `SessionOpenSpecActions` (`SessionCard`, or the board popover when it is open); the two `{replaceDialog}` sites are alternate returns. The "reopen/stack" symptom comes from the server leak re-setting pending (S1b). Dropping it also avoids a conflict with `add-project-workflows` task 5.4.

## Replay wall time at issue scale (`spike-replay-walltime.test.ts`, loopback, develop)

15,213 `event_forward` (~80 MB; message_end ~5.3 KB, tool_execution_end ~10.6 KB) after register, then `replay_complete`:
- bridge send loop: 157 ms
- register → exit flush received by browser: 741 ms (one `event_replay` frame)
- Server-side processing is far below 5 s; field replays above 5 s come from bridge-side or network time. Loopback only — a throttled link was not measured.
