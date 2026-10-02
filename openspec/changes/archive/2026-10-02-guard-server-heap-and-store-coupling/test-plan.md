# Test plan — guard-server-heap-and-store-coupling

Derived from the proposal and design. Each row carries a level and a
disposition; `automated` rows fold into `tasks.md` one-for-one.

Levels: L1 = vitest unit, L2 = qa shell smoke, L3 = Playwright e2e.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | heap-limits: guard predicate across the range | BVA | L1 | automated | budgets `0`, `384`, `768`, `1024`, `2048` MiB against a `1536` MB ceiling | evaluate `budget × 1.33 + 112 > ceiling × 0.82` | `0` and `2048` warn, `384` and `768` silent, `1024` resolves per the pinned formula and not per an alternative one |
| E2 | heap-limits: constants come from one source | EP | L1 | automated | the shared constants module | read `HEAP_MB_PER_BUDGET_MIB`, `BASELINE_MB`, `CRASH_RATIO` | all three are exported and the guard reads them rather than inlining literals |
| E3 | heap-limits: invariant passes on a bounded pairing | EP | L1 | automated | server default below `8192`, memory-limits default with a non-zero `maxTotalEventBytes` | evaluate the invariant assertion | the assertion passes |
| E4 | settings-panel: unlimited budget described as unbounded | decision-table | L1 | automated | `maxTotalEventBytes` set to `0` against the default `1536` ceiling | blur the field | the warning describes the store as unbounded and reports no heap figure; the value stays saveable |
| E5 | settings-panel: finite budget names the heap-equivalent | decision-table | L1 | automated | `maxTotalEventBytes` raised to `2048` MiB against a `1536` MB ceiling | blur the field | the warning reports the heap-equivalent rather than the raw budget |
| E6 | settings-panel: warning appears on both fields | decision-table | L1 | automated | an unsafe pairing | render the Server settings page | the warning is surfaced on the server heap field and on the memory-limits budget field |
| E7 | server-launch: Electron path is stamped | EP | L1 | automated | the Electron shell launching via `launchDashboardServer` | build the launch invocation | the invocation carries the configured ceiling and does not fall back to the runtime default |
| E8 | heap-limits: single source for the server default | EP | L1 | automated | the shared `DEFAULT_SERVER_HEAP` (consolidated by the sibling, design D2) | resolve the default on the wrapper, bridge and Electron paths | all three resolve to the same shared constant; wrapper + bridge already pinned by the sibling's tests, Electron fallback asserted here |
| E9 | heap-limits: byte-denominated default does not warn spuriously | EP | L1 | automated | `maxTotalEventBytes` `805306368` (stored bytes) against a `1536` MB ceiling | evaluate the guard | silent — the guard converts bytes to MiB itself |
| E10 | server-launch: unreadable config falls back to the shared default | EP | L1 | automated | Electron launch with `config.json` absent or unparseable | build the launch environment | the shared default ceiling is stamped; the launch does not fail |
| E11 | server-launch: restart preserves the ceiling | EP | L1 | automated | server env stamped by the dashboard, config unchanged | build the `/api/restart` respawn environment | the respawn carries the configured ceiling |
| E12 | server-launch: restart picks up a ceiling edited since boot | EP | L1 | automated | server env stamped at `1536`, config now `2048` | build the `/api/restart` respawn environment | the respawn carries `2048`, not `1536`; no duplicate token |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | heap-limits: invariant catches a missing budget default | fault-injection (invariant) | L1 | automated | server default below `8192`, memory-limits default carrying no `maxTotalEventBytes` | evaluate the invariant assertion | the assertion fails and names both defaults |
| X2 | heap-limits: invariant catches an unlimited budget default | fault-injection (invariant) | L1 | automated | server default below `8192`, memory-limits default carrying `maxTotalEventBytes` of `0` | evaluate the invariant assertion | the assertion fails |
| X3 | heap-limits: terminal environment carries no inherited ceiling | fault-injection (leaked env) | L1 | automated | server running under a stamped ceiling | build a dashboard terminal environment | the server's old-space flag is absent from the terminal environment |
| X4 | heap-limits: operator-set flag survives the strip | fault-injection (leaked env) | L1 | automated | an operator-set heap flag distinct from the dashboard stamp | build a dashboard terminal environment | the operator-set flag is preserved |
| X5 | server-launch: operator pin wins on the Electron path | fault-injection (conflicting env) | L1 | automated | Electron launch environment already carrying an operator-set heap flag | build the launch invocation | the launcher does not override it and adds no flag of its own |
| X7 | heap-limits: operator flag identical to the stamp survives | fault-injection (leaked env) | L1 | automated | operator `--max-old-space-size=1536` with no marker | build a dashboard terminal environment | the flag is preserved |
| X8 | heap-limits: provenance marker does not leak into terminals | fault-injection (leaked env) | L1 | automated | server under a stamped ceiling | build a dashboard terminal environment | the marker variable is absent |
| X9 | server-launch: restart does not shadow an operator pin | fault-injection (conflicting env) | L1 | automated | server env carrying an operator-pinned heap flag | build the `/api/restart` respawn environment | the pin is untouched and no dashboard token is added |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X6 | terminal headroom regression is acceptable in practice | exploratory | — | manual-only | a dashboard terminal after the strip | run a heavy Node build in it | the build completes under the runtime default, or the regression is recorded with the host's memory size |

## Coverage summary

- 21 scenarios: 12 edge-case, 8 error-handling, 1 manual (20 automated, 1 manual-only).
- Levels: 20 × L1, 0 × L2, 0 × L3, 1 manual.
- Reconciled at implementation time (ship-it, user-approved): E4–E6 run as L1
  component tests (vitest + Testing Library) — the folded tasks already pointed
  at those vitest files; E9–E12, X7–X9 added for spec scenarios and design D5
  that had no row; E2 renamed to the design's `HEAP_MB_PER_BUDGET_MIB`.

## New infra needed

None. L1 rows extend the existing shared, launcher, restart, terminal and
settings-panel test files. X6 is exploratory and deferred post-merge.
