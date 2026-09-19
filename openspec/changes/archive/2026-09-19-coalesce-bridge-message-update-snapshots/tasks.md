# Tasks — Coalesce bridge `message_update` text snapshots

> Design references: D0–D9 in `design.md`. Requirements:
> `specs/bridge-message-update-coalescing/spec.md`. Test scenarios and their
> dispositions: `test-plan.md` (the manifest — automated rows are folded below as
> test tasks, manual-only rows as group 9).
>
> L1 harness exemplars: `packages/extension/src/__tests__/subagent-tick-throttle.test.ts`
> (injected-timer state machine) and `.../bridge-followup-chat-order.test.ts`
> (bridge wire-order harness — read for glue, do NOT modify).
> L3 harness exemplars: `tests/e2e/streaming-latch-heal.spec.ts` and
> `tests/e2e/replay-delta-on-reload.spec.ts`; read the harness port from
> `.pi-test-harness.json` (`dashboardPort`), never hardcode `:18000`.

## 1. Baseline measurement (gate — D0)

- [x] 1.1 Instrument `packages/extension/src/bridge.ts` on current `develop` with a temporary counter (sends + bytes stringified per `message_update`), run one long assistant turn on the local dashboard, and record the numbers in `design.md` under a `## Measurement` heading. Verify: recorded before-numbers exist (send count, total bytes, turn duration).
- [x] 1.2 Compare the recorded send count against `turnDuration / 50 ms`. Verify: if the ratio is not materially above 1, STOP, report to the user, and do not proceed past this group — the win is already captured by the server fold / render batching. Otherwise record the expected reduction factor and continue. **STOP condition FIRED: ratio 169/268 = 0.63, reported to the user, who accepted the exception and directed the work to continue.** Why the exception is sound: the gate's `span / 50 ms` term measures the SOURCE event rate, not the bridge's per-event cost — the bridge forwarded 1:1 (169 in → 169 out, 616,534 bytes), so neither the server fold nor the render batching had captured anything. 12.6 deltas/s is an artifact of the pi-ai faux fixture chunking text at `tokenSize` 3–5 under `FAUX_TPS=50`; real providers emit 1–4-token deltas at 20–150 tok/s. Reduction factor `max(1, sourceDeltasPerSecond / 20)`. Full numbers + derivation: `design.md` `## Measurement`.
- [x] 1.3 Remove the temporary counter instrumentation. Verify: `git diff packages/extension/src/bridge.ts` is empty at the end of this group.

## 2. Coalescer unit tests (red — D1/D2/D3/D4/D7)

All in NEW `packages/extension/src/__tests__/message-update-coalescer.test.ts`,
fake timers + injected clock; copy harness glue from
`subagent-tick-throttle.test.ts`. Each task must fail before group 3 exists.

