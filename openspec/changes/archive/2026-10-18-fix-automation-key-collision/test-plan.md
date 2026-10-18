# Test Plan — fix-automation-key-collision

Stage: design   Generated: 2026-10-17

Hard gate passed with no clarifications: every Triple slot below fills from the
two MODIFIED deltas. Observables are fire counts on an injected `onFire` /
`startRun`, `armedKeys()` membership, admitted vs dropped runs, and the existing
skip log line (`runner.ts:92`).

Notation: `A@/x` = an automation named `A` whose definition lives under scope base
`/x` (its `dir` is `/x/.pi/automation/A`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | trigger-registry: Same-named automations in different directories are both scheduled | EP (same name × distinct dir) | L1 | automated | `deploy@/x` cron `*/2 * * * *`, `deploy@/y` cron `*/3 * * * *`, both `scope: folder` | one `armAll([deploy@/x, deploy@/y])`; advance clock 6 min | `armedKeys()` has 2 entries; `onFire` called 3× for `/x` and 2× for `/y`, each call carrying its own automation's `dir` |
| E2 | trigger-registry: Removing one same-named automation leaves the other running | state-transition (armed → disposed, sibling untouched) | L1 | automated | `deploy@/x` and `deploy@/y` armed, both `*/2 * * * *` | `armAll([deploy@/y])` (x removed); advance 4 min | `armedKeys()` has exactly 1 entry, the `/y` one; `onFire` for `/x` called 0× after removal; for `/y` called 2× |
| E3 | trigger-registry: A definition presented twice at one path is armed once | BVA (duplicate count 1 → 2) | L1 | automated | `deploy@/x` cron `*/2 * * * *` | `armAll([deploy@/x, deploy@/x])` (same `dir` string twice); advance 2 min | `armedKeys()` has 1 entry; `onFire` called exactly 1× for that occurrence |
| E4 | trigger-registry: No trigger survives disposal | state-transition (armed → disposeAll) | L1 | automated | `deploy@/x` presented twice plus `deploy@/y`, all `*/2 * * * *` | `armAll([…])` then `disposeAll()`; advance 10 min | `armedKeys()` is empty; `onFire` called 0× after disposal (this is the leaked-timer defect: it fails on the pre-change code) |
| E5 | trigger-registry: identity is the discovered path, not canonicalized | EP (two spellings of one dir) | L1 | automated | real tmp dir `T` containing `.pi/automation/deploy/automation.yaml`, plus symlink `L → T` (skip on `win32` if symlink creation is unprivileged-denied, matching repo precedent in `packages/craft-apps/src/__tests__/security.test.ts`) | engine scans folder scopes `[T, L]`; advance one cron period | `armedKeys()` has 2 entries (`…T/.pi/automation/deploy`, `…L/.pi/automation/deploy`); each fires once per occurrence (pins the documented known limitation so a future change to it is deliberate) |
| E6 | trigger-registry: scope stays part of identity | decision-table (scope × base) | L1 | automated | home dir `H` with automation `homeauto`, passed as both a global scope and a contributed folder base | engine start with the home-drop rule applied (existing E7 setup in `engine.test.ts`) | exactly one armed entry, under `global`, none under `folder` (existing E7 expectation, re-expressed in the new key format) |
| E7 | trigger-registry: same name across global and folder scopes | decision-table (scope global/folder × same name) | L1 | automated | `sync` in home `H` (global) and `sync@/x` (folder), both `*/2 * * * *` | engine start; advance 2 min | 2 armed entries; `onFire` called once for each per occurrence |
| E8 | trigger-registry: Edit re-arms cleanly (regression under new key) | state-transition (edit) | L1 | automated | `deploy@/x` armed with `*/2 * * * *`; sibling `deploy@/y` armed with `*/5 * * * *` | rewrite `/x`'s cron to `*/3 * * * *`, run `armAll` with updated list; advance 6 min | `/x` fires 2× (on the `*/3` schedule, 0× on the old `*/2` boundaries); `/y` fires 1×; no duplicate fire for any occurrence |
| E9 | trigger-registry: directory rename | state-transition (delete old dir + create new dir) | L1 | automated | `deploy@/x` armed `*/2 * * * *` | `armAll` with the definition now at `/x/.pi/automation/deploy-v2` (old `dir` gone); advance 4 min | `armedKeys()` contains only the `deploy-v2` entry; old entry fires 0×; new fires 2× |
| E10 | run-lifecycle: Same-named automations do not block each other | decision-table (policy=skip × same/different definition) | L1 | automated | `deploy@/x` and `deploy@/y`, both `concurrency: skip`; a run of `/x` is active | `runner.fire(deploy@/y)` | `startRun` called for `/y` (run admitted); no `[runner] skip: drop overlapping fire` log line for `/y` |
| E11 | run-lifecycle: skip drops overlapping fire (regression under new key) | decision-table (policy=skip × same definition) | L1 | automated | `deploy@/x`, `concurrency: skip`, a run of `/x` active | `runner.fire(deploy@/x)` | `startRun` not called again; exactly one `[runner] skip: drop overlapping fire` log line whose key is `/x`'s key |
| E12 | run-lifecycle: queue defers overlapping fire, and only for the same definition | decision-table (policy=queue × same/different definition) | L1 | automated | `deploy@/x` and `deploy@/y`, both `concurrency: queue`; a run of `/x` active | `fire(deploy@/x)`, then `fire(deploy@/y)` | `/y` starts immediately; `queuedCount(keyOf /x)` = 1 and `queuedCount(keyOf /y)` = 0 |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | run-lifecycle: queue drain targets the completing definition only | state-transition (completeRun with wrong-slot risk) | L1 | automated | `deploy@/x` and `deploy@/y` both `concurrency: queue`, each with one active run and one queued fire | `completeRun(keyOf /x)` | exactly one new `startRun`, for `/x`'s queued fire; `/y`'s queued fire still pending (`queuedCount(keyOf /y)` = 1). On the pre-change code both share one slot and this fails |
| X2 | trigger-registry: a definition deleted while its same-named sibling is mid-run | fault-injection (abort: definition removed under load) | L1 | automated | `deploy@/x` and `deploy@/y` armed `*/2 * * * *`; a run of `/y` active | remove `/x` via `armAll([deploy@/y])` while `/y` runs; advance 4 min | `/x` fires 0×; `/y`'s active run is not disposed or aborted; `/y` keeps firing per its policy |
| X3 | trigger-registry: re-arm by caller-supplied key | fault-injection (stale identifier) | L1 | automated | `deploy@/x` armed | `rearmOne(<new-format key of /x>, updated deploy@/x)` (replaces the old-format `rearmOne("folder:a", …)` call at `scheduler.test.ts:250`) | `armedKeys()` has 1 entry; the pre-rearm trigger fires 0× afterwards (no stale trigger left behind) |

---

## Coverage summary

- Requirements covered: 10/10 (7 trigger-registry scenarios incl. 2 unchanged
  regressions, 3 run-lifecycle scenarios incl. 2 unchanged regressions) plus the
  non-canonicalization rule (E5)
- Scenarios by class: edge 12 · perf 0 · frontend 0 · error 3
- Scenarios by level: L1 15 · L2 0 · L3 0
- Scenarios by disposition: automated 15 · manual-only 0

No performance scenario: the change adds no I/O and no requirement states a
latency budget (realpath was deliberately dropped). No frontend scenario: the
board/role-label collision is an explicit non-goal (proposal, "Known UI
follow-up").

## New infra needed

none — every row extends an existing vitest file:
`packages/automation-plugin/src/__tests__/scheduler.test.ts` (E1–E4, E8, E9,
X2, X3), `runner.test.ts` (E10–E12, X1), `engine.test.ts` (E5–E7). The
`scheduleAutomation(name, cron)` helper (`scheduler.test.ts:87`) needs a `dir`
/ base parameter so two same-named automations can differ by location.
