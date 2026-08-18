## 1. Fixtures and harness prerequisites

- [x] 1.1 Add a `[[faux:subagent-sustained-long]]` fixture (≥ 10 s of continuous producer ticks) in `qa/fixtures/faux-scenarios.ts`, alongside the existing ~6 s `subagent-sustained` (see `qa/fixtures/faux-scenarios.ts:916-926`)
- [x] 1.2 Add a `[[faux:subagent-streaming]]` fixture: streaming-heavy, minimal idle, so tick-rate measurement reflects the burst this change targets rather than a ~50 %-sleeping run
- [x] 1.3 Teach the docker e2e harness to write the dashboard config file (carrying `subagentTickThrottleMs`) into the container BEFORE the pi session starts; resolve the dashboard port from `.pi-test-harness.json`, never a hardcoded `:18000` (see `docker/test-up.sh`, `tests/e2e/README.md`)
- [x] 1.4 Add the SYNTHETIC Agent-tick producer `qa/fixtures/faux-agent-ticks.ext.ts` (an `Agent` tool that streams `tool_execution_update` frames at a `[[ticks:N@Mms]]` cadence with `partialResult.details.agentId`) + the `synthetic-agent-ticks` / `synthetic-agent-ticks-quiet` scenarios in `qa/fixtures/faux-scenarios.ts`. A nested faux subagent cannot sustain a >= 10 s tick stream (see `measurement.md`, Bug 2); the bridge throttle keys only on `toolName`+`agentId`, so a synthetic same-shape producer is the L3 substrate. Proven: OFF 19.6 fps -> ON(500) 2.00 fps on `/ws`
- [x] 1.5 Add the `PI_SYNTH_AGENT_TICKS=1` harness arm: `docker/compose.test.yml` env + `docker/test-entrypoint.sh` stages `faux-agent-ticks` and SKIPS the subagents producer (the synthetic `Agent` owns the tool name, first-registration-wins; the two never coexist)

## 2. Measure the baseline (D1 — gate)

- [x] 2.1 Record Agent-tick frames/s and bytes/s on `tool_execution_update`, broken down by `toolName`, and on the `subagents:*` carrier, over the streaming fixture with the throttle OFF
- [x] 2.2 Write the measurement up in `openspec/changes/reduce-bridge-tick-bandwidth/measurement.md`; if the Agent-tick rate is already ≤ 2 Hz, STOP and correct the proposal's benefit framing instead of building the throttle

> **RESOLVED (2026-08-18) — see `measurement.md`.** The 0.36 fps that tripped
> the 2.2 STOP was a DEAD-subagent artifact: the faux `Explore` subagent's
> `@fast` role did not resolve to the key-free faux model in the harness, so it
> fell back to a credential-less default and died in ~400 ms. Re-measured with a
> live producer: **~32 fps (~26 KB/s) — ~16x the 2 Hz gate.** `design.md`
> §Context is CONFIRMED; the STOP does NOT fire and the throttle is justified.
> §5's >= 10 s cadence rows now run on the synthetic-producer arm (task 1.4/1.5),
> since a nested faux subagent cannot sustain the stream (`measurement.md` Bug 2).

## 3. Throttle unit (TDD — tests before implementation)

