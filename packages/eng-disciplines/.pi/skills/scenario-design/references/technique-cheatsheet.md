# Technique cheat-sheet

How to apply each design/resilience technique, with pi-agent-dashboard examples.
Adapted from ISTQB CTFL Ch.4 (EP/BVA/decision tables/state-transition),
spec-coding edge-case practice, distributed-systems determinism, and
fault-injection (Istio/AWS FIS) practice. Scored + selected for this repo.

---

## Equivalence Partitioning (EP)

Split an input domain into classes where the system should behave identically.
Pick ONE representative per class — valid classes and **invalid** classes both.

- Example: `maxChars` cap for subagent context fork. Classes: 0, normal (e.g.
  8000), absurdly large, negative, non-numeric. One Triple per class.

## Boundary Value Analysis (BVA)

Bugs cluster at edges. For a range `[min..max]` emit six values:
`min-1 (invalid) · min · min+1 · max-1 · max · max+1 (invalid)`.

- Example: restart quiesce window 5000ms. Triples at 4999 (bridge still
  suppressed?), 5000, 5001 (bridge re-spawns?). Catches off-by-one in the
  suppression timer.

## Decision Table

Enumerate flag/condition combinations → expected action. One Triple per
reachable row; mark impossible rows.

- Example: server start. Flags: `--dev` (y/n) × Vite running (y/n).
  `--dev=y, vite=n` → must fall back to dist/client, no 502. That fallback row
  is the high-value scenario, not the happy `--dev=y, vite=y`.

## State-Transition

Model the feature as states + events. Emit a Triple for every **legal** edge AND
every **illegal** edge (event in a state that must reject/ignore it).

- Example: pi session lifecycle / bridge reconnection / `server_restarting`
  broadcast. Illegal edges are gold: "abort fires while session already
  aborting", "second restart POST during quiesce window".
- Draw the machine (Mermaid) in the plan when it clarifies coverage.

## State-convergence + invariant assertions (async / WebSocket)

For WS-driven UI, **assert business invariants and eventual convergence**, never
"element visible after N ms" (that is the #1 flaky-test cause). Assert the
intermediate states the UI must pass through and the final converged state.

- Example: session card after reconnect must converge to the live event count;
  assert the count equals server truth, not "spinner gone in 2s".
- Mock the network / drive state via API setup for determinism; use stable
  locators (role/test-id), web-first assertions (`expect().toHaveText`).

## Performance (tail-latency + soak + threshold)

State **workload**, **metric**, **threshold**, **window**. Compare p95/p99 (tail
is where user pain lives), error rate, then throughput. Include dependency
signals (query count, WS message rate). Soak = run long to catch leaks (RSS
growth, unbounded buffers).

- Example: 50 concurrent sessions streaming events → server p95 broadcast
  latency < Xms over a 10-min window, RSS flat. **No threshold in spec ⇒ gap.**

## Fault injection (delay + abort)

For each external dependency emit two Triples: a **delay** (timing failure) and
an **abort** (crash/error failure). Assert retry, timeout, and graceful
degradation — not just the happy reconnect.

- Example: WebSocket to bridge. Delay: 7s stall → does the client show
  reconnecting state and recover? Abort: server killed mid-stream → bridge
  re-discovers and reconnects within the window, no duplicate spawn.
- Example: `/api/restart` orchestrator → old PID won't die (SIGTERM ignored) →
  must escalate to SIGKILL then start replacement.

---

## Scenario classes → techniques (quick map)

| Class | Primary techniques |
|---|---|
| edge-case | EP, BVA, decision table |
| performance | tail-latency, soak, thresholds |
| frontend-quirk | state-transition, convergence/invariants, stable locators |
| error-handling | fault injection (delay+abort), illegal state-transitions |

## Rejected (scored out for this repo)

- Gherkin/BDD TCMS tooling — heavyweight, no infra here, no payoff at this scale.
