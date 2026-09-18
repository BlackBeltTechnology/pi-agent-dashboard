# Test plan — guard-server-heap-and-store-coupling

Derived from the proposal and design. Each row carries a level and a
disposition; `automated` rows fold into `tasks.md` one-for-one.

Levels: L1 = vitest unit, L2 = qa shell smoke, L3 = Playwright e2e.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | heap-limits: guard predicate across the range | BVA | L1 | automated | budgets `0`, `384`, `768`, `1024`, `2048` MiB against a `1536` MB ceiling | evaluate `budget × 1.33 + 112 > ceiling × 0.82` | `0` and `2048` warn, `384` and `768` silent, `1024` resolves per the pinned formula and not per an alternative one |
| E2 | heap-limits: constants come from one source | EP | L1 | automated | the shared constants module | read `HEAP_PER_BUDGET_BYTE`, `BASELINE_MB`, `CRASH_RATIO` | all three are exported and the guard reads them rather than inlining literals |
| E3 | heap-limits: invariant passes on a bounded pairing | EP | L1 | automated | server default below `8192`, memory-limits default with a non-zero `maxTotalEventBytes` | evaluate the invariant assertion | the assertion passes |
| E4 | settings-panel: unlimited budget described as unbounded | decision-table | L3 | automated | `maxTotalEventBytes` set to `0` against the default `1536` ceiling | blur the field | the warning describes the store as unbounded and reports no heap figure; the value stays saveable |
| E5 | settings-panel: finite budget names the heap-equivalent | decision-table | L3 | automated | `maxTotalEventBytes` raised to `2048` MiB against a `1536` MB ceiling | blur the field | the warning reports the heap-equivalent rather than the raw budget |
| E6 | settings-panel: warning appears on both fields | decision-table | L3 | automated | an unsafe pairing | render the Server settings page | the warning is surfaced on the server heap field and on the memory-limits budget field |
| E7 | server-launch: Electron path is stamped | EP | L1 | automated | the Electron shell launching via `launchDashboardServer` | build the launch invocation | the invocation carries the configured ceiling and does not fall back to the runtime default |
| E8 | heap-limits: single source for the server default | EP | L1 | automated | the consolidated shared server-heap default | resolve the default on the wrapper, bridge and Electron paths | all three resolve to the same shared constant; no path carries its own literal |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | heap-limits: invariant catches a missing budget default | fault-injection (invariant) | L1 | automated | server default below `8192`, memory-limits default carrying no `maxTotalEventBytes` | evaluate the invariant assertion | the assertion fails and names both defaults |
| X2 | heap-limits: invariant catches an unlimited budget default | fault-injection (invariant) | L1 | automated | server default below `8192`, memory-limits default carrying `maxTotalEventBytes` of `0` | evaluate the invariant assertion | the assertion fails |
| X3 | heap-limits: terminal environment carries no inherited ceiling | fault-injection (leaked env) | L1 | automated | server running under a stamped ceiling | build a dashboard terminal environment | the server's old-space flag is absent from the terminal environment |
| X4 | heap-limits: operator-set flag survives the strip | fault-injection (leaked env) | L1 | automated | an operator-set heap flag distinct from the dashboard stamp | build a dashboard terminal environment | the operator-set flag is preserved |
| X5 | server-launch: operator pin wins on the Electron path | fault-injection (conflicting env) | L1 | automated | Electron launch environment already carrying an operator-set heap flag | build the launch invocation | the launcher does not override it |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X6 | terminal headroom regression is acceptable in practice | exploratory | — | manual-only | a dashboard terminal after the strip | run a heavy Node build in it | the build completes under the runtime default, or the regression is recorded with the host's memory size |

## Coverage summary

- 14 scenarios: 8 edge-case, 5 error-handling, 1 manual (13 automated, 1 manual-only).
- Levels: 10 × L1, 0 × L2, 3 × L3, 1 manual.

## New infra needed

None. L1 rows extend the existing shared and launcher test files; L3 rows extend
the existing settings-panel specs. X6 is exploratory and deferred post-merge.
