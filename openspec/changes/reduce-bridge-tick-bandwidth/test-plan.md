# Test Plan — reduce-bridge-tick-bandwidth

Stage: design   Generated: 2026-03-30

HARD gate cleared: four spec gaps (e2e config injection, counter transport
ownership, key TTL value, staleness tolerance) were resolved via `ask_user` and
folded into `design.md` + `specs/subagent-live-cadence/spec.md` before this
catalog was written. No open `[NEEDS CLARIFICATION]` markers remain.

Throttle unit under test = the per-`toolCallId` coalescer in
`packages/extension/src/` (new module, consumed by `bridge.ts:1902`).
Window `W` = `subagentTickThrottleMs` = 500 ms unless a row says otherwise.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | cadence floor / D3 leading edge | BVA | L1 | automated | throttle with `W=500`, no prior tick for `tc1` | first Agent tick arrives at t=0 | forwarded synchronously (0 delay), `tickForwarded=1`, `tickCoalesced=0` |
| E2 | cadence floor / D3 latest-wins | EP | L1 | automated | ticks A,B,C for `tc1` at t=0,100,200 ms | timer fires at t=500 | exactly 2 sends total (A at t=0, C at t=500); B never sent; `tickCoalesced=1` |
| E3 | cadence floor / D3 window boundary | BVA | L1 | automated | tick A at t=0, tick B at t=**W** exactly | B arrives at the boundary | B forwarded on the leading edge (not held), no timer left armed |
| E4 | cadence floor / D3 window boundary | BVA | L1 | automated | tick A at t=0, tick B at t=**W−1** | B arrives just inside | B held; sent at t=W; single trailing send |
| E5 | D4 config `0` disables | decision-table | L1 | automated | `subagentTickThrottleMs=0`, 50 ticks in 100 ms | all ticks arrive | all 50 forwarded, `tickCoalesced=0` (byte-identical rollback path) |
| E6 | catch-all MODIFIED / D2 predicate | decision-table | L1 | automated | 4 update shapes: (Agent+agentId), (Agent, no agentId), (Bash+agentId-lookalike), (Bash, plain string partial) | each forwarded | only shape 1 is throttled; shapes 2–4 pass 1:1 |
| E7 | D2 per-`toolCallId` keying | EP | L1 | automated | two concurrent Agent runs `tc1`,`tc2` ticking at 10 Hz | 2 s of interleaved ticks | each key throttled independently at ~2 Hz; no cross-suppression |
| E8 | D3 idle TTL bound | BVA | L1 | automated | key for `tc1` whose `tool_execution_end` never arrives | 60 s + 1 tick of fake-timer advance | key swept; map size returns to 0; no timer left armed |
| E9 | D3 idle TTL bound (negative) | BVA | L1 | automated | key for `tc1` ticking every 30 s | 90 s of fake-timer advance | key NOT swept (TTL is idle-based, not absolute); ticks still forwarded |
| E10 | catch-all MODIFIED 1:1 for others | EP | L1 | automated | one `message_update`, one `tool_execution_start`, one `tool_call` burst | forwarded through the enriched loop | every event forwarded 1:1, unaffected by throttle state |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | D1 baseline / proposal benefit claim | threshold | L3 | automated | SYNTHETIC producer (`[[faux:synthetic-agent-ticks]]`, 240@50ms≈20fps), throttle ON (`W=500`), `PI_SYNTH_AGENT_TICKS=1` arm | Agent-tick frames on `/ws` (filtered `toolName==="Agent"`): mean ≤ 2.2 frames/s over the whole window, NOT per-1 s bucket | ≥ 10 s |
| P2 | D1 baseline / kill switch | threshold | L3 | automated | same synthetic producer, throttle OFF (`W=0`) | Agent-tick frames/s ≥ 4× the P1 rate — proves the reduction is real and the producer actually streams | ≥ 10 s |
| P3 | spec: delivered-tick staleness | tail-latency | L3 | automated | synthetic producer, throttle ON | gap between consecutive DELIVERED Agent ticks on `/ws`: p95 ≤ 1.5W, max ≤ 3W (measured on the wire, not stored/replay — the parent collapse change trims superseded stored updates, so replay cannot carry the cadence) | ≥ 10 s |
| P4 | proposal: F4 non-vacuity preserved | threshold | L3 | automated | SUBSUMED by F1 on the synthetic arm (≥ 5 Agent ticks under throttle > P4's ≥ 2); real-fixture version not constructible (nested faux subagent dies, Bug 2) | — | — |
| P5 | D3 no unbounded state | soak | L1 | automated | 500 sequential Agent runs, each ending normally | throttle map size returns to 0 after each run; peak ≤ 2 keys | in-process |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | spec: cadence floor on its own carrier | state-convergence | L3 | automated | SYNTHETIC producer (`PI_SYNTH_AGENT_TICKS=1` arm), throttle ON | count Agent-tick frames received by the browser | ≥ 5 frames in the 10 s window (≥ 1 per 2 s) |
| F2 | spec: no held tick after terminal | state-transition (illegal edge) | L3 | automated | subagent run ending while a tick is pending | `tool_execution_end` forwarded for `tc1` | no `tool_execution_update` for `tc1` observed on `/ws` after its end frame; the tool row never re-enters a running/partial render |
| F3 | spec: reload folds to terminal | state-transition | L3 | automated | finished subagent run, throttle ON | page reload | timeline renders the terminal snapshot; entry count equals the pre-reload terminal count |
| F4 | D5 sibling non-interaction | state-transition | L3 | automated | running subagent, inspector opened so a resync fires | `subagent_resync_request` round-trip | the synthetic `subagents:started` reply arrives unthrottled and uncoalesced (throttle counters unchanged by it) |
| F5 | D4a producer-conditioned floor | state-transition | L3 | automated | `[[faux:synthetic-agent-ticks-quiet]]` (a > 2 s gap before tick 30) | observe the gap | NO cadence failure is asserted during the quiet stretch — the floor applies only while the producer emits (anti-vacuity guard on F1's fixture choice) |
| F6 | UX trade: perceived liveness | subjective | — | manual-only | running subagent, throttle ON at 500 ms | a human watches the live card + inspector | [judgment: still reads as "alive"; no perceptible stutter vs. throttle OFF] |
| F7 | UX trade: mid-run reload freshness | subjective | — | manual-only | running subagent, reload mid-run | a human watches the refresh | [judgment: the timeline after reload does not visibly lag the live card] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | D3 fire-time gating (`sessionReady`) | fault-injection | L1 | automated | `sessionReady` flips false while a tick is pending | trailing timer fires | nothing sent; `tickDroppedNotReady=1`; no throw into the emitter |
| X2 | D3 fire-time gating (`isActive`) | fault-injection | L1 | automated | a newer bridge instance takes over while a tick is pending | trailing timer fires | nothing sent by the superseded instance; `tickDroppedNotReady=1` |
| X3 | D3 fire-time gating (sessionId drift) | fault-injection | L1 | automated | session changes (new `sessionId`) while a tick is pending | trailing timer fires | the stale-session frame is not sent |
| X4 | D3 session lifecycle disposal | state-transition | L1 | automated | 3 pending keys with armed timers | session change, then session shutdown | all timers cleared, map emptied, nothing sent afterwards |
| X5 | D3 connection loss retention | fault-injection (abort) | L1 | automated | connection drops, then reconnects, with a tick pending | trailing timer fires after reconnect | the frame is sent over the LIVE connection, not a captured stale reference |
| X6 | D3 terminal with a pending tick | state-transition (illegal edge) | L1 | automated | tick pending for `tc1` | `tool_execution_end` for `tc1` | pending discarded (not flushed), timer cleared, key deleted, `tickDiscardedAtTerminal=1` — and removing the discard makes this row fail (anti-vacuity) |
| X7 | D6 counter transport | fault-injection | L3 | automated | subagent run with throttle ON | `GET /api/health` after the run | throttle counters present and non-zero; existing health fields unchanged (exact-shape assertions updated in the same commit) |
| X8 | D6 predicate tripwire | fault-injection | L3 | automated | a session running only non-subagent tools (Bash streaming) | `GET /api/health` | `tickForwarded`/`tickCoalesced` stay 0 — a mis-scoped predicate is visible as movement here |

---

## Coverage summary

- Requirements covered: 2/2 spec requirements (subagent-live-cadence ADDED,
  catch-all-event-forwarding MODIFIED) + 5 design decisions with testable
  observables (D2 predicate, D3 lifecycle, D4 config, D5 non-interaction, D6
  counters)
- Scenarios by class: edge 10 · perf 5 · frontend 7 · error 8 (30 total)
- Scenarios by level: L1 18 · L2 0 · L3 10 · — 2
- Scenarios by disposition: automated 28 · manual-only 2

L2 is empty deliberately: nothing here is per-OS or install/process shaped, and
every rendered/wire observable belongs in Playwright per the level boundary.

## New infra needed

- **RESOLVED — a SYNTHETIC Agent-tick producer** (`qa/fixtures/faux-agent-ticks.ext.ts`),
  not a nested faux subagent. A nested faux subagent cannot sustain a ≥ 10 s tick
  stream: its inner `createAgentSession` resolves a different faux core with an
  empty response queue and dies after ~2 no-op turns (see `measurement.md`,
  Bug 2). The bridge throttle keys only on `toolName`+`agentId`, so the synthetic
  `Agent` tool (streaming `tool_execution_update` at a `[[ticks:N@Mms]]` cadence)
  is a faithful, fully deterministic substrate for the cadence rows
  (F1/P1/P2/P3/F5). Proven: OFF 19.6 fps → ON(500) 2.00 fps on `/ws`.
- **The `PI_SYNTH_AGENT_TICKS=1` harness arm** (`docker/compose.test.yml` +
  `docker/test-entrypoint.sh`): stages the synthetic producer and SKIPS the
  subagents producer, so the synthetic `Agent` owns the tool name
  (first-registration-wins). The cadence spec `tests/e2e/subagent-tick-throttle.spec.ts`
  self-skips unless the Playwright process also carries `PI_SYNTH_AGENT_TICKS=1`,
  and runs on its own harness bring-up (the other subagent specs keep the real
  subagents harness).
- **Harness config injection**: the e2e harness must write the dashboard config
  file (carrying `subagentTickThrottleMs`) into the container before the pi
  session starts — decided at the HARD gate; no env override is added.
- **Bridge→server counter transport to `/api/health`** — does not exist today
  (`SubagentFrameBuffer.stats` is only `console.log`ged); X7/X8 depend on it and
  it is in scope for this change.
