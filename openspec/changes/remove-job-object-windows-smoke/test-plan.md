# Test Plan — remove-job-object-windows-smoke

Stage: proposal (HARD gate, no open clarifications)   Generated: 2026-10-19

Scope: the change is a removal. The production runtime is untouched, so the testable surface is the workflow contract (`packages/shared/src/__tests__/e2e-electron-workflow-contract.test.ts`, validator `electronWorkflowViolations()`, helper `workflow-jobs.ts`). The scenarios try to break the widened rule "no job in `ci-e2e-electron.yml` carries `continue-on-error`" and the removal itself.

Regression guards that already exist and must stay green, not re-listed as rows:
- (E13) `runtime-overlay-e2e` `noGate` mutation and synthetic `foo` job → `not skipped on \`schedule\``.
- (E14) `electron-e2e` `continue-on-error: true` and `${{ matrix.os == 'macos-latest' }}` mutations → violation; `electronWorkflowViolations(yaml)` on the real workflow `toEqual([])`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | `job-object-windows` removed from `ci-e2e-electron.yml` | state (removal) | L1 | automated | real `.github/workflows/ci-e2e-electron.yml` after task 2.1 | `jobIds(yaml)` | result contains `electron-e2e` and `runtime-overlay-e2e`, and does NOT contain `job-object-windows` |
| E2 | no job carries `continue-on-error` (widened from `electron-e2e`-only) | decision-table (job × key present) | L1 | automated | real workflow with `    continue-on-error: true` inserted under `  runtime-overlay-e2e:` | `electronWorkflowViolations(mutated)` | output contains `runtime-overlay-e2e: must not be continue-on-error` |
| E3 | rule enumerates jobs, not a hard-coded list | decision-table (unknown job) | L1 | automated | real workflow plus an appended job `  foo:` with `    continue-on-error: true`, `runs-on`, and one step | `electronWorkflowViolations(mutated)` | output contains `foo: must not be continue-on-error` |
| E4 | key is banned regardless of value | BVA (value: `false`) | L1 | automated | real workflow with `    continue-on-error: false` inserted under `  runtime-overlay-e2e:` | `electronWorkflowViolations(mutated)` | output contains `runtime-overlay-e2e: must not be continue-on-error`, the same as the `true` case and consistent with the existing `electron-e2e` rule |
| E5 | widened rule does not false-positive on comment prose | BVA (indent / comment boundary) | L1 | automated | real workflow with the 4-space comment line `    # continue-on-error: true is forbidden here` inserted under `  runtime-overlay-e2e:` | `electronWorkflowViolations(mutated)` | output contains NO `must not be continue-on-error` entry (the `^ {4}continue-on-error:` anchor ignores `#` lines). Also: the real workflow's new column-0 `COVERAGE GAP` header comment yields `[]` |

### Performance

None. There is no latency or throughput surface.

### Frontend-quirk

None. There is no UI surface.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | removal leaves remaining legs running on GHA | post-merge observation | — | manual-only | none (real GitHub Actions run) | first Electron-touching PR after merge triggers `ci-e2e-electron.yml` | the run's job list has no `job-object-windows`; `electron-e2e (ubuntu-latest)`, `electron-e2e (windows-latest)` and `runtime-overlay-e2e` each report a verdict; the run has no always-red job |

---

## Coverage summary

- Requirements covered: 4/4 (removal, widened `continue-on-error` ban, enumeration, comment false-positive guard), plus 1 post-merge observation.
- Scenarios by class: edge 5 · perf 0 · frontend 0 · error 1
- Scenarios by level: L1 5 · L2 0 · L3 0 · — 1
- Scenarios by disposition: automated 5 · manual-only 1

## New infra needed

- None. All L1 rows extend the existing `e2e-electron-workflow-contract.test.ts` using its `mutate()` / `jobIds()` / `jobBlock()` helpers.
