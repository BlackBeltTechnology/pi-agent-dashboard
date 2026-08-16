# verify-subagent-pull-under-load

## Why

`reduce-subagent-details-payload` shipped the push/pull split for subagent
timelines. Four of its manifest scenarios were **not** verified by what landed,
because none of them is observable on the current faux harness: its spawned
subagent completes in ~600 ms, so there is never a mid-run window in which a
timeline grows while somebody watches it.

Carrying that gap as prose in an archived change makes it invisible. This change
makes it work.

The four:

| id | Scenario | Why it is unverified today |
|---|---|---|
| **F1** | A mounted inspector converges 5 → 30 rendered entries with no close/reopen | `useSubagentResyncCadence.test.tsx` asserts callback cadence, not rendered entries. No harness workload keeps a subagent alive long enough to mount a view. |
| **P4** | Per-subscriber resync reply bytes/s does not exceed the push bytes/s removed | Never measured. Only structural bounds exist (one timer per subagent, 30 s backoff ceiling, requester-scoped delivery) — those do not establish a byte-rate comparison. |
| **P5** | Representative inspector-open share of subagent runtime (C4 abort > 50 %) | Measured 0.0 %, but the harness never mounts an inspector, so that is the unwatched arm by construction. The signal exists; the number is not representative. |
| **X1** | pi killed mid-run with no terminal frame → replay yields scalar state, no corrupt render | The adjacent recovery paths (bridge-unavailable, evicted, post-reset) are covered at L1; the actual crash-then-replay path is not exercised anywhere. This is the documented REGRESSION of the parent change and is the one that most deserves a pin. |

## What Changes

- A faux scenario whose subagent stays alive long enough to be watched and whose
  timeline demonstrably grows past the head-tail budget (the current inner
  scenario's `sleep`s do not execute under the faux provider — that is the first
  thing to fix or route around).
- L3 coverage for **F1** asserting RENDERED entry count convergence with the
  inspector mounted throughout, and for **X1** killing the pi process mid-run and
  replaying the session.
- A measurement harness for **P4** (N inspectors held open; resync replies/s and
  per-subscriber reply bytes/s vs the push bytes/s removed) and a representative
  **P5** reading, both appended to the parent change's `heap-evidence.md`
  lineage.
- If **P4** shows the cadence costs more than the push it replaced, escalate to
  the parent design's **D4 v2** (client declares a watched `agentId`; the bridge
  stops stripping for that one agent) rather than widening the cadence.
- If **P5** comes back above **50 %**, that is the parent change's C4 kill
  switch: report it, because the strip then buys little and the flag should go
  off.

## Impact

- Affected specs: `subagent-details-payload` (verification only — no requirement
  changes unless P4/P5 force the D4 v2 escalation).
- Affected code: `qa/fixtures/faux-scenarios.ts`, `tests/e2e/`, and the
  measurement scripts. No production behaviour change is expected from this
  change by itself.

## Discipline Skills

- `performance-optimization` — P4/P5 are measure-first tasks with an explicit
  escalation trigger; the measurement must exist before any cadence tuning.
- `systematic-debugging` — the faux subagent finishing in ~600 ms despite
  scripted `sleep`s is an unexplained behaviour that has to be root-caused
  before any of these scenarios become observable.
- `scenario-design` — F1/X1 need real observables, not smoke assertions; the
  parent change already showed how easily an L3 row can pass vacuously.
