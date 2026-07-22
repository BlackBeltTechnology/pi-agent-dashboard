# Test Plan — fix-goal-detail-turns-and-spend

Stage: design   Generated: 2026-07-21

No clarifications needed — every Triple's slots fill concretely from the spec
(values `1/3`, `0.39`, `$0.29 / $5.00`, `~6%` fill, non-persistence invariant).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 turns fallback | decision-table | L1 | automated | `snap=null`, record `lastKnownTurnsUsed:1`, `budget.maxTurns:3` | resolve turns for the gauge | resolved numerator `1`, denominator `3` → `1/3` |
| E2 | R1 live precedence | decision-table | L1 | automated | `snap={turnsUsed:2,maxTurns:5}`, record `lastKnownTurnsUsed:1`, `budget.maxTurns` unset | resolve turns | live wins → `2/5` |
| E3 | R1 no data | decision-table | L1 | automated | `snap=null`, `lastKnownTurnsUsed` undefined, `budget.maxTurns:3` | resolve turns | numerator placeholder → `—/3` |
| E4 | R1 zero boundary | BVA | L1 | automated | `snap=null`, `lastKnownTurnsUsed:0`, `budget.maxTurns:3` | resolve turns (`?? 0` must keep 0) | `0/3` (0 not treated as absent) |
| E5 | R2 sum | EP | L1 | automated | goal `sessionIds=[a,b]`, sessions cost `0.10`,`0.29` | `decorateGoalsWithSpend` | `totalSpendUsd === 0.39` |
| E6 | R2 empty | boundary | L1 | automated | goal `sessionIds=[]` | decorate | `totalSpendUsd === 0` |
| E7 | R2 costless session | boundary | L1 | automated | session resolves, `cost` undefined | decorate | that session contributes `0` |
| E8 | R2 unresolvable id | boundary | L1 | automated | `sessionIds=[missing]`, `sessionManager.get→undefined` | decorate | contributes `0`, no throw |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R1 detail reload | state-transition | L3 | automated | a goal pursued to `achieved`, driver session ended, record `lastKnownTurnsUsed:1`,`maxTurns:3` | reload the goal detail page (no live snapshot) | turns gauge converges to `1/3`, never `—/3` |
| F2 | R1 board surface | state-transition | L3 | automated | same completed goal | view the goals board | `TurnRing` reflects `lastKnownTurnsUsed` (non-empty), not placeholder |
| F3 | R3 detail spend render | state-convergence | L3 | automated | record `totalSpendUsd:0.29`, no `maxSpendUsd` | render detail spend gauge | shows `$0.29 · no cap`, no fill element |
| F4 | R3 detail spend vs cap | state-convergence | L3 | automated | record `totalSpendUsd:0.29`, `maxSpendUsd:5` | render detail spend gauge | shows `$0.29 / $5.00` + fill ≈6% |
| F5 | R3 board spend render | state-convergence | L3 | automated | completed goal `totalSpendUsd:0.29` | view the goals board | board spend block shows `$0.29` (not cap-only / 0% bar) |
| F6 | R3 zero/absent | boundary | L1 | automated | `totalSpendUsd` absent or `0` | `fmtUsd`/gauge format | renders `$0.00`; `fmtUsd(0.29)→"$0.29"`, `fmtUsd(5)→"$5.00"`, `gaugePct(0.29,5)≈6` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R2 lookup throws | fault-injection (abort) | L1 | automated | `sessionManager.get` throws for one sid | decorate a goal with a good + a throwing sid | throwing sid contributes `0`, other sid summed, no 5xx / no propagation |
| X2 | R2 non-persistence on mutation path | state-transition | L1 | automated | a goal create/update/link/unlink (cache-aliased record) then decorate the response | perform the mutation, read persisted `<folderHash>.json` | stored file has NO `totalSpendUsd` (pure helper never mutates cache) |
| X3 | R2 every delivery path carries spend | state-transition | L1 | automated | a goal with linked-session cost | fetch via GET, and emit a `goals_update` broadcast | both the GET record and the broadcast payload record carry `totalSpendUsd` |
| X4 | R2 cold-start self-heal | fault-injection (delay) | L1 | automated | `sessionManager` returns `cost:0` (stats not yet scanned) then `0.29` | decorate before vs after scan | first read `totalSpendUsd:0`, later read `0.39` (self-heals) |

---

## Coverage summary

- Requirements covered: 3/3 (R1 turns, R2 spend-derivation, R3 spend gauge)
- Scenarios by class: edge 8 · perf 0 · frontend 6 · error 4
- Scenarios by level: L1 13 · L2 0 · L3 5
- Scenarios by disposition: automated 18 · manual-only 0

## New infra needed

- none — L1 extends existing `packages/server/src/__tests__/goal-*.test.ts` +
  `packages/goal-plugin/src/__tests__/goal-state.test.ts`; L3 extends
  `tests/e2e/*.spec.ts` (goal exemplar: `bus-client-goal-plugin-action.spec.ts`).
