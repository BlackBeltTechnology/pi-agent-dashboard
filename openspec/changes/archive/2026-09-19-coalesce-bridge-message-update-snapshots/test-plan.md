# Test Plan — coalesce-bridge-message-update-snapshots

Stage: design   Generated: 2025-02-17

Requirement refs are the six `ADDED Requirements` of
`specs/bridge-message-update-coalescing/spec.md`, abbreviated:

| ref | requirement |
|---|---|
| R1 | Contiguous text snapshots SHALL coalesce into a fixed window |
| R2 | Non-text sub-events SHALL be forwarded immediately in source order |
| R3 | A pending snapshot SHALL precede every non-update event of its message |
| R4 | Updates for a closed message SHALL be dropped, and only those |
| R5 | Lifecycle boundaries SHALL NOT reorder message content |
| R6 | Forwarded snapshot payloads SHALL be unchanged in shape |

L3 rows read their observable against the harness port recorded in
`.pi-test-harness.json` (`dashboardPort`), never a hardcoded `:18000`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 | EP | L1 | automated | open message A; 20 `text_delta` updates, texts `"a"`…`"a"*20`, all at t=0..40ms | fake clock advances to t=50ms | exactly 1 send; its `partial.content[0].text` is `"a"*20` |
| E2 | R1 | BVA (just-below) | L1 | automated | one `text_delta` parked at t=0 | clock advances to t=49ms | 0 sends |
| E3 | R1 | BVA (at bound) | L1 | automated | one `text_delta` parked at t=0 | clock advances to exactly t=50ms | exactly 1 send |
| E4 | R1 | BVA (just-above, re-arm) | L1 | automated | `text_delta` at t=0, second `text_delta` at t=51ms | clock advances to t=101ms | exactly 2 sends, in arrival order |
| E5 | R1 | fixed-window ≠ debounce | L1 | automated | gapless `text_delta` every 5ms for 500ms (100 updates) | clock advances through the run | sends == 10 ± 1; max observed park→send delay ≤ 50ms; never 1 send |
| E6 | R1 | idle | L1 | automated | open message, no pending update | clock advances 200ms | 0 sends |
| E7 | R2 | decision table over the 10-member sub-event union | L1 | automated | one update per sub-event type (`start`, `text_*`, `thinking_*`, `toolcall_*`) with no pending text | each is offered | `text_start`/`text_delta`/`text_end` park (0 immediate sends); the other 7 send immediately, unmodified |
| E8 | R2 | lossless run | L1 | automated | 5 `thinking_delta` updates, distinct `thinking` text, within one window | offered back-to-back | 5 sends, contents equal to the 5 inputs in order, none replaced |
| E9 | R2 | unknown type (fail-open default) | L1 | automated | update with `assistantMessageEvent.type = "audio_delta"` (not in the union) while text is pending | offered | pending text sent first, then the unknown update sent unmodified |
| E10 | R4 | state-transition, legal edge | L1 | automated | `messageStart(1, "1:assistant:1000")`, `text_delta` pending, `flush`, `messageEnd(1, …)` | a further `text_delta` for key `1:assistant:1000` arrives | 0 additional sends (closed-key drop) |
| E11 | R4 | state-transition, illegal edge (no open message) | L1 | automated | fresh coalescer, `messageStart` never called | `text_delta` for key `7:assistant:2000` arrives, clock +50ms | 1 send — the update is not dropped |
| E12 | R4 | state-transition, illegal edge (unseen key while open) | L1 | automated | open key `1:assistant:1000` with text pending | `text_delta` for unseen key `2:assistant:1001` arrives | pending text of the first key sent first, then the new update; slot now keyed to the new key |
| E13 | R4 | key-collision boundary | L1 | automated | two messages, both `role:"assistant"`, both `timestamp:1000`, generations 1 and 2 | message 1 closed, then an update for generation 2 | generation 2's update is forwarded (keys differ), proving the generation is load-bearing in the key |
| E14 | R1 | idempotence | L1 | automated | one pending snapshot | `flush()` called twice in a row | exactly 1 send; second call is a no-op |
| E15 | R5 | `clear()` | L1 | automated | pending snapshot with an armed window | `clear(gen)` then clock +200ms | 0 sends; the injected timer's cancel was called |
| E16 | R6 | cumulative monotonicity | L1 | automated | snapshots with texts `"abc"`, then `"abcdef"` in one window | window elapses | the single send carries `"abcdef"`; no send ever carries a text shorter than a previously sent one |
| E17 | R3 | choke point, early-returning branch | L1 | automated | bridge harness with a pending snapshot | dispatch a `message_start` whose `message.role === "custom"` (branch returns without forwarding) | the pending snapshot is already on the wire before the handler returns |
| E18 | R3 | choke point, deferred branch | L1 | automated | bridge harness with a pending snapshot | dispatch `message_end` (send deferred by `setTimeout(0)`) | wire order is `[snapshot, message_end]`; a `text_delta` arriving during the macrotask gap produces no further send |
| E19 | R3 | out-of-loop sink | L1 | automated | bridge harness with a pending snapshot | a synthesized `custom_entry` is sent via `wrapCustomPersistenceForCtx` | the snapshot precedes the `custom_entry` on the wire |
| E20 | R2 + D9 | server-coupling boundary | L1 | automated | pending text snapshot `"Running the test"` | `tool_execution_start` for `tc-1` is handled | the text-bearing `message_update` is on the wire immediately before the `tool_execution_start`, so `replay-compaction`'s pre-tool exemption still finds one |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | D0 gate | before/after counting | L1 | automated | synthetic 2000-update turn (one `text_delta` per 3ms, 6s of stream) driven through the coalescer with a counting `send` | sends ≤ `ceil(6000/50) + 2`; bytes mapped ≤ 7% of the uncoalesced baseline (ratio ≈ tick/window ≈ 6%; the original 3% figure assumed a different growth model — see `design.md` `## Measurement`) | one synthetic turn |
| P2 | R1 | tail-latency on the park→send delay | L1 | automated | the E5 gapless stream | p100 park→send delay ≤ 50ms (one window, non-cumulative — not 100ms) | 500ms run |
| P3 | D0 gate | live before/after measurement | — | manual-only | one long real assistant turn on the local dashboard, instrumented on `develop` then on the branch | [judgment: is the bridge send count materially above `duration/50ms` before, and at/near it after] | one turn |
| P4 | design Open Question | perceptual check | — | manual-only | live streaming turn at `COALESCE_WINDOW_MS = 50` | [judgment: streaming still feels continuous; decide whether 50 stays or moves to 33/80] | one turn |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R3 + R4 | state-convergence | L3 | automated | harness session prompted for a multi-paragraph answer | turn runs to settle | converges to: rendered assistant text equals the final message content, and no streaming bubble element remains after `agent_end` |
| F2 | R2 | state-convergence | L3 | automated | harness session prompted to produce reasoning then a tool call | turn settles | the thinking block renders in full and the tool row renders after it — order preserved, no truncated reasoning |
| F3 | R5 + D9 | state-transition across replay | L3 | automated | a settled turn containing text followed by a tool call | reload the dashboard page (forces history replay) | the pre-tool text is still rendered above the tool row after replay |
| F4 | R5 | state-convergence across a transport boundary | L3 | automated | streaming turn in flight | kill the WS connection mid-turn and let it reconnect | converges to the full final text exactly once — no duplicated tail, no live text rendered after replayed history |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R5 | fault injection (dead sink) | L1 | automated | the window timer fires after the bridge was deactivated (`isActive()` false) | clock +50ms post-deactivation | no send attempted, no throw |
| X2 | R5 | state-transition, session boundary | L1 | automated | pending snapshot, then `session_start` for a different session | clock +200ms | 0 sends for the previous session; timer cancelled |
| X3 | R4 | fault injection (missing key material) | L1 | automated | a `message_update` whose `message.timestamp` is `undefined` | offered while a message is open | the update is still forwarded (fallback key), never dropped on `undefined` |
| X4 | R4 + migration | fault injection (mid-turn reload) | L3 | automated | `npm run reload` issued while a turn is streaming in the harness | reload lands mid-stream | the remainder of that turn still renders (text and thinking); the turn settles with complete content |

---

## Coverage summary

- Requirements covered: 6/6 (plus D0 gate and D9 server coupling)
- Scenarios by class: edge 20 · perf 4 · frontend 4 · error 4
- Scenarios by level: L1 23 · L2 0 · L3 5 · manual-only 2
- Scenarios by disposition: automated 30 · manual-only 2

No L2 rows: this change never touches install, spawn or OS-runtime behaviour —
it is in-process bridge logic plus rendered-UI consequences.

## New infra needed

None. L1 rows extend the existing `packages/extension/src/__tests__/` vitest
tier (exemplars: `subagent-tick-throttle.test.ts` for an injected-timer state
machine, `bridge-followup-chat-order.test.ts` for the bridge wire-order harness).
L3 rows extend `tests/e2e/` against the docker harness (exemplars:
`tests/e2e/streaming-latch-heal.spec.ts` for streaming-bubble convergence,
`tests/e2e/replay-delta-on-reload.spec.ts` for the reload/replay boundary).
