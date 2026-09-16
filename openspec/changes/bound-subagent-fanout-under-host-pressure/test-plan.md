# Test Plan — bound-subagent-fanout-under-host-pressure

Stage: design   Generated: 2026-09-16

HARD gate cleared: 4 clarifications resolved before writing (5 s rolling window;
hysteresis exit at 80 % of entry threshold; customType
`subagent-admission-refused`; default cap asserted as a property — defined, ≥ 2,
< 3).

Symbols: `N` = effective cap. Scenarios never hard-code 3 as a cap — that is a
census fatal width, and blessing it in a test would enshrine non-protection.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Concurrent children bounded | BVA | L1 | automated | cap `N`=2, in-flight 0 | 2 `Agent` calls decided in sequence | both verdicts `admit`; inputs byte-identical to the originals |
| E2 | Concurrent children bounded | BVA | L1 | automated | cap `N`=2, in-flight 2, none finished | 3rd `Agent` call decided | verdict `refuse`; in-flight count still 2 (no increment on refusal) |
| E3 | Concurrent children bounded | BVA | L1 | automated | cap `N`=2, in-flight 1 | `Agent` call decided | verdict `admit`; in-flight count becomes 2 |
| E4 | Counted from admission, not execution | state-transition | L1 | automated | cap `N`=2, in-flight 0 | 4 calls decided back-to-back with **zero** `tool_execution_end` between (models sequential preflight) | exactly 2 `admit` then 2 `refuse` — proves the count rises at admission, not at execution |
| E5 | Finished children free capacity | state-transition | L1 | automated | cap `N`=2, in-flight 2 | `tool_execution_end` for one admitted `toolCallId`, then a new call | count drops to 1; next verdict `admit` |
| E6 | Release keyed to admitted ids | decision-table | L1 | automated | cap `N`=2, in-flight 2, one call already refused | `tool_execution_end` arrives for the **refused** `toolCallId` | in-flight count stays 2 (a refusal never took a permit, so it cannot return one) |
| E7 | Disabled is an exact no-op | decision-table | L1 | automated | `maxConcurrentSubagents: 0`, in-flight 50, saturation above every threshold | `Agent` call decided | verdict `admit`; no delay introduced; no durable entry written |
| E8 | Absent config is active | EP | L1 | automated | no admission config | resolve config, then request cap+1 calls | resolved default is defined, ≥ 2 and < 3; the excess is refused |
| E9 | Malformed config fails open | EP (invalid partitions) | L1 | automated | `maxConcurrentSubagents` = `-1`, `1.5`, `"two"`, `null` | `Agent` call decided for each | every verdict `admit` (malformed ≠ disabled, malformed ≠ refuse) |
| E10 | Saturation narrows to 1, never 0 | BVA | L1 | automated | saturation above threshold, in-flight 0 | `Agent` call decided | verdict `admit` (the first child always gets through — the cap floors at 1, never 0) |
| E11 | Saturation narrows to 1 | BVA | L1 | automated | saturation above threshold, in-flight 1 | `Agent` call decided | verdict `refuse`; reason names resource saturation |
| E12 | Hysteresis | BVA | L1 | automated | entry threshold `T`, narrowed state active | readings at `0.99T`, `0.85T`, `0.81T`, `0.79T` | stays narrowed for the first three; returns to cap `N` only at `0.79T` (below 80 % of `T`) |
| E13 | A missing metric is not saturation | decision-table | L1 | automated | event-loop reading `undefined`, all other readings below threshold | `Agent` call decided below cap | verdict `admit` (absent signal ≠ pressure) |
| E14 | Metric domains are declared | decision-table | L1 | automated | process-local CPU low, machine load above its threshold | `Agent` call decided with in-flight 1 | verdict `refuse` — the machine-domain metric fires independently of the process-domain one |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Measurement gate (Decision 1) | threshold matrix | L2 | automated | fan-out N ∈ {1,2,3,4,7} × ctx ∈ {small, ~220 k} × host ∈ {idle, loaded} | parent `eventLoopMaxMs`, time-to-first-child-start, survival — recorded per cell | per-cell run |
| P2 | Admission adds no delay | tail-latency | L1 | automated | 1000 admit decisions | p95 decision latency < 1 ms, p99 < 5 ms | single run |
| P3 | Admit path does no I/O | invariant | L1 | automated | 100 admitted calls | zero durable-entry writes observed | single run |
| P4 | Mitigation actually moves the stall | threshold | L2 | automated | the P1 cell that killed the parent, re-run with the gate active at the chosen default | parent survives; `eventLoopMaxMs` strictly below the ungated run in the same cell | per-cell run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Refusal closes the card | state-transition | L3 | automated | session at the cap | an `Agent` call is refused | its tool card converges to a terminal error state — never left running; asserted against the harness `dashboardPort` from `.pi-test-harness.json` |
| F2 | Refusal survives replay | state-transition | L3 | automated | a session with one refused call | reload the session view | the refused call renders terminal after replay, not running |
| F3 | Gate does not short-circuit the bridge forwarder | state-transition | L3 | automated | gate registered alongside the bridge `tool_call` forwarder | an `Agent` call is refused | the dashboard still receives that call's `tool_call` — live view and transcript agree (guards `emitToolCall` returning on the first `{block:true}`) |
| F4 | Durable entry renders | state-transition | L3 | automated | a refusal written as `subagent-admission-refused` | view the session | the entry renders through the existing `custom_entry` path without breaking the transcript |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | A cancelled child frees capacity | fault-injection (abort) | L1 | automated | run aborted mid-fan-out; pi emits `tool_execution_end` but **no** `tool_result` | abort after `N` admissions | in-flight count returns to 0; a subsequent call is admitted. **The regression guard for keying release on `tool_result`** |
| X2 | Gate failure fails open | fault-injection | L1 | automated | decision path raises | `Agent` call decided | verdict `admit`; nothing propagates out of the handler (a throw would make pi refuse every `Agent` call) |
| X3 | Never waits on a child | fault-injection (stall) | L1 | automated | every admitted child hangs, producing no terminal signal | a further call is decided | a verdict returns promptly without consulting any child's state — deadlock regression guard |
| X4 | Refusal survives process death | fault-injection (kill) | L2 | automated | session refuses ≥ 1 call, then `SIGKILL` | inspect the session record afterwards | every refusal is present as a `subagent-admission-refused` entry, with its cause (static cap vs saturation) distinguishable |
| X5 | Saturation read does not corrupt telemetry | fault-injection (interleave) | L1 | automated | admission reads saturation repeatedly between two heartbeats | heartbeat samples `collectMetrics()` | reported `eventLoopMaxMs` / `cpuPercent` still cover the full inter-heartbeat interval |
| X6 | Reading independent of telemetry cycle | state-transition | L1 | automated | machine under sustained load | read saturation immediately after a heartbeat and again just before the next | both readings report saturation; the effective cap is identical at both points |
| X7 | Refusal does not terminate the agent | fault-injection | L1 | automated | a batch where every call is refused | verdicts finalized | no verdict sets `terminate`; the session continues accepting work |

---

## Coverage summary

- Requirements covered: 8/8
- Scenarios by class: edge 14 · perf 4 · frontend 4 · error 7
- Scenarios by level: L1 20 · L2 3 · L3 4
- Scenarios by disposition: automated 29 · manual-only 0

## New infra needed

- **P1/P4 measurement harness** — a repeatable fan-out driver that controls
  parent context size, fan-out width, and host load, and records parent
  `eventLoopMaxMs` / time-to-first-child-start / survival. No existing level
  provides this; it is the change's gating deliverable, not a smoke test.
- Everything else reuses existing levels: vitest (L1), `qa/tests/*.sh` (L2),
  `tests/e2e/*.spec.ts` against the docker harness (L3).
