## 1. Capture the pre-fix baseline

- [x] 1.1 Boot a harness for this worktree (build the per-worktree tag, then `PI_E2E_SEED=1 PI_TEST_PEERS=both ./docker/test-up.sh -d`) and record the container name + derived port from `.pi-test-harness.json`.
- [x] 1.2 Write the out-of-band probe (a script under `scripts/`, invoked from the host) that prints `memory.max`, `memory.current`, `memory.events`, `pids.current` from the container cgroup plus the resident `pi` process count and summed RSS. The image has no `ps` — enumerate `/proc/[0-9]*/status` for `VmRSS`.
- [x] 1.3 Run a ~30-spec chunk and sample the probe before and after; record the numbers in the change folder. This is the "climbs monotonically" baseline the fix must flatten.
- [x] 1.4 Record measured per-session RSS (average and range), dashboard server RSS, and the concurrent-session ceiling derived from them. These are the derivation inputs the budget requirement demands. Note explicitly that summed RSS overcounts shared pages relative to the cgroup figure.

## 2. Bus-backed reap fixture (D1–D3)

- [x] 2.1 Add `tests/e2e/fixtures.ts` exporting `test` (extended from `@playwright/test`) and re-exporting `expect` plus **every** type the 87 specs currently import from that statement (`Page`, `Locator`, `APIRequestContext`, `WebSocket`) — 9 distinct import spellings, 27 files pulling types.
- [x] 2.2 Implement session enumeration over `BusClient` (`packages/bus-client`): connect per test, `read.sessions()` for the pre-body snapshot, `close()` in teardown. Do NOT hold a worker-scoped client — `faux-ask.spec.ts:101` restarts the daemon mid-suite and `BusClient` has no reconnect.
- [x] 2.3 Implement the delta: after the body, settle adaptively (poll until the session count is stable for 1 s, cap 5 s), then compute ids that appeared during the test. The settle is what stops a late-registering spawn from being misclassified as pre-existing forever.
- [x] 2.4 Implement the reap: send `{type:"shutdown", sessionId}` for each delta id **concurrently**, awaiting each `session_removed` (the server emits it after the SIGTERM→SIGKILL ladder completes, so it is the post-termination ack). Treat an unknown/already-gone session as success.
- [x] 2.5 Swallow every reap error and report it as a diagnostic — never as the test's failure.
- [x] 2.6 Register the fixture with `auto: true` so it runs without per-spec opt-in, on both pass and fail.
- [x] 2.7 Make global-setup wait for harness-owned sessions (notably `PI_E2E_INDEPENDENT_SESSION`) to be registered before the first test, so they are always inside the first snapshot and can never be reaped as a delta.

## 2b. Tests — reap mechanism (folded from test-plan.md)

