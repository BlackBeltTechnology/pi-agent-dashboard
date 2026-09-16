# Test Plan — fix-false-unresponsive-badge

Stage: apply   Generated: 2026-11-19

No clarifications outstanding: the two thresholds (35 s degraded, 60 s
unresponsive) and the shed predicate (`bufferedAmount > MAX_WS_BUFFER`) are
concrete in the spec and in `browser-gateway.ts`, so every Triple below fills.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 healthy costs zero frames | BVA | L1 | automated | tracker, `degradedMs=35_000`, one frame at `t0` | advance fake clock to `t0+34_999` | `onChange` called 0 times |
| E2 | R1 verdict at the degraded boundary | BVA | L1 | automated | same tracker | advance to `t0+35_000` | exactly one emit `{state:"degraded", since:t0}`; no second emit at `t0+35_001` |
| E3 | R1 escalation boundary | BVA | L1 | automated | tracker already degraded | advance to `t0+60_000` with no frame | exactly one emit `{state:"unresponsive", since:t0}`; `degraded` not re-emitted |
| E4 | R1 just-below-boundary frame re-arms | BVA | L1 | automated | tracker, frame at `t0`, second frame at `t0+34_999` | advance to `t0+35_000` | 0 emits; the degraded emit lands at `t0+69_999` instead |
| E5 | R1 client renders the verdict, not the metrics | decision-table | L1 | automated | `hostPressure ∈ {undefined, null, degraded, unresponsive}` × `processMetrics.updatedAt ∈ {now, now-1h}` (8 cells) | card renders | nothing rendered for `undefined`/`null` in BOTH metric ages; pill rendered only for the two verdict cells |
| E6 | R1 single source of truth for thresholds | static/unit | L1 | automated | `HOST_PRESSURE_DEGRADED_MS` / `_UNRESPONSIVE_MS` imported from `packages/shared` by tracker AND `SessionCard` | test asserts the imported values and greps both modules for a bare `35_000`/`60_000` literal | both consumers read the same constant; no second literal definition survives |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | R1 healthy session costs zero additional frames | threshold | L1 | automated | gateway wiring test, one registered bridge framing every 5 s | `onHostPressure` invocations = 0 | 4× the degraded threshold (140 s fake-clock) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R2 escalation between transitions | state-transition | L1 | automated | card given `{state:"degraded", since:T}` and no further frame | wall clock advances past `T+60_000` | card converges to `unresponsive` on its own tick |
| F2 | R2 clock skew never lowers a verdict | state-transition (illegal edge) | L1 | automated | card given `{state:"unresponsive", since:T}` with a browser clock BEHIND the server (`Date.now() < T`) | render + tick | never renders below `unresponsive`; no "healthy"/absent frame |
| F3 | R1+R2 live raise and recovery over the real socket | state-convergence | L3 | automated | docker harness, one live session (port from `.pi-test-harness.json#dashboardPort`) | the session's bridge stops framing past the threshold, then frames again | card acquires the pressure pill, then loses it, with no page reload |
| F4 | R1 snapshot parity for a late browser | state-convergence | L3 | automated | one session already carrying a verdict; a SECOND browser context opens | new context receives `sessions_snapshot` | both contexts show the identical badge state |
| F5 | R1 badge legibility across the four themes | visual/subjective | — | manual-only | a pressured card in studio / earth / athlete / gradient | a human looks at each theme | [judgment: pill stays legible and reads as a warning, not decoration — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R1 a shed verdict frame is reconciled | fault-injection (backpressure) | L1 | automated | browser socket with `bufferedAmount > MAX_WS_BUFFER` so `session_updated` is shed | a host-pressure RECOVERY (`hostPressure: null`) is broadcast, then the socket drains | the status-debt flush rebuilds a `session_updated` whose `updates` carries `hostPressure` from the live row; the badge clears without a reconnect |
| X2 | R2 carrier loss is not host pressure | fault-injection (abort) | L1 | automated | registered bridge, socket closed WITHOUT `session_unregister` (non-finalize path) | 60 s of silence elapse | zero verdicts emitted for that session |
| X3 | R2 no tracking state survives a dead session | state-transition (exit edges) | L1 | automated | tracked session removed via each exit path: explicit unregister, heartbeat timeout, sleep-retry expiry, reload placeholder swap | the exit fires | tracker map empty for that id and no timer fires afterwards (`vi.getTimerCount()` unchanged by the elapsed thresholds) |
| X4 | R2 an ended session serves no stale verdict | state-transition | L1 | automated | session carrying `{state:"unresponsive"}` | session transitions to `ended` | its row's `hostPressure` is cleared, so a later `sessions_snapshot` carries none |
| X5 | R1 a restart does not resurrect a verdict | fault-injection (restart) | L1 | automated | session row with a verdict, written through `sessionToMeta` | reload the meta from disk | `hostPressure` absent on the rehydrated row (field is transient) |
| X6 | R2 raise + clear over a real bridge socket | fault-injection (delay) | L1 | automated | real UDS bridge, short test thresholds | bridge goes quiet, then sends `session_heartbeat` | `degraded` → `unresponsive` → explicit `null`, in order |

---

## Coverage summary

- Requirements covered: 2/2 (every scenario block in the delta maps to ≥1 row)
- Scenarios by class: edge 6 · perf 1 · frontend 5 · error 6
- Scenarios by level: L1 14 · L2 0 · L3 2 · manual-only 1
- Scenarios by disposition: automated 17 · manual-only 1

Already green in the working tree: E1, E2, E3, E5 (partially — the 8-cell table
is not exhaustive yet), F1, F2, X6. Everything else is new work.

## New infra needed

- none — L1 rides the existing vitest suites (`packages/server/src/session/__tests__/`,
  `packages/server/src/__tests__/`, `packages/client/src/components/session/__tests__/`),
  L3 rides the existing docker harness under `tests/e2e/`.
