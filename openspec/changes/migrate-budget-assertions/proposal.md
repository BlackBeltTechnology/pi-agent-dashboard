# Proposal: migrate-budget-assertions

## Planning status

Not yet planned. This is a proposal-only draft split out of `stabilize-blocking-test-lanes` (owner decision A8). It needs its own plan-proposal pass after the core ships. It has no design.md, no spec deltas and no tasks.md yet. `inventory.md` is preliminary and known unreliable; the first planning step rebuilds it from the guard's `--list` output, reading every row by hand.

## Why

`stabilize-blocking-test-lanes` adds the nightly budget lane, moves only the budget tests already observed failing in CI, and ships `scripts/check-budget-assertions.mjs` in warn-only mode. About 300 other upper-bound wall-clock and process-memory assertions still run in blocking lanes (the preliminary `inventory.md` counts 222 MOVE, 83 REWRITE and 35 unclassified rows over 192 files). Each one can turn a PR, `npm test` or the tag gate red on a slow shared runner, and until this change lands a NEW budget assertion can still enter a blocking lane, because the guard only warns.

## What Changes

End state: the guard is blocking in the `ci.yml` `ci` job and in the ship-it step 4.4 check list, it exits 0 over the whole tree, and there is no baseline or grandfather file. So no upper-bound wall-clock or process-memory assertion remains in a blocking lane except an allow-listed real-process liveness deadline, and every file that mixed functional and budget cases is split. These universal rules belong to this change's spec deltas; the core states only that its lane exists, that budget files run only there, and that its named cases moved.

- **Every existing budget assertion gets exactly one disposition**, chosen by a stated first-match rule so two implementers decide alike:
  - MOVE: the case exists to measure speed or memory. It goes to a `*.budget.test.*` file of the core's lane, threshold unchanged.
  - REWRITE: a liveness deadline inside a functional case. The duration assertion is removed, the case awaits or polls its outcome under its own test timeout, stays blocking, and still fails on a hang.
  - ALLOW-LIST: a real-process liveness deadline (A6), entered in the guard's `LIVENESS_ALLOW` with a written reason under the admission rule the core designs ("a real-process liveness deadline with a written reason"; the core's guard checks only the reason and the single match). Before the guard turns blocking, this change decides how a real-process file is recognised mechanically outside `packages/server/vitest.real-process-files.ts` (core trade-off T-A12) and any stricter admission rule.
  - NOT-A-BUDGET: an exit for a flagged row that is not a budget under A1/A5 (byte size, count, fake clock, model threshold). The pre-split rule had no such exit (inventory header).
- **Turn the guard blocking**: drop `--warn` from the `ci.yml` step and add the command to `.pi/skills/ship-it/SKILL.md` step 4.4 and `SKILL.agent.md`.
- **Per-occurrence escape routes**, if the owner keeps them: the `// budget-exempt: <reason>` false-positive marker (refused on clock differences and direct memory readings) and the opt-in measurement gate for `KB_MEASURE` (and possibly `PI_BENCH`). The core does not ship them, because a warn-only guard needs no way through.

### Inputs carried over

- Owner decisions A1 (assertion type decides; deterministic byte/count budgets stay), A5 (upper bounds only), A6 (real-process liveness deadlines stay blocking, on the allow-list with a reason, admission rule stated) and A8 (no baseline at the end).
- The pre-split disposition rule R1–R8: R1 real-process liveness deadline → ALLOW-LIST; R2 memory amount → MOVE; R3 relative bound → MOVE; R4 named as performance (P-id, perf/budget/bench/latency/throughput/overhead/p95/p99, percentile) → MOVE; R5 timeout/abort/kill/hang path whose outcome is asserted → REWRITE; R6 complexity/speed words → MOVE; R7 bound is the only assertion → MOVE; R8 otherwise REWRITE when a fake clock or an overlap check replaces the bound, else MOVE.
- The pre-split REWRITE recipe: (a) delete the bound, await or `vi.waitFor` the outcome under the package `testTimeout`; (b) assert the outcome that tells an own timeout from an outer one; (c) fake the clock when elapsed time is the behaviour; (d) assert overlap with start/end events; (e) never a fixed sleep or a shortened per-test timeout. When a spec states the bound, the functional case stays blocking and a timed copy goes to the budget lane.
- The core's case-level split rule (`stabilize-blocking-test-lanes` design D6): a moved case whose other assertions check a functional outcome that no blocking case asserts keeps a blocking copy without the bound.