- [x] 2b.1 L1: delta classification decision table — ids present pre-only / post-only / both / neither · compute delta · only post-only ids returned for reap (test-plan #E1). Exemplar: a sibling `packages/*/src/**/__tests__/*.test.ts` covering pure helper logic.
- [x] 2b.2 L1: adaptive settle — session list gains an id 800 ms after the body ends · delta computed with the stable-for-1s/cap-5s settle · the late id is classified as spawned-during-test (test-plan #E4). Exemplar: same sibling unit test as 2b.1.
- [x] 2b.3 L1: reap-error isolation — bus unreachable at teardown · a test that already failed an assertion · reported failure stays the original assertion failure, reap error only a diagnostic (test-plan #X2). Exemplar: same sibling unit test as 2b.1.
- [x] 2b.4 L1: teardown tail-latency — teardown reaping 1 and 3 sessions, 20 iterations · timed · p95 < 5 s irrespective of session count (test-plan #P2). Exemplar: `tests/e2e/chat-render-perf.spec.ts` for the timing-assertion shape, authored as a vitest timed test.
- [x] 2b.5 L3: spawned sessions do not outlive the test — a spec spawning 2 sessions in the git fixture · body ends · both ids absent from the session list before the next test and resident `pi` count drops by 2 (test-plan #E2). Exemplar: `tests/e2e/bus-client-goal-plugin-action.spec.ts` (headless BusClient against the harness).
- [x] 2b.6 L3: pre-existing harness session survives — harness booted `PI_E2E_INDEPENDENT_SESSION=1` · a spec spawns and ends · the `source:"tui"` session is still live (test-plan #E3). Exemplar: `tests/e2e/faux-ask.spec.ts` (#F6 reconnect scenario).
- [x] 2b.7 L3: already-gone session tolerated — `notify-channel.spec.ts` force-kills its own session mid-test · reap targets the dead id · not-found treated as success, spec still passes (test-plan #X1). Exemplar: `tests/e2e/notify-channel.spec.ts` itself.
- [x] 2b.8 L3: reaped session is not a recovery candidate — session reaped over the bus, then the server cold-starts · recovery scan runs · not offered as a candidate, does not reappear (test-plan #X7). Exemplar: `tests/e2e/faux-ask.spec.ts:101` for the `/api/restart` pattern.
- [x] 2b.9 L3: reap does not race an in-flight turn — a session mid-stream when the body ends · reap fires · converges to removed with no uncaught `pageerror` (test-plan #F4). Exemplar: `tests/e2e/optimistic-prompt.spec.ts`.

## 3. Adopt the fixture across the suite (D2)

- [x] 3.1 Rewrite the `@playwright/test` import in all 87 `tests/e2e/*.spec.ts` files to import from `./fixtures.js`, preserving each file's named-import set. Mechanical, but type-check the result — a missing re-export breaks all 87 at once while the guard test still passes.
- [x] 3.2 Audit the 5 specs with their own teardown hooks (`gateway-url-action`, `oauth-redirect-base`, `plugin-settings-pages`, `tool-created-files`, `uncommitted-indicator-commit`): `afterEach` runs before fixture teardown (session live), `afterAll` runs after it (session already reaped). Confirm no hook needs a live session in an `afterAll`.
- [x] 3.3 Add the guard test that fails any `tests/e2e/*.spec.ts` importing `test` from `@playwright/test` directly, with a message naming the file and the one-line correction.

## 3b. Tests — adoption + ordering (folded from test-plan.md)

- [x] 3b.1 L1: guard decision table — spec importing `test` from `@playwright/test` / from `./fixtures.js` / importing only types from `@playwright/test` · guard runs · first fails naming file + correction, other two pass (test-plan #E6). Exemplar: the repo's existing skill-frontmatter guard test for the file-walking shape.
- [x] 3b.2 L1: guard fails closed — one spec's import deliberately reverted · guard runs · guard FAILS (test-plan #E7). Exemplar: same guard test as 3b.1.
- [x] 3b.3 L3: `afterEach` hook still sees a live session — a spec registering `afterEach` that reads its session · test ends · hook observes the session live, reap runs after it (test-plan #F1). Exemplar: `tests/e2e/uncommitted-indicator-commit.spec.ts`.
- [x] 3b.4 L3: `afterAll` ordering — a spec registering `afterAll` · file ends · hook runs after fixture teardown against an already-reaped session and still completes (test-plan #F2). Exemplar: `tests/e2e/plugin-settings-pages.spec.ts`.
- [x] 3b.5 L3: bus client survives the mid-suite restart — `faux-ask.spec.ts` calls `POST /api/restart`, dropping every socket · the next spec's reap runs · reap succeeds, no `bus client not connected` (test-plan #F3). Exemplar: `tests/e2e/faux-ask.spec.ts:101`.

  **Verified:** `tests/e2e/session-reap.spec.ts` — 12 passed / 1 skipped (E3 needs `PI_E2E_INDEPENDENT_SESSION=1`) against a live harness; container ended at 538.6 MiB with **0 resident `pi`**. Scenarios F1/F3/F4/X7 landed in that spec alongside E2/E8/X1.
- [x] 3b.6 L3: idempotent against an empty container — zero session cards after a prior reap · a spawn-round-trip spec starts · it pins the fixture, spawns, and reaches its assertions (test-plan #E8). Exemplar: `tests/e2e/navigation.spec.ts`.

## 4. Harness-down latch (D4)

- [x] 4.1 Probe `GET /api/health` before each test body — explicitly, not via bus connection state, which `BusClient` does not expose and which stays "open" through the memory thrash this must detect.
- [x] 4.2 Require N ≥ 2 consecutive probe failures before declaring the harness down, so a harness merely slow under memory pressure is not misreported as dead.
- [x] 4.3 Run the probe before consulting the latch, so a CI retry (`retries: 1`) re-probes rather than reporting as a skip.
- [x] 4.4 On declaration, fail the current test with a harness-down message naming the harness, then `testInfo.skip()` every subsequent test.
- [x] 4.5 Document in the fixture that the latch is module state shared via the single worker, and therefore depends on `workers: 1` + `fullyParallel: false`.
## 4b. Tests — harness-down latch (folded from test-plan.md)

- [x] 4b.1 L1: slow harness is not declared dead — probe fails twice (10 s timeout each) then succeeds · latch evaluated · harness NOT declared down, run continues (test-plan #X3). Exemplar: a sibling `__tests__/*.test.ts` unit test with a stubbed probe.
- [x] 4b.2 L1: dead harness latches — probe fails 3 consecutive times · latch evaluated · harness declared down, current test fails with a message naming the harness (test-plan #X4). Exemplar: same unit test as 4b.1.
- [x] 4b.3 L1: latch skips the remainder — latch already armed · subsequent tests start · each calls `testInfo.skip()`, none reported as a product failure (test-plan #X5). Exemplar: same unit test as 4b.1.
- [x] 4b.4 L1: retry re-probes rather than skipping — CI `retries: 1`, harness-down test retried · retry runs · probe runs before the latch is consulted, so the retry fails again rather than reporting as a skip (test-plan #X6). Exemplar: same unit test as 4b.1.

## 5. Residual-session budget (D5)

- [x] 5.1 Declare the budget (starting value 8) in the fixture alongside a comment carrying its derivation from the group-1 measurements, and stating that it bounds *residual* sessions, not peak capacity.
- [x] 5.2 Assert live-session count ≤ budget after reaping; on breach, fail with the offending session ids and cwds.
- [x] 5.3 Record the observed peak residual across a chunk run. **Observed peak: 0 breaches** across a 143-test run once liveness filtering was correct — the budget of 8 was never approached, so no raise is warranted. (The 96 breaches seen first were the fixture counting closed records; fixed, with L1 coverage.) Recorded in `measurements.md` Group 3.

## 5b. Tests — budget (folded from test-plan.md)

- [x] 5b.1 L1: budget boundary — post-reap live counts 7 / 8 / 9 against budget 8 · budget assertion · 7 and 8 pass, 9 fails naming the offending ids + cwds (test-plan #E5). Exemplar: a sibling `__tests__/*.test.ts` unit test.

## 6. Verify the bound

- [x] 6.0 Author the L2 smoke script under `qa/tests/` that wraps an E2E chunk or full run and samples the container cgroup (`memory.max`, `memory.current`, `memory.events`, `pids.current`) plus the resident `pi` count from `/proc`, before and after. This is the change's only new infra; it keeps cgroup sampling out-of-band per design D5 and carries NO rendered-UI assertions. Exemplar: an existing `qa/tests/*.sh` process-smoke script.
- [→] 6.0a **MOVED → `fix-tmux-session-shutdown-leak` #P1.** Unreachable here: memory climbs regardless of a correct reap while shutdown orphans the process.
- [→] 6.0b **MOVED → `fix-tmux-session-shutdown-leak` #P3.** The divergence was *measured and recorded* here (21 resident `pi` vs 0 reported sessions — `measurements/tmux-leak-evidence.txt`), which is what exposed the root cause; the guarantee that it stays constant belongs with the fix.
- [→] 6.0c **MOVED → `fix-tmux-session-shutdown-leak` #P4.** Full-run survival is impossible while every shutdown leaks ~127 MB.
- [x] 6.1 Re-ran the chunk and compared probe samples. **Result: NOT flat — this is the task that found the tmux leak.** First attempt was invalid (112/120 tests died at `browserType.launch` on a reaped `TMPDIR`; retracted in `measurements.md`). The valid full-suite run climbed 783 → 2550 MiB with 0 budget breaches, which is what proved the reap was correct and the *shutdown* was not.
- [→] 6.2 **MOVED → `fix-tmux-session-shutdown-leak`.** No comparable wall-clock baseline exists: the pre-fix run was cut short at 114 tests, and the post-fix runs were stopped once the tmux leak was identified. Measuring reap cost against a leaking harness would measure the leak.
- [→] 6.3 **MOVED → `fix-tmux-session-shutdown-leak` #6.3.** The exit criterion ("reaches the final spec, container healthy") is unreachable until shutdown terminates the process. Two runs were attempted; both are recorded in `measurements.md`.
- [→] 6.4 **MOVED → `fix-tmux-session-shutdown-leak` #6.4**, since it is the acceptance run's output.

## 7. Documentation and handoff

- [x] 7.1 Update `tests/e2e/README.md`: sessions are reaped per test over the bus, specs import `test` from `./fixtures.js`, and the budget with its derivation.
- [x] 7.2 Add per-file rows for `tests/e2e/fixtures.ts` and the probe script to the nearest directory `AGENTS.md` (delegate any `docs/` prose to DocScribe).
- [x] 7.3 File the REST/WS shutdown divergence as its own issue: `POST /api/session/:id/shutdown` omits the `setLiveness({closedReason:"manual"})` write that the WS `handleShutdown` and `handleForceKill` both perform, so REST-closed sessions stay cold-start recovery candidates.
- [x] 7.4 File the follow-up for `playwright.config.ts`'s 15-minute `globalTimeout`, which blocks an unattended full run and is deliberately not changed here.
- [x] 7.5 Comment on #433 with the measured root cause, the fix, and the acceptance-run results; state explicitly that parts 1 and 2 remain open and are now unblocked.
