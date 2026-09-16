# Tasks — bound-subagent-fanout-under-host-pressure

Test tasks are folded from `test-plan.md`; each carries its manifest id, the
scenario Triple, and the nearest existing test to copy harness glue from.

## 1. Measurement gate (blocks every later group)

- [ ] 1.1 Build the fan-out measurement harness: drives N `Agent` children from a parent with a controlled context size under a controlled host load, recording parent `eventLoopMaxMs`, time-to-first-child-start, and survival per cell. Verify by producing a complete result table for one cell end to end.
- [ ] 1.2 Run the matrix N ∈ {1,2,3,4,7} × ctx ∈ {small, ~220 k} × host ∈ {idle, loaded} and record the table verbatim in `design.md` under Decision 1 (test-plan #P1, level L2; exemplar `qa/tests/33-mcp-session-token.sh` for the shell harness shape). Triple: fan-out of width N from a parent at ctx under host load · batch dispatched · parent `eventLoopMaxMs`, time-to-first-child-start and survival recorded per cell.
- [ ] 1.3 Read the table against Decision 1's three branches and record the verdict in `design.md`. If the stall scales with ctx rather than N, STOP and re-target the change — do not proceed to group 2. Verify: `design.md` states which branch the data supports and why.
- [ ] 1.4 Pick the default cap from the table (must be ≥ 2 and < 3 per the spec property, i.e. below every census fatal width) and record the justification alongside the table.

## 2. Configuration

- [ ] 2.1 Add `maxConcurrentSubagents` (default from 1.4) and the saturation thresholds — event-loop delay, CPU share, load average, each optional with its measured domain documented — to `packages/shared/src/config.ts` beside `subagentTickThrottleMs`. Verify with a config-resolution test.
- [ ] 2.2 Test: absent config resolves to an active default (test-plan #E8, level L1; exemplar `packages/extension/src/__tests__/subagent-tick-throttle.test.ts`). Triple: no admission config · resolve config then request cap+1 calls · resolved default is defined, ≥ 2 and < 3, and the excess is refused.
- [ ] 2.3 Test: malformed config fails open (test-plan #E9, level L1). Triple: `maxConcurrentSubagents` = `-1`, `1.5`, `"two"`, `null` · a call is decided for each · every verdict is admit — malformed is neither disabled nor refuse.

## 3. Saturation sampler

- [ ] 3.1 Implement a private saturation sampler in `packages/extension/src/`: own event-loop-delay monitor over a fixed 5 s rolling window plus own CPU baseline; never calls `collectMetrics()`. Verify with the tests below.
- [ ] 3.2 Test: reading saturation does not corrupt telemetry (test-plan #X5, level L1). Triple: admission reads saturation repeatedly between two heartbeats · heartbeat samples `collectMetrics()` · reported `eventLoopMaxMs`/`cpuPercent` still cover the full inter-heartbeat interval.
- [ ] 3.3 Test: the reading is independent of the telemetry cycle (test-plan #X6, level L1). Triple: machine under sustained load · read immediately after a heartbeat and again just before the next · both report saturation and the effective cap is identical at both points.
- [ ] 3.4 Test: hysteresis — enter at threshold, leave below 80 % of it (test-plan #E12, level L1). Triple: entry threshold `T` with the narrowed state active · readings at `0.99T`, `0.85T`, `0.81T`, `0.79T` · stays narrowed for the first three, returns to cap `N` only at `0.79T`.
- [ ] 3.5 Test: a missing metric is not saturation (test-plan #E13, level L1). Triple: event-loop reading `undefined`, all others below threshold · a call is decided below cap · verdict is admit.
- [ ] 3.6 Test: metric domains are independent (test-plan #E14, level L1). Triple: process-local CPU low but machine load above its threshold · a call is decided with one child in flight · verdict is refuse.

## 4. Admission decision function

- [ ] 4.1 Implement the pure decision function in `packages/extension/src/subagent-fanout-admission.ts`: in-flight count + saturation reading + config → admit or refuse with a reason. No awaiting, no delay, no child state consulted. Verify with the tests below.
- [ ] 4.2 Test: calls up to the cap are admitted untouched (test-plan #E1, level L1). Triple: cap `N`=2, in-flight 0 · two calls decided in sequence · both admit, inputs byte-identical.
- [ ] 4.3 Test: calls beyond the cap are refused without incrementing (test-plan #E2, level L1). Triple: cap `N`=2, in-flight 2, none finished · a third call decided · refuse, in-flight count still 2.
- [ ] 4.4 Test: admission below the cap increments (test-plan #E3, level L1). Triple: cap `N`=2, in-flight 1 · a call decided · admit, count becomes 2.
- [ ] 4.5 Test: the count rises at admission, not at execution (test-plan #E4, level L1). Triple: cap `N`=2, in-flight 0 · four calls decided back-to-back with zero `tool_execution_end` between them · exactly two admits then two refuses.
- [ ] 4.6 Test: saturation floors the cap at 1, never 0 (test-plan #E10, level L1). Triple: saturation above threshold, in-flight 0 · a call decided · admit.
- [ ] 4.7 Test: saturation refuses the second child and names the cause (test-plan #E11, level L1). Triple: saturation above threshold, in-flight 1 · a call decided · refuse with a reason naming resource saturation.
- [ ] 4.8 Test: a disabled gate is an exact no-op (test-plan #E7, level L1). Triple: `maxConcurrentSubagents: 0`, in-flight 50, saturation above every threshold · a call decided · admit, no delay, no durable write.
- [ ] 4.9 Test: the decision never waits on a child (test-plan #X3, level L1). Triple: every admitted child hangs with no terminal signal · a further call is decided · a verdict returns promptly without consulting any child state. Deadlock regression guard.
- [ ] 4.10 Test: admission decision latency (test-plan #P2, level L1). Triple: 1000 admit decisions · measured · p95 < 1 ms and p99 < 5 ms.

## 5. Wiring into the bridge

- [ ] 5.1 Register the `tool_call` handler for `toolName === "Agent"` in the bridge, **after** the bridge's existing `tool_call` forwarder, since `emitToolCall` returns on the first `{block:true}` and would otherwise starve the forwarder. Refuse via `{ block: true, reason }` and never set `terminate`.
- [ ] 5.2 Release the permit on `tool_execution_end`, keyed to the set of `toolCallId`s this gate actually admitted — never on `tool_result`, which an aborted call skips.
- [ ] 5.3 Wrap every path so any failure admits, and verify nothing propagates out of the handler.
- [ ] 5.4 Test: a cancelled child frees capacity (test-plan #X1, level L1). Triple: run aborted mid-fan-out so pi emits `tool_execution_end` but no `tool_result` · abort after `N` admissions · in-flight count returns to 0 and a subsequent call is admitted. This is the regression guard against keying release on `tool_result`.
- [ ] 5.5 Test: finished children free capacity (test-plan #E5, level L1). Triple: cap `N`=2, in-flight 2 · `tool_execution_end` for one admitted id, then a new call · count drops to 1 and the next verdict is admit.
- [ ] 5.6 Test: a refused call's `tool_execution_end` returns no permit (test-plan #E6, level L1). Triple: cap `N`=2, in-flight 2, one call already refused · `tool_execution_end` arrives for the refused id · count stays 2.
- [ ] 5.7 Test: gate failure fails open (test-plan #X2, level L1). Triple: the decision path raises · a call is decided · verdict is admit and nothing propagates out of the handler.
- [ ] 5.8 Test: a refusal does not terminate the agent (test-plan #X7, level L1). Triple: a batch where every call is refused · verdicts finalized · no verdict sets `terminate` and the session continues accepting work.

## 6. Observability

- [ ] 6.1 Add `fanoutAdmitted` / `fanoutRefused` / `fanoutSaturationRefused` to the `processMetrics` payload in `packages/shared/src/protocol.ts` and populate them from the bridge. Verify with a counter-propagation test.
- [ ] 6.2 Write each refusal as a durable session entry via `appendEntry` with customType `subagent-admission-refused`, carrying the cause (static cap vs saturation). Admissions write nothing.
- [ ] 6.3 Test: the admit path performs no durable write (test-plan #P3, level L1). Triple: 100 admitted calls · measured · zero durable-entry writes observed.
- [ ] 6.4 Test: refusals survive process death (test-plan #X4, level L2; exemplar `qa/tests/33-mcp-session-token.sh`). Triple: a session refuses at least one call then is `SIGKILL`ed · inspect the session record afterwards · every refusal is present as a `subagent-admission-refused` entry with its cause distinguishable.

## 7. Dashboard-visible behaviour

- [ ] 7.1 Test: a refused call's card is terminal, never spinning (test-plan #F1, level L3; exemplar `tests/e2e/session-ended-orphan-heal.spec.ts`). Triple: a session at the cap · an `Agent` call is refused · its tool card converges to a terminal error state, asserted against the harness `dashboardPort` from `.pi-test-harness.json`.
- [ ] 7.2 Test: the refusal stays terminal across replay (test-plan #F2, level L3; exemplar `tests/e2e/custom-entry-replay-parity.spec.ts`). Triple: a session with one refused call · reload the session view · the refused call renders terminal after replay.
- [ ] 7.3 Test: the gate does not short-circuit the bridge's `tool_call` forwarder (test-plan #F3, level L3; exemplar `tests/e2e/session-ended-orphan-heal.spec.ts`). Triple: gate registered alongside the forwarder · an `Agent` call is refused · the dashboard still receives that call's `tool_call`, so live view and transcript agree.
- [ ] 7.4 Test: the durable refusal entry renders through the existing custom-entry path (test-plan #F4, level L3; exemplar `tests/e2e/custom-entry-fallback.spec.ts`). Triple: a refusal written as `subagent-admission-refused` · view the session · the entry renders without breaking the transcript.

## 8. Validate the mitigation

- [ ] 8.1 Re-run the P1 cell that killed the parent, with the gate active at the chosen default (test-plan #P4, level L2). Triple: the fatal cell re-run with admission enabled · batch dispatched · the parent survives and `eventLoopMaxMs` is strictly below the ungated run in the same cell.
- [ ] 8.2 Record the before/after numbers in `design.md`. If the stall did not move, say so plainly rather than shipping the cap as a fix.

## 9. Documentation

- [ ] 9.1 Add the `subagent-fanout-admission.ts` row to `packages/extension/src/AGENTS.md` and update the saturation-sampler rows.
- [ ] 9.2 Add a `docs/faq.md` entry for "session dies whenever it spawns subagents" and a fan-out paragraph in `docs/architecture.md` (delegate the prose to DocScribe per the repo's docs rule).