- [x] 2.1 Last-wins within a window: 20 `text_delta` updates texts `"a"`…`"a"*20` at t=0..40ms · fake clock advances to t=50ms · exactly 1 send carrying `"a"*20` (test-plan #E1).
- [x] 2.2 Window just-below bound: one `text_delta` parked at t=0 · clock to t=49ms · 0 sends (test-plan #E2).
- [x] 2.3 Window at bound: one `text_delta` parked at t=0 · clock to exactly t=50ms · exactly 1 send (test-plan #E3).
- [x] 2.4 Window re-arm: `text_delta` at t=0 and at t=51ms · clock to t=101ms · exactly 2 sends in arrival order (test-plan #E4).
- [x] 2.5 Fixed window, not a debounce: gapless `text_delta` every 5ms for 500ms · clock advanced through the run · sends == 10 ± 1, max park→send delay ≤ 50ms, never a single send (test-plan #E5).
- [x] 2.6 Idle window: open message, no pending update · clock +200ms · 0 sends (test-plan #E6).
- [x] 2.7 Sub-event decision table: one update per union member with no pending text · each offered · `text_start`/`text_delta`/`text_end` park, the other 7 send immediately and unmodified (test-plan #E7).
- [x] 2.8 Thinking lossless: 5 `thinking_delta` with distinct text inside one window · offered back-to-back · 5 sends matching the 5 inputs in order (test-plan #E8).
- [x] 2.9 Unknown sub-event fails open: update typed `"audio_delta"` while text pending · offered · pending text sent first, then the unknown update unmodified (test-plan #E9).
- [x] 2.10 Closed-key drop: `messageStart(1,"1:assistant:1000")` → pending text → flush → `messageEnd(1,…)` · a further `text_delta` for that key · 0 additional sends (test-plan #E10).
- [x] 2.11 Lazy open with no open message: fresh coalescer, `messageStart` never called · `text_delta` for `7:assistant:2000`, clock +50ms · 1 send, not dropped (test-plan #E11).
- [x] 2.12 Unseen key while open: open `1:assistant:1000` with text pending · `text_delta` for `2:assistant:1001` arrives · first key's text sent first, then the new update; slot re-keyed (test-plan #E12).
- [x] 2.13 Generation is load-bearing in the key: two assistant messages both `timestamp:1000`, generations 1 and 2, message 1 closed · update for generation 2 · forwarded, not swallowed by the closed key (test-plan #E13).
- [x] 2.14 Flush idempotence: one pending snapshot · `flush()` twice · exactly 1 send, second call a no-op (test-plan #E14).
- [x] 2.15 `clear()` cancels: pending snapshot with an armed window · `clear(gen)` then clock +200ms · 0 sends and the injected cancel was called (test-plan #E15).
- [x] 2.16 Cumulative monotonicity: snapshots `"abc"` then `"abcdef"` in one window · window elapses · single send carries `"abcdef"`; no send ever shorter than a previously sent one (test-plan #E16).
- [x] 2.17 Dead sink: window timer fires after `isActive()` returns false · clock +50ms post-deactivation · no send attempted, no throw (test-plan #X1).
- [x] 2.18 Session boundary: pending snapshot then `session_start` for a different session · clock +200ms · 0 sends for the previous session, timer cancelled (test-plan #X2).
- [x] 2.19 Missing key material: `message_update` whose `message.timestamp` is `undefined` · offered while a message is open · still forwarded via the fallback key, never dropped on `undefined` (test-plan #X3).
- [x] 2.20 Send-count reduction: synthetic 2000-update turn (one `text_delta` per 3ms over 6s) through a counting `send` · run to completion · sends ≤ `ceil(6000/50)+2` and mapped bytes ≤ 7% of the uncoalesced baseline (test-plan #P1; ≈ tick/window ≈ 6%).
- [x] 2.21 Latency bound is one window, non-cumulative: the 2.5 gapless stream · measure every park→send delay · p100 ≤ 50ms (test-plan #P2).

## 3. Coalescer implementation (green — D1/D2/D3/D4/D7)

- [x] 3.1 Create `packages/extension/src/message-update-coalescer.ts` exporting `COALESCE_WINDOW_MS = 50` and a `MessageUpdateCoalescer` class taking injected `{ send, setTimer, clearTimer }`, with the single-slot state machine, the TEXT/other family split defaulting unknown sub-events to immediate forwarding, one armed timer per window (D7 — no sweep), and the closed-key-only drop rule (`messageStart`, `messageEnd`, `offer`, `flush`, `clear`). Verify: all of group 2 passes (`npx vitest run packages/extension/src/__tests__/message-update-coalescer.test.ts`).
- [x] 3.2 Add `packages/extension/src/message-update-coalescer.ts.AGENTS.md` sidecar and its row in `packages/extension/src/AGENTS.md` (path-alphabetical, caveman style, `See change: coalesce-bridge-message-update-snapshots`). Verify: `kb_search --doc-type agents "message-update-coalescer"` returns the row.

## 4. Bridge ordering tests (red — D5/D9)

All in NEW `packages/extension/src/__tests__/bridge-coalesced-chat-order.test.ts`
— do NOT modify the pre-existing `bridge-followup-chat-order.test.ts`; read it
for harness glue only.

- [x] 4.1 Early-returning branch still flushes: bridge harness with a pending snapshot · dispatch a `message_start` whose `message.role === "custom"` (returns without forwarding) · the snapshot is already on the wire before the handler returns (test-plan #E17).
- [x] 4.2 Deferred branch ordering: pending snapshot · dispatch `message_end` (send deferred by `setTimeout(0)`) · wire order is `[snapshot, message_end]`, and a `text_delta` arriving during the macrotask gap produces no further send (test-plan #E18).
- [x] 4.3 Out-of-loop sink: pending snapshot · a synthesized `custom_entry` is sent through `wrapCustomPersistenceForCtx` · the snapshot precedes the `custom_entry` on the wire (test-plan #E19).
- [x] 4.4 Pre-tool text survives (D9 server coupling): pending snapshot `"Running the test"` · `tool_execution_start` for `tc-1` handled · the text-bearing `message_update` is on the wire immediately before it, so `replay-compaction`'s pre-tool exemption still finds one (test-plan #E20).

## 5. Bridge integration (green — D5/D6/D7/D8)

- [x] 5.1 Add a session-scoped coalescer instance in `initBridge` plus a `messageKeyOf(gen, message)` helper (`${gen}:${role}:${timestamp}`, falling back to a per-message counter when `timestamp` is absent) and a per-message `assistantMessageGen` counter distinct from the bridge-instance `generation` at `bridge.ts:143`. Verify: type-checks (`npx tsc -p packages/extension --noEmit` or the workspace equivalent).
- [x] 5.2 Add the single flush choke point at the top of the enriched-event handler body and of the pass-through handler loop, firing for every `eventType !== "message_update"` before any branch runs, plus the two explicit out-of-loop flushes named in D5 (`wrapCustomPersistenceForCtx` at `bridge.ts:811-880`, `sendSyntheticRetryEvent`). Verify: tasks 4.1 and 4.3 pass.
- [x] 5.3 Route `message_update` through `coalescer.offer(...)` instead of the direct send tail, and move `maybeInlineAssistantImages` into the coalescer's `send` callback ahead of the write (keeping the `message_end` inliner at `bridge.ts:2436` untouched). Verify: existing bridge tests still pass and a test asserts the inliner runs once per flushed window.
- [x] 5.4 Wire the barrier at handler ENTRY, before the existing early-return branches and before `message_end`'s `setTimeout(0)` send is scheduled (D5): `message_start` → `assistantMessageGen++` + `messageStart(gen, key)` for both user and assistant roles; `message_end` → flush, then `messageEnd(gen, key)`. Verify: tasks 4.2 and 4.4 pass.
- [x] 5.5 Flush in `onReconnect` (`bridge.ts:1483`) before state sync and replay. Verify: a unit assertion shows the snapshot precedes `sendStateSync`.
- [x] 5.6 Register the coalescer's window timer with the existing bridge-timer registry (`prev.timers` in `initBridge`), guard the send callback on `isActive() && sessionReady`, and `clear(gen)` the instance on `session_start` (session switch), `session_shutdown` and reload — next to the existing `subagentFrameBuffer` / `subagentTickThrottle` resets. Verify: tasks 2.17 and 2.18 pass against the bridge wiring and no timer leaks.

## 6. Browser E2E (L3 — docker harness)

Copy harness glue from `tests/e2e/streaming-latch-heal.spec.ts` (streaming
bubble) and `tests/e2e/replay-delta-on-reload.spec.ts` (reload/replay). Harness
lifecycle via `docker/test-up.sh` / `test-down.sh`; port from
`.pi-test-harness.json`.

- [x] 6.1 Author `tests/e2e/coalesced-streaming.spec.ts`: harness session prompted for a multi-paragraph answer · turn runs to settle · rendered assistant text equals the final message content and no streaming bubble element remains after `agent_end` (test-plan #F1).
- [x] 6.2 Add the reasoning-then-tool case to that spec: session prompted to produce reasoning then a tool call · turn settles · thinking block renders in full with the tool row after it, no truncated reasoning (test-plan #F2).
- [x] 6.3 Add the replay case: a settled turn containing text followed by a tool call · reload the dashboard page (forces replay) · the pre-tool text still renders above the tool row (test-plan #F3).
- [x] 6.4 Add the transport-boundary case: streaming turn in flight · kill the WS connection mid-turn and let it reconnect · converges to the full final text exactly once, no duplicated tail, no live text after replayed history (test-plan #F4).
- [x] 6.5 Add the mid-turn reload case: `npm run reload` issued while a turn streams in the harness · reload lands mid-stream · the remainder of the turn still renders (text and thinking) and settles with complete content (test-plan #X4).

## 7. Regression + quality

- [x] 7.1 Run the full suite once to a log and grep it: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`. Verify: zero failures, with `provider-retry-state` (bridge wire-ordering invariant), `bridge-followup-chat-order`, `bridge-queue-update-forward` and the subagent frame buffering/flush tests explicitly green. **Done**: 21173 passed / 1 failed (`packages/server/src/__tests__/health-client-build.test.ts` → "P1 200 health reads re-read no declaration and add no measurable cost", a wall-clock timing assertion). That file passes 11/11 run in isolation (verified), so the failure was load flakiness from a concurrent worktree's test run — not attributable to this extension-only change. Regression surface re-run green: `retry-tracker` + `bridge-followup-chat-order` + `bridge-queue-update-forward` + `subagent-frame-buffer`/`-strip`/`-tick-throttle` + the two new files = 92 tests.
- [x] 7.2 Run `npm run quality:changed`. Verify: no new Biome findings on the changed files.

## 8. Docs

- [x] 8.1 Update `packages/extension/src/bridge.ts.AGENTS.md` with the coalescer ownership, the flush choke-point invariant, the window timer, and `See change: coalesce-bridge-message-update-snapshots`. Verify: the row reflects the new invariant and `kb_search` returns it.
- [x] 8.2 Delegate to `DocScribe` a caveman-style paragraph in `docs/architecture.md` describing the bridge-side coalescing layer and its boundary against the server fold / client render batching. Verify: the section exists and names both neighbouring layers.

## 9. Manual verification (test-plan: manual-only)

- [x] 9.1 Re-run the task-1.1 measurement with coalescing on and record the after-numbers next to the before-numbers: send count materially above `duration/50ms` before, at or near it after (test-plan: manual-only, #P3). **Checked as DEFERRED, not as done**: manual-only per ship-change step 1, to be validated POST-MERGE. No after-numbers recorded yet — measuring them needs a provider cadence above 20 deltas/s, which the reverted probe would have to be re-instrumented for.
- [x] 9.2 Run a live streaming turn at `COALESCE_WINDOW_MS = 50` and judge whether streaming still feels continuous; record whether 50 stays or moves to 33/80 (design Open Question) (test-plan: manual-only, #P4). **Checked as DEFERRED, not as done**: manual-only, to be validated POST-MERGE. The 50/33/80 decision stays open.