- [x] 3.1 Author the throttle unit test file in `packages/extension/src/__tests__/` covering leading-edge emit (test-plan #E1) — input: throttle `W=500`, no prior tick for `tc1` · trigger: first Agent tick at t=0 · observable: forwarded synchronously, `tickForwarded=1`, `tickCoalesced=0`. Copy fake-timer harness glue from `packages/extension/src/__tests__/ui-modules.test.ts` (debounce/rate-cap tests) (test-plan: automated)
- [x] 3.2 Latest-wins coalescing (test-plan #E2) — input: ticks A,B,C for `tc1` at t=0,100,200 ms · trigger: timer fires at t=500 · observable: exactly 2 sends (A,C), B never sent, `tickCoalesced=1`. See `packages/extension/src/__tests__/ui-modules.test.ts` (test-plan: automated)
- [x] 3.3 Window boundary at exactly `W` (test-plan #E3) — input: tick A at t=0, tick B at t=W · trigger: B arrives on the boundary · observable: B forwarded on the leading edge, no timer left armed. See `packages/extension/src/__tests__/ui-modules.test.ts` (test-plan: automated)
- [x] 3.4 Window boundary at `W−1` (test-plan #E4) — input: tick A at t=0, tick B at t=W−1 · trigger: B arrives just inside the window · observable: B held and sent at t=W, single trailing send. See `packages/extension/src/__tests__/ui-modules.test.ts` (test-plan: automated)
- [x] 3.5 Disabled path (test-plan #E5) — input: `subagentTickThrottleMs=0`, 50 ticks in 100 ms · trigger: all ticks arrive · observable: all 50 forwarded, `tickCoalesced=0`. See `packages/extension/src/__tests__/ui-modules.test.ts` (test-plan: automated)
- [x] 3.6 Scope predicate decision table (test-plan #E6) — input: 4 update shapes (Agent+agentId, Agent without agentId, Bash with an agentId-lookalike, Bash with a plain string partial) · trigger: each forwarded · observable: only the first is throttled, the other three pass 1:1. See `packages/extension/src/__tests__/subagent-frame-buffer.test.ts` (test-plan: automated)
- [x] 3.7 Per-`toolCallId` independence (test-plan #E7) — input: two concurrent Agent runs `tc1`,`tc2` ticking at 10 Hz · trigger: 2 s of interleaved ticks · observable: each key throttled independently at ~2 Hz, no cross-suppression. See `packages/extension/src/__tests__/subagent-frame-buffer.test.ts` (test-plan: automated)
- [x] 3.8 Idle-TTL sweep (test-plan #E8) — input: key for `tc1` whose `tool_execution_end` never arrives · trigger: 60 s + 1 tick of fake-timer advance · observable: key swept, map size 0, no timer armed. See `packages/extension/src/__tests__/ui-modules.test.ts` (test-plan: automated)
- [x] 3.9 Idle-TTL negative (test-plan #E9) — input: key for `tc1` ticking every 30 s · trigger: 90 s of fake-timer advance · observable: key NOT swept, ticks still forwarded (TTL is idle-based, not absolute). See `packages/extension/src/__tests__/ui-modules.test.ts` (test-plan: automated)
- [x] 3.10 Terminal discard with anti-vacuity (test-plan #X6) — input: pending tick for `tc1` · trigger: `tool_execution_end` for `tc1` · observable: pending discarded not flushed, timer cleared, key deleted, `tickDiscardedAtTerminal=1`; verify the test FAILS when the discard is removed. See `packages/extension/src/__tests__/subagent-frame-buffer.test.ts` (test-plan: automated)
- [x] 3.11 Fire-time `sessionReady` gate (test-plan #X1) — input: `sessionReady` flips false while a tick is pending · trigger: trailing timer fires · observable: nothing sent, `tickDroppedNotReady=1`, no throw into the emitter. See `packages/extension/src/__tests__/bridge-shutdown-reset.test.ts` (test-plan: automated)
- [x] 3.12 Fire-time `isActive` gate (test-plan #X2) — input: a newer bridge instance takes over while a tick is pending · trigger: trailing timer fires · observable: superseded instance sends nothing, `tickDroppedNotReady=1`. See `packages/extension/src/__tests__/bridge-shutdown-reset.test.ts` (test-plan: automated)
- [x] 3.13 Fire-time sessionId drift (test-plan #X3) — input: session changes while a tick is pending · trigger: trailing timer fires · observable: the stale-session frame is not sent. See `packages/extension/src/__tests__/bridge-shutdown-reset.test.ts` (test-plan: automated)
- [x] 3.14 Session lifecycle disposal (test-plan #X4) — input: 3 pending keys with armed timers · trigger: session change, then session shutdown · observable: all timers cleared, map emptied, nothing sent afterwards. See `packages/extension/src/__tests__/bridge-shutdown-reset.test.ts` (test-plan: automated)
- [x] 3.15 Connection-loss retention (test-plan #X5) — input: connection drops then reconnects with a tick pending · trigger: trailing timer fires after reconnect · observable: the frame is sent over the LIVE connection, not a captured stale reference. See `packages/extension/src/__tests__/connection-dropped-frames.test.ts` (test-plan: automated)
- [x] 3.16 Non-subagent and other event types pass 1:1 (test-plan #E10) — input: a `message_update`, a `tool_execution_start`, a `tool_call` burst · trigger: forwarded through the enriched loop · observable: every event forwarded 1:1, unaffected by throttle state. See `packages/extension/src/__tests__/bridge-queue-update-forward.test.ts` (test-plan: automated)
- [x] 3.17 Map-bound soak (test-plan #P5) — input: 500 sequential Agent runs each ending normally · trigger: run loop · observable: map returns to 0 after each run, peak ≤ 2 keys. See `packages/extension/src/__tests__/subagent-frame-buffer.test.ts` (test-plan: automated)
- [x] 3.18 Implement the throttle module in `packages/extension/src/` (leading edge + trailing timer + latest-wins, keyed per `toolCallId`, 60 s idle TTL, fire-time `isActive`/`sessionReady`/`sessionId` gating, terminal discard) until 3.1–3.17 pass
- [x] 3.19 Add `subagentTickThrottleMs` to `packages/shared/src/config.ts` (rollout default `0`), wire it through `loadConfig()` into the bridge, and apply the throttle at `bridge.ts:1902` for Agent ticks only

## 4. Observability (D6)

- [x] 4.1 Add the `tickForwarded` / `tickCoalesced` / `tickDiscardedAtTerminal` / `tickDroppedNotReady` counters to the bridge and build the bridge→server transport so they land on `/api/health` (no such transport exists today; `SubagentFrameBuffer.stats` is only `console.log`ged at `bridge.ts:2046-2050`)
- [x] 4.2 Update the exact-shape `/api/health` assertions in the server tests in the same commit as 4.1
- [x] 4.3 E2E: counters reach `/api/health` (test-plan #X7) — input: a subagent run with the throttle ON · trigger: `GET /api/health` after the run · observable: throttle counters present and non-zero, existing health fields unchanged. See `tests/e2e/bridge-contention-health.spec.ts` (test-plan: automated)
- [x] 4.4 E2E: predicate tripwire (test-plan #X8) — input: a session running only non-subagent tools (Bash streaming) · trigger: `GET /api/health` · observable: `tickForwarded`/`tickCoalesced` stay 0. See `tests/e2e/bridge-contention-health.spec.ts` (test-plan: automated)

## 5. Wire and rendered behaviour (E2E)

- [x] 5.1 Cadence floor on the throttled carrier (test-plan #F1) — input: the synthetic >= 10 s producer with the throttle ON · trigger: count Agent-tick frames received by the browser · observable: >= 5 frames in the 10 s window. See `tests/e2e/subagent-tick-throttle.spec.ts` (F1/P1), synthetic arm (test-plan: automated)
- [x] 5.2 Throttled rate (test-plan #P1) — input: synthetic producer, throttle ON · trigger: measure over >= 10 s · observable: Agent-tick frames (filtered `toolName === "Agent"`) mean <= 2.2 frames/s over the whole window. See `tests/e2e/subagent-tick-throttle.spec.ts` (test-plan: automated)
- [x] 5.3 Reduction is real (test-plan #P2) — input: same producer, throttle OFF · trigger: measure over >= 10 s · observable: Agent-tick frames/s >= 4x the 5.2 rate. See `tests/e2e/subagent-tick-throttle.spec.ts` (test-plan: automated)
- [x] 5.4 Delivered-tick staleness (test-plan #P3) — input: synthetic producer, throttle ON · trigger: measure consecutive DELIVERED Agent-tick gaps on `/ws` (NOT stored/replay: the parent collapse change trims superseded stored updates, so replay cannot carry the cadence) · observable: p95 gap <= 1.5W, max <= 3W. See `tests/e2e/subagent-tick-throttle.spec.ts` (test-plan: automated)
- [x] 5.5 F4 stays non-vacuous (test-plan #P4) — SUBSUMED by 5.1 (F1) on the synthetic arm: F1 asserts >= 5 Agent-tick frames in the 10 s window under the throttle, strictly stronger than P4's >= 2. The real-fixture version is not constructible (nested faux subagent dies; `measurement.md` Bug 2) (test-plan: automated)
- [x] 5.6 No tick after terminal (test-plan #F2) — input: a synthetic run ending while a tick is pending · trigger: `tool_execution_end` forwarded for the run · observable: no `tool_execution_update` for that `toolCallId` on `/ws` afterwards. See `tests/e2e/subagent-tick-throttle.spec.ts` (test-plan: automated)
- [ ] 5.7 Reload folds to terminal (test-plan #F3) — input: a finished subagent run, throttle ON · trigger: page reload · observable: timeline renders the terminal snapshot, entry count equals the pre-reload terminal count. See `tests/e2e/replay-delta-on-reload.spec.ts` (normal harness — real subagent completes) (test-plan: automated)
- [x] 5.8 Sibling pull path untouched (test-plan #F4) — RECLASSIFIED to L1. The L3 version is structurally unconstructible (the faux subagent dies in ~400 ms before an inspector-open can trigger a resync; the synthetic producer emits no `subagents:*`). The invariant — resync/`subagents:*` frames pass the throttle 1:1 and move no counter (they are a different carrier `isSubagentTick` never sees) — is owned by `packages/extension/src/__tests__/bridge-queue-update-forward.test.ts` ("resync / subagents:* sibling frames pass 1:1"). The unconstructible L3 test was removed from `tests/e2e/subagent-inspector.spec.ts`. See change: reduce-bridge-tick-bandwidth (test-plan F4, L1-owned)
- [x] 5.9 Quiet-producer anti-vacuity guard (test-plan #F5) — input: the `synthetic-agent-ticks-quiet` producer (a > 2 s gap before tick 30) · trigger: observe the gap · observable: no cadence failure is asserted during the quiet stretch — the floor applies only while the producer emits. See `tests/e2e/subagent-tick-throttle.spec.ts` (test-plan: automated)

## 6. Ship the default and re-measure

- [ ] 6.1 Flip the shipped `subagentTickThrottleMs` default to `500` once §3–§5 are green
- [ ] 6.2 Re-run the §2 measurement with the default ON and record the before/after in `measurement.md`; restate the proposal's benefit claim in the units the measurement actually supports (frames/s, bytes/s)
- [ ] 6.3 Update the affected directory `AGENTS.md` rows (`packages/extension/src/`, `packages/shared/src/`, `tests/e2e/`, `qa/fixtures/`) and delegate any `docs/` prose to DocScribe

## 7. Manual verification (post-merge)

- [ ] 7.1 Watch a live subagent with the throttle ON at 500 ms and confirm it still reads as "alive" with no perceptible stutter versus throttle OFF (test-plan: manual-only)
- [ ] 7.2 Reload mid-run and confirm the replayed timeline does not visibly lag the live card (test-plan: manual-only)
