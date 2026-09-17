# Tasks — Coalesce bridge `message_update` text snapshots

> Design references: D0–D9 in `design.md`. Requirements: `specs/bridge-message-update-coalescing/spec.md`.

## 1. Baseline measurement (gate — D0)

- [ ] 1.1 Instrument `packages/extension/src/bridge.ts` on current `develop` with a temporary counter (sends + bytes stringified per `message_update`), run one long assistant turn on the local dashboard, and record the numbers in `design.md` under a `## Measurement` heading. Verify: recorded before-numbers exist (send count, total bytes, turn duration).
- [ ] 1.2 Compare the recorded send count against `turnDuration / 50 ms`. Verify: if the ratio is not materially above 1, STOP, report to the user, and do not proceed past this group — the win is already captured by the server fold / render batching. Otherwise record the expected reduction factor and continue.
- [ ] 1.3 Remove the temporary counter instrumentation. Verify: `git diff packages/extension/src/bridge.ts` is empty at the end of this group.

## 2. Coalescer unit tests (red — D1/D2/D3/D4)

- [ ] 2.1 Create `packages/extension/src/__tests__/message-update-coalescer.test.ts` with fake timers and an injected clock, asserting last-wins within a window: N `text_delta` updates in one window produce exactly one send carrying the newest snapshot. Verify: test fails (module does not exist).
- [ ] 2.2 Add the fixed-window (not debounce) test: a gapless stream longer than one window sends once per window and never delays a snapshot past one window. Verify: test fails.
- [ ] 2.3 Add the idle test: a window elapsing with an empty slot sends nothing. Verify: test fails.
- [ ] 2.4 Add the thinking-lossless test: a run of `thinking_delta` updates forwards every one, none replaced. Verify: test fails.
- [ ] 2.5 Add the flush-then-forward ordering test: pending text + arriving `thinking_delta` / `toolcall_delta` / unrecognised sub-event → text sent first, then the sub-event, both in source order. Verify: test fails.
- [ ] 2.6 Add the barrier tests (D4 fail-open rule): an update whose key was already closed by `messageEnd` is dropped; an update arriving while no message is open opens a slot and is forwarded; an update with an unseen key flushes pending text and re-opens under the new key. Verify: tests fail.
- [ ] 2.7 Add the lifecycle tests: `flush()` is sync + idempotent (double flush sends once); `clear(gen)` drops the slot, cancels the window, and closes the lifecycle so a later update is dropped. Verify: tests fail.

## 3. Coalescer implementation (green — D1/D2/D3/D4)

- [ ] 3.1 Create `packages/extension/src/message-update-coalescer.ts` exporting `COALESCE_WINDOW_MS = 50` and a `MessageUpdateCoalescer` class taking injected `{ send, setTimer, clearTimer }`, with the single-slot state machine, the TEXT/other family split defaulting unknown sub-events to immediate forwarding, one armed timer per window (D7 — no sweep), and the closed-key-only drop rule (`messageStart`, `messageEnd`, `offer`, `flush`, `clear`). Verify: all of group 2 passes (`npx vitest run packages/extension/src/__tests__/message-update-coalescer.test.ts`).
- [ ] 3.2 Add `packages/extension/src/message-update-coalescer.ts.AGENTS.md` sidecar and its row in `packages/extension/src/AGENTS.md` (path-alphabetical, caveman style, `See change: coalesce-bridge-message-update-snapshots`). Verify: `kb_search --doc-type agents "message-update-coalescer"` returns the row.

## 4. Bridge ordering regression test (red — D5/D8)

- [ ] 4.1 Create `packages/extension/src/__tests__/bridge-coalesced-chat-order.test.ts` (do NOT touch the pre-existing `bridge-followup-chat-order.test.ts`, which asserts a different drain-ordering invariant) reproducing the ghost-bubble defect: a pending text snapshot for message A, then `message_end` A, then `message_start` B — assert A's snapshot is on the wire before A's `message_end` and nothing for A appears after B's start. Verify: test fails on current bridge.
- [ ] 4.2 Add the early-return-branch case: drive a pending snapshot, dispatch an event type whose handler branch returns without forwarding, assert the snapshot was already flushed. Verify: test fails.
- [ ] 4.3 Add the reconnect case: pending snapshot + `onReconnect` → snapshot precedes state sync and replay messages. Verify: test fails.

