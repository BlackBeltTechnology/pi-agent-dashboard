# Test Plan — verify-subagent-pull-under-load

Stage: design   Generated: 2026-08-27

No open clarifications — the three decision-forcing gaps (P5 watch pattern, X1
expected render, P4 inconclusive handling) were answered and folded into
`design.md` (V4, V5, V6).

Requirement refs:

- **R1** — the open-inspector pull path SHALL be verified against a watched,
  growing timeline (spec scenarios F1 / P4 / P5).
- **R2** — the crash-without-terminal-frame regression SHALL be pinned (spec
  scenario X1).

The harness arm for every L3 row is
`PI_E2E_SEED=1 PI_TEST_PEERS=both PI_SYNTH_AGENT_TICKS=1 ./docker/test-up.sh -d`,
read against the derived `dashboardPort` in `.pi-test-harness.json` — never
`:18000`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 (substrate) | BVA | L1 | automated | prompt with no `[[entries:]]` sentinel | `parseTickPlan`-equivalent parse of the growth plan | growth plan absent; every frame carries `entries: []` — byte-identical to today's fixture |
| E2 | R1 (substrate) | BVA | L1 | automated | `[[entries:5..30]]`, `[[entries:0..0]]`, `[[entries:30..5]]` (start>end), `[[entries:x..y]]` (malformed), `[[entries:1..99999999]]` | parse | 5..30 accepted; 0..0 yields an always-empty timeline; start>end and malformed fall back to the no-growth default; the count clamps at the fixture's `MAX_TICKS`-style bound (no unbounded loop) |
| E3 | R1 (substrate) | decision-table | L1 | automated | each emitted bus frame (`created`, `started`, `completed`) | frame construction | top-level `data.id === details.agentId` on ALL three — the key `SubagentFrameBuffer.agentIdOf` reads; a frame keyed only inside `details` is rejected by the test |
| E4 | R1 (substrate) | decision-table | L1 | automated | the `subagents:created` frame | frame construction | `details.entries` is empty. `"created"` is NOT in `NON_TERMINAL_STATUSES` (`queued`/`running`), so a fat `created` frame would forward unstripped and silently defeat F2 |
| E5 | pipeline invariant | state-transition | L1 | automated | the full frame sequence for one run with `[[entries:5..30]]` | replay the sequence | every frame's `entries` is a FULL snapshot and a prefix-superset of its predecessor (`entries[i]` never mutates, length is monotone non-decreasing) — no delta encoding leaked in |
| E6 | R1 (substrate) | BVA | L1 | automated | `[[bus:]]` absent / `[[bus:250]]` / `[[bus:0]]` / `[[bus:999999]]` | parse | default is 250 ms (matches the real producer's `PROGRESS_THROTTLE_MS`); 0 and out-of-range clamp; the bus interval is INDEPENDENT of the tick interval |
| E7 | no-regression | state-transition | L3 | automated | the existing `synthetic-agent-ticks` / `-quiet` scenarios (no new sentinels) | run `subagent-tick-throttle.spec.ts` unchanged on the same arm | every existing throttle row still passes and observes no `subagents:*` bus traffic — the new emission is fully sentinel-gated |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R1 / spec F1 | state-convergence | L3 | automated | `[[entries:5..30]]` run, inspector mounted before the DOM shows any entry, never closed | timeline grows to 30 and then PLATEAUS while the agent keeps emitting running frames for ≥ 3 cadence intervals (≥ ~6 s) | the RENDERED entry count reaches 30 **while the agent is still non-terminal** (no `subagents:completed` / `tool_execution_end` for that `agentId` observed yet), with no close/reopen and no reload |
| F2 | R1 (V2 guard 1) | invariant | L3 | automated | same run | every `/ws` frame for the watched `agentId` WITHOUT `__resyncRequestId`, while non-terminal | carries no `entries` key, or an empty one — the push path is provably thin |
| F3 | R1 (V2 guard 2) | invariant | L3 | automated | same run | at least one `/ws` frame WITH `__resyncRequestId` | carries a NON-empty `entries` — the pull path is provably fat and identifiable |
| F4 | R1 (anti-vacuity) | invariant | L3 | automated | same run on a SEPARATE harness start with `PI_DASHBOARD_SUBAGENT_STRIP=0` | same observation as F2 | F2's assertion INVERTS (pushes are fat). A non-inverting arm means the env switch is unwired and every measurement below is one arm measured twice |
| F5 | R1 / spec F1 (carrier attribution) | state-transition | L3 | automated | outgoing frames captured via `ws.on("framesent")` | the cadence fires while the inspector stays mounted | ≥ 1 outgoing `subagent_resync_request` with `reason: "cadence"`; the reply that carried ≥ 30 entries has `__resyncRequestId` EQUAL to that request's `requestId` — token equality, not ordering |
| F6 | R1 / spec F1 (open-time exclusion) | state-transition | L3 | automated | the `reason: "open"` requests (expand/popout + `App.tsx` subscribe — all three DO fire, because the rendered timeline is empty at mount) | last `open` request observed on `framesent` | the DOM passes a count STRICTLY GREATER than the timeline could hold at that request's bridge-handling time (request time + one bus interval + RTT slack) — an open-time reply cannot deliver a count that did not exist yet |
| F7 | R1 (illegal edge) | state-transition | L3 | automated | the same run, allowed to complete | terminal `subagents:completed` arrives after the plateau | the rendered count stays 30 — the terminal frame does not regress or duplicate the timeline |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | R1 / spec P4 (prereq) | threshold | L3 | automated | N browser contexts subscribed to one session, N increasing | the largest N at which added contexts do not degrade observed frame delivery — the harness ceiling | per-N run until the rate flattens |
| P2 | R1 / spec P4 | A/B byte-rate | L3 | automated | `[[entries:5..30]][[bus:250]]`, N inspectors held open (N from P1), 2 separate harness starts (strip ON / `PI_DASHBOARD_SUBAGENT_STRIP=0`), each arm ≥ 3 runs | per-subscriber `__resyncRequestId` bytes/s (pull) ≤ subagent-carrying bytes/s across BOTH carriers excluding `__resyncRequestId` frames (push), median of ≥ 3 | the plateau window of each run |
| P3 | R1 / spec P4 (validity) | sensitivity | L3 | automated | P2 repeated at a faster and a slower `[[bus:]]` interval | the pull/push ratio as a function of bus cadence | same window | 
| P4 | R1 / spec P5 | measurement | L3 | automated | four arms, each in its OWN browser context (`__piSubagentInspectorTelemetry()` is a page-global cumulative aggregate and `resetInspectorTelemetry` is not on `globalThis`): never-opened; open@25 % hold 25 %; open@25 % hold 50 %; open-before-first-entry never-closed | inspector-open share ≈ 0 % / 25 % / 50 % / 100 % respectively, each recorded WITH its pattern and run length | one full subagent run per arm |

Verdict handling (from `design.md` V5/V6):

- P2 exceeding its bound → file the D4 v2 escalation as a follow-up change; do
  NOT tune the cadence here.
- P2 falling INSIDE the run-to-run spread → record **INCONCLUSIVE**; this is a
  shippable outcome, since the measurement infrastructure is the deliverable.
- P4's 50 % arm sits ON the C4 boundary by construction, so a > 50 % reading is
  reported as the C4 kill-switch condition **only together with its pattern**.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R2 / spec X1 | fault-injection (abort) | L3 | automated | pi process killed mid-run | `force_kill` on the browser socket while the tick plan is unexhausted, then the session is replayed | the subagent renders its SCALAR state, NO mid-run timeline is shown, and the card is neither blank nor error-rendered. Whatever badge/finalize state the stuck-card supersede-heal produces is RECORDED on the first run and pinned as the baseline |
| X2 | R2 (X1 precondition) | invariant | L3 | automated | none — setup validity | the run is driven via the API with the session NEVER selected in the client | ZERO outgoing `subagent_resync_request` for that `agentId` before the kill. A single resync would store a FAT reply (`event_forward` → `insertEvent`, replies are never stripped) and fail X1 for a reason unrelated to the regression |
| X3 | R2 (X1 decidability) | invariant | L3 | automated | the post-kill replay stream (the stored events the server re-sends on subscribe — there is no list-events endpoint; `GET /api/events/:sessionId/:seq` returns one event by exact seq) | subscribe after the kill | no `subagent_completed` / `subagent_failed` / `tool_execution_end` for that `agentId`, and no stored frame carrying `entries` for it. The tick index is read from the replayed `(running… i)` content — NOT live, since live observation requires subscribing, which fires the `App.tsx` open-resync X2 forbids |
| X4 | R2 (fallback) | fault-injection (abort) | L3 | automated | `force_kill` turns out to flush a terminal frame into the store | X3 fails | escalate to a container-level `SIGKILL` of the pi PID; the mechanism actually used is recorded in `heap-evidence.md` |
| X5 | R2 / spec X1 ("neither corrupt") | visual/subjective | — | manual-only | the replayed card | a human looks at it | [judgment: "not corrupt" beyond the automatable checks in X1 — no automatable observable] |

### Reporting

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | R1 / spec P5 + P4 | review | — | manual-only | `heap-evidence.md` | a human reads the finished evidence file | [judgment: every number is reported WITH its watch pattern / bus cadence / arm, the fidelity boundary of the synthetic substrate is stated, and the archived parent evidence is cross-referenced by path and NOT edited] |

---

## Coverage summary

- Requirements covered: 2/2 (R1 via E1–E7, F1–F7, P1–P4, M1; R2 via X1–X5)
- Scenarios by class: edge 7 · perf 4 · frontend 7 · error 5 · reporting 1
- Scenarios by level: L1 6 · L2 0 · L3 16 · — 2
- Scenarios by disposition: automated 22 · manual-only 2

## New infra needed

- None architecturally new. Extensions to existing infra only: the
  `[[entries:]]` / `[[bus:]]` sentinels on `qa/fixtures/faux-agent-ticks.ext.ts`,
  a `PI_DASHBOARD_SUBAGENT_STRIP` passthrough in `docker/compose.test.yml` +
  `docker/test-entrypoint.sh`, and a `collectAgentTicks` generalization
  (classify `subagent_*` frames, capture `__resyncRequestId`, capture outgoing
  frames via `framesent`, and attribute bytes PER FRAME rather than per event
  inside a batch — the current helper over-counts batches N×).
