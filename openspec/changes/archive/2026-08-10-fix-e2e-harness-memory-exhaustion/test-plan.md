# Test Plan — fix-e2e-harness-memory-exhaustion

Stage: design   Generated: 2026-08-09

All clarification gaps resolved before writing (latch N/timeout, settle policy,
teardown threshold, memory criterion, probe routing). No open markers.

Level routing for this repo: L1 = `packages/*/src/**/__tests__/*.test.ts`
(vitest) · L2 = `qa/tests/*.sh` (process/CLI smoke, no rendered-UI asserts) ·
L3 = `tests/e2e/*.spec.ts` (Playwright vs the docker harness, port read from
`.pi-test-harness.json` — never hardcoded).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Release every session it spawns | decision-table | L1 | automated | stubbed session lists: id in pre-snapshot only / in post only / in both / in neither | compute delta | only post-only ids are returned for reap; pre-existing and absent ids are not |
| E2 | Release every session it spawns | state-transition | L3 | automated | a spec that spawns 2 sessions in the git fixture | test body ends | both ids absent from `read.sessions()` before the next test starts (record release; process death is the tmux change's row T2) |
| E3 | Pre-existing harness session survives | state-transition | L3 | automated | harness booted `PI_E2E_INDEPENDENT_SESSION=1`; one spec spawns + ends | reap runs | the independent session (`source:"tui"`) is still live after the spec |
| E4 | Delta is not corrupted by late registration | state-convergence | L1 | automated | session list that gains an id 800 ms after the body ends | delta computed with the adaptive settle (stable for 1 s, cap 5 s) | the late id is classified as spawned-during-test, not pre-existing |
| E5 | Residual budget | BVA | L1 | automated | post-reap live counts 7 / 8 / 9 against budget 8 | budget assertion | 7 and 8 pass; 9 fails naming the offending ids + cwds |
| E6 | Guard test | decision-table | L1 | automated | spec files importing `test` from `@playwright/test` / from `./fixtures.js` / importing only types from `@playwright/test` | guard runs | first fails naming file + correction; second passes; third passes (type-only import is legal) |
| E7 | Guard fails closed | mutation | L1 | automated | one spec's import reverted to `@playwright/test` | guard runs | guard FAILS (proves the guard can fail; a guard that cannot fail proves nothing) |
| E8 | Idempotent against empty container | state-transition | L3 | automated | container with zero session cards (previous spec's sessions reaped) | a spawn-round-trip spec starts | it pins the fixture, spawns, and reaches its assertions without depending on a prior card |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| ~~P1~~ | ~~Harness survives a full run / memory does not climb~~ | soak + threshold | L2 | **MOVED → fix-tmux-session-shutdown-leak** | — | unsatisfiable while shutdown leaves the process alive; re-homed with the fix | — |
| P2 | Reap stays inside the per-test budget | tail-latency | L1 | automated | teardown reaping 1 and 3 sessions, timed | p95 teardown < 5 s irrespective of session count (concurrent reap flattens it) | 20 iterations |
| ~~P3~~ | ~~Resident process count tracks session count~~ | soak | L2 | **MOVED → fix-tmux-session-shutdown-leak** | — | divergence was measured and recorded here (21 processes vs 0 records); the *constant-divergence* guarantee belongs with the fix | — |
| ~~P4~~ | ~~Full-run survival (acceptance)~~ | soak | L2 | **MOVED → fix-tmux-session-shutdown-leak** | — | container cannot survive a full run while every shutdown orphans a ~127 MB process | — |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | afterEach hooks see a live session | state-transition | L3 | automated | a spec registering `afterEach` that reads its session | test ends | the hook observes the session still live; the reap runs after it |
| F2 | afterAll ordering is understood | state-transition | L3 | automated | a spec registering `afterAll` | test file ends | the hook runs after fixture teardown (session already reaped) and still completes without error |
| F3 | Bus client survives the mid-suite restart | state-transition | L3 | automated | `faux-ask.spec.ts` calls `POST /api/restart`, dropping every socket | the next spec's reap runs | the reap succeeds — a per-test client reconnects; no `bus client not connected` |
| F4 | Reap does not race an in-flight turn | state-convergence | L3 | automated | a spec whose session is mid-stream when the body ends | reap fires | session converges to removed; no uncaught `pageerror` from the closing page |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Already-gone session tolerated | fault-injection (abort) | L3 | automated | `notify-channel.spec.ts` force-kills its own session mid-test | reap targets the dead id | reap treats not-found as success; the spec still passes |
| X2 | Reap failure never masks the real failure | fault-injection (abort) | L1 | automated | bus unreachable at teardown | a test that already failed an assertion | reported failure is the original assertion failure; the reap error appears only as a diagnostic |
| X3 | Slow harness is not declared dead | fault-injection (delay) | L1 | automated | liveness probe fails twice (10 s timeout each) then succeeds | latch evaluated | harness NOT declared down; run continues (N = 3 required) |
| X4 | Dead harness latches | fault-injection (abort) | L1 | automated | liveness probe fails 3 consecutive times | latch evaluated | harness declared down; current test fails with a harness-down message naming the harness |
| X5 | Latch skips the remainder | state-transition | L1 | automated | latch already armed | subsequent tests start | each calls `testInfo.skip()`; none is reported as a product failure |
| X6 | Retry re-probes rather than skipping | state-transition | L1 | automated | CI `retries: 1`; harness-down test retried | retry runs | the probe runs before the latch is consulted, so the retry fails again rather than reporting as a skip |
| X7 | Reaped session is not a recovery candidate | fault-injection (restart) | L3 | automated | a session reaped over the bus, then the server cold-starts | recovery scan runs | the session is not offered as a recovery candidate and does not reappear in the session list |

---

## Coverage summary

- Requirements covered: 8/8 (3 ADDED playwright-e2e-qa, 2 MODIFIED playwright-e2e-qa, 1 ADDED docker-test-harness split across its 3 scenarios)
- Scenarios by class: edge 8 · perf 4 · frontend 4 · error 7 (23 total)
- Scenarios by level: L1 11 · L2 4 · L3 8
- Scenarios by disposition: automated 23 · manual-only 0

## New infra needed

- An L2 smoke script under `qa/` that wraps an E2E chunk/full run and samples the container cgroup (`memory.max`, `memory.current`, `memory.events`, `pids.current`) plus the resident `pi` count from `/proc` before and after. P1/P3/P4 all read it. This is the only new harness; it keeps the cgroup sampling out-of-band, per design D5, and carries no rendered-UI assertions.
