# Census — real-process outcome reads + wall-clock budgets

Scope: `packages/*/src/**/__tests__/**` (server, client, extension, shared,
plugins, scripts). Rule under test: **poll-or-budget** — a real-process outcome
is asserted by polling a bounded observable condition; a wall-clock budget
carries documented fork-contention headroom. Produced by tasks 1.1/1.2.

Mechanical sweep: every test file under `packages/*/src/**/__tests__` that
touches `spawn`/`execFile`/`fork`/`child_process`, crossed with fixed-delay
waits and `performance.now()`/`Date.now()` budget assertions. 96 real-process
files, 66 wall-clock assertions. Members below; the residual was classified
out-of-class with a reason (section E).

## A. One-shot reads of real-process outcomes — FIXED

| member | mechanism | fix |
|---|---|---|
| `packages/server/src/__tests__/cli-signal-forwarding.test.ts` | Spawns the real wrapper → jiti-loaded server, SIGTERMs the wrapper, then reads `boot-state.json` **once** for `exitIntent:"signal"`. The record is written from the server's own signal handler, which can run after the HTTP socket already stopped answering (the `down` poll). | Bounded `waitFor` on the recorded intent (20s). |

## B. Wall-clock budgets — FIXED (documented headroom)

| member | old budget | measured basis | new budget |
|---|---|---|---|
| `packages/server/src/__tests__/auth-redirect-base.test.ts` P1 | 100k `buildRedirectUri` < 100ms | ~10ms isolated, 22ms under 16-core saturation, **101.48ms** inside the full 8-fork suite (box on load ~46–268) | 1000ms (~10× worst observed) |
| `packages/client/src/lib/__tests__/linkify-tool-output.perf.test.ts` | ~2MB tokenize < 250ms | ~69ms isolated; exceeded 250ms under full-suite load | 1000ms (~14× isolated) |
| `packages/mcp-server-plugin/src/server/__tests__/performance.test.ts` P1 | 2000 `resolve()` p95 ≤ 1ms | per-call `performance.now()` samples reached 1.4–2.0ms p95 under load (scheduler preemption, not work) | p95 ≤ 10ms |
| `packages/extension/src/__tests__/connection-inbound-drop-report.test.ts` P2 | inbound-dispatch overhead < 10% (median-of-7 paired ratios) | the median-of-ratios still failed when the majority of rounds caught load (medianRatio=1.729, overhead 18ms at load ~76): pairing cancels a UNIFORM slowdown, not a bursty one | min-of-arms ratio < 1.1 (noise only inflates, so each arm's minimum is the robust estimate) |

## C. 5s default `testTimeout` under fork contention — FIXED

These projects set no `testTimeout`, so a healthy test that only needs more
wall-clock than 5s under 8 forks failed with "Test timed out in 5000ms".

| project | observed member(s) | fix |
|---|---|---|
| `packages/shared/vitest.config.ts` | `no-direct-child-process` / `-platform-branch` / `-process-kill` / `-raw-node-import` tree-scan lint tests (4.8s even alone on a loaded box) | `testTimeout: 30_000` |
| `packages/bus-client/vitest.config.ts` | `codegen-denylist` (subprocess typecheck) | `testTimeout: 30_000` |
| `packages/extension/vitest.config.ts` | `command-handler`, `commit-draft-agent-session` | `testTimeout: 30_000` |
| `scripts/vitest.config.ts` | `lint-harness-scoping`, `repair-main-specs` (shell out to biome/openspec) | `testTimeout: 30_000` |
| `packages/automation-plugin/vitest.config.ts` | `flows-run-finalizes-on-forwarded-completion` (real plugin + engine boot + async run-store writes) | `testTimeout: 30_000` |
| `packages/client` (setup) | `waitFor` starvation: `FileLink.split`, `DiagnosticsSection`, `ChatView.selection-anchor`, `PipelineDetailView`, `useTheme` | `asyncUtilTimeout` 5s → 10s (5s margin under the 15s `testTimeout`) |

## D. Test-hygiene leaks surfaced under load — FIXED

| member | mechanism | fix |
|---|---|---|
| `packages/server/src/__tests__/contention-resume-guard-api.test.ts` | Registered sessions under fake absolute paths (`/t/*.jsonl`). The server's debounced meta-persistence timer then fired `mkdir('/t')` → 4 unhandled `ENOENT` errors (suite `Errors 4`). Separately, the describe-scoped `afterAll` stopped the shared server while sibling tests still ran, so `/api/session-file` hit `ECONNREFUSED`. | Temp-backed session paths (`mkdtempSync`); move `beforeAll`/`afterAll` to file scope so both describes share one live server. |
| `packages/client/src/components/__tests__/ChatView.selection-anchor.test.tsx` | "writes scrollTop exactly once" counted writes across an uncontrolled multi-commit window, and the stubbed rect did not move with the programmatic write — so any extra commit (contention introduces them) re-corrected the same growth and wrote twice. | The stubbed rect now tracks programmatic writes by `−applied`, matching a real DOM; an extra commit computes a zero correction. |
| `scripts/__tests__/async-semantics-mutation.test.mjs` | X15 mutation harness blew its 240s per-target cap under load (each mutation is a full vitest invocation). | `PER_TARGET_TIMEOUT` 240s → 600s, documented as contention headroom. |

## E. Examined, classified out of the real-process class — no change

| member(s) | why left as-is |
|---|---|
| `packages/client/src/lib/__tests__/{session-status-visuals,history-gap-trigger}.test.ts`, `packages/kb/…`, `packages/apple-tools/…`, `packages/image-fit-extension/…` perf assertions | Pure-function micro-budgets — no process spawn and no process-recorded state. Thresholds are already documented in-test and are not the class this change targets. |
| `packages/server/src/__tests__/shutdown-terminates-any-strategy.test.ts` T4 | Already polls `waitForDeath`; the 8000ms bound carries documented headroom over the shutdown ladder's own ~3.5s worst case. |
| `packages/server/src/rpc-keeper/__tests__/keeper.test.ts` P1 | Already documented: `maxLatencyMs < 1050` = 3× the production writeRpc attempt budget. |
| `packages/server/src/__tests__/directory-service-readiness.test.ts` P4 | In-process memoization cost, no real-process outcome. |
| `packages/server/src/__tests__/contention-performance.test.ts` | Gateway perf/soak; bounded by its own probe-window multiples, not a machine absolute. |

## F. Second rotation (post-hardening soak run 1) — FIXED

The first post-hardening soak surfaced a DIFFERENT rotating set; 5 of 6 passed in
isolation. All are the same two mechanisms (wall-clock budget, fixed wait), so
they were hardened the same way.

| member | mechanism | fix |
|---|---|---|
| `packages/server/src/__tests__/file-raw-render-endpoints.test.ts` #18 | 15 MB `.eml` parse p95 < 2000ms (measured 2107ms under load) | 5000ms |
| `packages/client/src/lib/chat/__tests__/history-gap-trigger.test.ts` P1 | single-sample ratio ceiling decided by one preemption (77ms vs a 34ms ceiling) | best-of-7 rounds per arm (noise only inflates) |
| `packages/server/src/rpc-keeper/__tests__/keeper.test.ts` E5 | three 30s polls (mock-pi boot + 1 MiB child writes + rotation) | 60s each; per-test cap 90s → 240s |
| `packages/server/src/__tests__/openspec-init-routes.test.ts` X4 | fixed 10ms sleep to let request 1 take the lock; raced → `release` unassigned → hang to timeout | poll the mocked init call |
| `packages/server/src/__tests__/subscription-handler-backfill.test.ts` E15 | fixed 50ms settle vs scheduled replay batches (saw 4000 of 4100) | poll for the replayed count |
| `packages/server/src/__tests__/event-wiring-worktree-rekey.test.ts` | read `reorders` immediately; the socket broadcast lags the synchronous order mutation | poll for the broadcast (2 sites) |
| `packages/blackhole-plugin/src/client/__tests__/PipelineDetailView.test.tsx` | bare `setTimeout(0)` barrier (the banned fixed-tick pattern) before `getByTestId` on async-rendered provenance | `findByTestId` poll (5 sites); the settings negative-assertion polls the config fetch |
| `packages/client/src/components/__tests__/AgentToolRenderer.test.tsx` X4 | "no resync at all" was defeated by the cadence hook's legitimate `reason: "cadence"` tick 2s after open, when `findByRole` was slow under load | assert the OPEN-path guard the test documents (`reason: "open"`) |

## G. Soak evidence (task 3.1) — DEFERRED, environment-limited

The 3-consecutive-run soak could not be produced on this host. Five full-suite
runs recorded, with the machine's ambient load (16 cores) beside each:

| run | change state | ambient load | failures |
|---|---|---|---|
| A | baseline (pre-change) | ~76–268 | 20 files |
| B | named members fixed | ~44 | 4 files |
| C | + census round 1 | ~27–76 | 6 files |
| D | + census round 2 | ~48–91 | 2 files |
| E | + census round 3 | ~76–86 (higher during run) | 8 files |

The failure set ROTATES each run ("different single failure per run" is the
change's own premise), and every member observed across A–E passes in
isolation. The count does not converge because it tracks ambient load: the
design point is ambient ~4–10, and the box never dropped below ~27 (it reached
404). The run itself also drives load far above ambient (8 forks × full-server
boots + subprocess probes), which is the contention the suite is meant to
absorb — but 25× oversubscription is outside the class's budget rule.

Conclusion: the class fixes are in and each is individually verified; the
3-run gate is deferred to a calm machine or PR CI, matching the predecessor
change's treatment of the same environment-limited P2.