## 5. Bridge integration (green — D5/D6/D7/D8)

- [ ] 5.1 Add a session-scoped coalescer instance in `initBridge` plus a `messageKeyOf(gen, message)` helper (`${gen}:${role}:${timestamp}`, falling back to a per-message counter when `timestamp` is absent) and a per-message `assistantMessageGen` counter distinct from the bridge-instance `generation` at `bridge.ts:143`. Verify: type-checks (`npx tsc -p packages/extension --noEmit` or the workspace equivalent).
- [ ] 5.2 Add the single flush choke point at the top of the enriched-event handler body and of the pass-through handler loop, firing for every `eventType !== "message_update"` before any branch runs, plus the two explicit out-of-loop flushes named in D5 (`wrapCustomPersistenceForCtx` at `bridge.ts:811-880`, `sendSyntheticRetryEvent`). Verify: task 4.2 passes.
- [ ] 5.3 Route `message_update` through `coalescer.offer(...)` instead of the direct send tail, and move `maybeInlineAssistantImages` into the coalescer's `send` callback (keeping the `message_end` inliner at `bridge.ts:2436` untouched). Verify: existing bridge tests still pass and the inliner runs once per flushed window (assert call count in a test).
- [ ] 5.4 Wire the barrier at handler ENTRY, before the existing early-return branches and before `message_end`'s `setTimeout(0)` send is scheduled (D5): `message_start` → `assistantMessageGen++` + `messageStart(gen, key)` for both user and assistant roles; `message_end` → flush, then `messageEnd(gen, key)`. Verify: task 4.1 passes.
- [ ] 5.5 Flush in `onReconnect` (`bridge.ts:1483`) before state sync and replay. Verify: task 4.3 passes.
- [ ] 5.6 Register the coalescer's window timer with the existing bridge-timer registry (`prev.timers` in `initBridge`), guard the send callback on `isActive() && sessionReady`, and `clear(gen)` the instance on `session_start` (session switch), `session_shutdown` and reload — next to the existing `subagentFrameBuffer` / `subagentTickThrottle` resets. Verify: a test asserts a pending snapshot is discarded across a session switch and no timer leaks.

## 6. Regression + quality

- [ ] 6.1 Run the full suite once to a log and grep it: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`. Verify: zero failures, with `provider-retry-state` (bridge wire-ordering invariant) and the subagent frame buffering/flush tests explicitly green.
- [ ] 6.2 Run `npm run quality:changed`. Verify: no new Biome findings on the changed files.

## 7. Docs

- [ ] 7.1 Update `packages/extension/src/bridge.ts.AGENTS.md` with the coalescer ownership, the flush choke-point invariant, the window timer, and `See change: coalesce-bridge-message-update-snapshots`. Verify: the row reflects the new invariant and `kb_search` returns it.
- [ ] 7.2 Delegate to `DocScribe` a caveman-style paragraph in `docs/architecture.md` describing the bridge-side coalescing layer and its boundary against the server fold / client render batching. Verify: the section exists and names both neighbouring layers.

## 8. Manual verification

- [ ] 8.1 `npm run reload`, run a long streaming turn in a live pi session, and confirm in the dashboard: text streams smoothly, no ghost streaming bubble after settle, thinking blocks render fully, tool rows appear in order. Verify: observed on screen, recorded in the change notes.
- [ ] 8.2 Re-run the task-1.1 measurement with coalescing on and record the after-numbers next to the before-numbers. Verify: send count is at or near `turnDuration / 50 ms`; decide and record whether `COALESCE_WINDOW_MS` stays at 50 (design Open Question).
- [ ] 8.3 Exercise the lifecycle boundaries manually: reload the extension mid-turn, force a WS reconnect mid-turn, and switch sessions mid-turn. Verify: no out-of-order follow-up chat line and no leftover streaming bubble in any of the three.
