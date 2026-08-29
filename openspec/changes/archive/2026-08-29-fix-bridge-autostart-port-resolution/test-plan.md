# Test Plan — fix-bridge-autostart-port-resolution

Stage: design   Generated: 2026-08-29

Requirement refs: R1 = "Auto-start resolves ports with environment precedence",
R2 = "A session with a pinned endpoint never starts a competing dashboard",
R3 = "Auto-start skips and refusals are loud and greppable"
(specs/bridge-auto-start-lifecycle/spec.md delta).

No clarification gaps — every Triple slot is concrete; HARD gate satisfied
without `ask_user`.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 | decision-table (behavioural) | L1 | automated | env `{DASHBOARD_PORT:18697, PI_DASHBOARD_PI_PORT:19697}`; `config.json` carrying neither `port` nor `piPort`; stub `isDashboardRunning(18697) → {running:true}` | `autoStartServer(config, deps)` runs with config PRE-RESOLVED at the bridge call site — the env→port mapping is proven by the `resolveDashboardPorts` units (#E2) and the wiring end-to-end by the harness (tasks 1.4/4.7) | `launchServer` call count is 0; result carries `{port:18697, piPort:19697}` |
| E2 | R1 | decision-table | L1 | automated | resolver matrix: (a) no env + `config.json {port:8001}` → `8001`; (b) neither source → `8000/9999`; (c) env `""`/`"abc"`/`"0"`/`"-1"` ignored → config/defaults; (d) `PI_DASHBOARD_PORT=8001` + `DASHBOARD_PORT=8002` → `8001`; (e) `PI_DASHBOARD_PI_PORT=19698` + `PI_GATEWAY_PORT=19699` → `19698` | call the shared resolver per matrix cell | returned `{port, piPort}` equals the winning cell in every cell |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R2 | state-transition (decision table) | L1 | automated | cell A: env `PI_DASHBOARD_URL=ws://localhost:19697`; cell B: `PI_DASHBOARD_SOCKET=<path>` only; stub discovery + health | `autoStartServer` runs | `launchServer` never called in BOTH cells; discovery/health stubs still consulted |
| X2 | R2 | fault-injection | L1 | automated | pinned env (either signal); stub discovery → `[]`, `isDashboardRunning → {running:false}` (parent dead) | `autoStartServer` runs to the gate | `launchServer` not called; stubbed durable log gained a line naming the pinned endpoint |
| X3 | R3 | state-transition | L1 | automated | no pin; `isDashboardRunning(resolved) → {running:true}` | `autoStartServer` attach path | durable log line names the resolved port AND records that no launch happened |
| X4 | R3 | fault-injection | L1 | automated | `isDashboardRunning → {running:false, portConflict:true}` | `autoStartServer` reaches the conflict branch | notify warning AND durable log line naming the port; no launch |
| X5 | R3 | state-transition | L1 | automated | stub `discoverDashboard → [{host:"localhost", port:18697, isLocal:true}]`; `isDashboardRunning(8000) → not running`; mDNS enabled in test env | `autoStartServer` step 1 | warning names both `8000` and `18697`; no launch; result carries the discovered server |

### Process smoke

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X6 | R3 + harness invariant | process smoke | L2 | automated | harness up, ports read from `.pi-test-harness.json` (`dashboardPort`) | after startup, probe from inside the container | `curl localhost:<dashboardPort>/api/health` → 200 AND `:8000` inside the container connection-refused (exactly one dashboard) |

### Browser e2e

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X7 | R3 (canary) | existing-spec gate | L3 | automated | harness per `docker/test-up.sh` | run `tests/e2e/faux-text.spec.ts` | spec passes — the canary any other E2E verdict depends on; unblocks `notify-min-level.spec.ts` / `notify-channel.spec.ts` (tasks 4.4) |

## Coverage summary

- Requirements covered: 3/3 (R1: E1,E2 · R2: X1,X2 · R3: X3,X4,X5,X6,X7)
- Scenarios by class: edge 2 · perf 0 · frontend 0 · error 5 (+1 process-smoke, +1 e2e)
- Scenarios by level: L1 7 · L2 1 · L3 1
- Scenarios by disposition: automated 9 · manual-only 0

## Notes

- Mutation gate (process, not a row): reverting the resolver precedence must
  turn E1/E2 red (tasks 2.5).
- Exemplar files for the fold: `packages/shared/src/__tests__/config.test.ts`
  (E2), `packages/extension/src/__tests__/server-auto-start.test.ts` (E1, X3,
  X4, X5), `packages/extension/src/__tests__/connection-suppress-auto-start.test.ts`
  (X1), `packages/extension/src/__tests__/server-auto-start-guarded.test.ts` +
  `autostart-guard.test.ts` (X2), `docker/test-entrypoint.sh:571-580` health
  loop (X6), `tests/e2e/faux-text.spec.ts` (X7).

## New infra needed

- none — X6 extends the existing harness smoke; every other row lands in an
  existing suite.