### Facts the cycle-3 reviews found (the rebuild must handle them)

- The R1–R8 word lists misfire: a MOVE takes the whole case, and 128 of 195 MOVE cases hold another `expect(`. A case-level split rule is needed (the core states one).
- R1 admitted only files of `packages/server/vitest.real-process-files.ts`. Real-process liveness deadlines elsewhere (`mockup-loop` `mock-site-serve.test.ts:145,181`, blender `real-lifecycle.test.ts:294`) fell through. The core no longer narrows A6 that way; the mechanical recognition rule is open (core trade-off T-A12) and is this change's to decide.
- Files gated by a second opt-in variable (`PI_BENCH`: `route-admission.bench.test.ts`, `provider-auth-fallback.bench.test.ts`; `client-isolate-gate.test.mjs` under `!adopted || !CI_SCENARIOS`) collide with the budget job's strict no-skip rule if moved as they are.
- `openspec/specs/untrusted-content-guard/spec.md:181` ("within 25 ms per 100 KB on the CI reference runner") and `openspec/specs/flows-plugin/spec.md:470` ("within 2 s of the timeout") state bounds whose enforcing tests are MOVE or REWRITE rows; each needs a delta or a recorded false positive.
- Guard blind spots that need a hand pass over perf-named files: measurements in a spawned child (`kb/proximity-perf.test.ts`), unlisted helpers, predicate functions (`withinBudget`; the core moved `dependency-declarations` P1/P2 although its guard never flagged them). So the guard's `--list` output is a starting input, not a complete inventory. The core's guard closes split-line assertions, `Map.set` flows and `startLagMonitor`.
- The full list of wrong and missing rows is at the top of `inventory.md`. They came from two adversarial reviews run during planning; the rows listed there are the record.

## Capabilities

### New Capabilities

None expected.

### Modified Capabilities

Expected, to be confirmed at planning:
- `parallel-test-execution`: the core's warn-only guard requirement becomes blocking with no baseline; new requirements for the disposition rule and the REWRITE recipe; MODIFIED "Timeouts and async waits tolerate fork contention" (a performance budget moves instead of scaling in place, reversing `2026-09-12-contention-harden-real-process-tests`); MODIFIED "Real-process tests run in a dedicated low-concurrency phase" (a spawning server budget file may stay in the main project with `// real-process-exempt:`).
- `untrusted-content-guard`, `flows-plugin`: only if their stated bounds move (see above).

## Impact

- **Lane plumbing:** a MOVE into a package whose vitest config does not spread `BUDGET_TEST_EXCLUDE` must add it there; the core's blocking lane check (`scripts/check-budget-lane.mjs`) fails until it does.
- **Code:** the test files of every rebuilt inventory row (about 190 files across 35 package sections), `scripts/check-budget-assertions.mjs` (exceptions, strict mode default in CI), `.github/workflows/ci.yml` (drop `--warn`), `.pi/skills/ship-it/SKILL.md`, `SKILL.agent.md`.
- **Nightly:** the `budget` job's runtime grows with every MOVE; its `timeout-minutes` and the watchdog timing inequality of the core must be re-checked.
- **Active changes:** `harden-agent-tool-guards` plans tail-latency tests (its tasks T.93–T.96); after this change they must be written as `*.budget.test.ts` or the guard fails them. `add-skill-atlas-forest-aura` edits `graph-layout.test.ts`, which the core already splits.

## Non-Goals

- No change to the lane mechanism, the selector, the nightly rerun or CodeQL: the core owns them.
- No re-tuning of thresholds. No trend store.
- No re-move of the cases the core already moved (A9 list).
- No dataflow analysis across modules in the guard.

## Discipline Skills

- `doubt-driven-review`: every REWRITE deletes an asserted duration, and turning the guard blocking with no baseline is a policy step; review the rebuilt inventory before any group applies it.
- `systematic-debugging`: not expected. `security-hardening`, `observability-instrumentation`, `performance-optimization`: not expected; the change moves tests and adds no endpoint, job or secret.
