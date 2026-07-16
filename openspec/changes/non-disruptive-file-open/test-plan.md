# Test Plan — non-disruptive-file-open

Stage: design   Generated: 2026-07-16

All HARD-gate clarifications resolved (unread-clear invariant, re-pulse, reduced-motion).
No open markers.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | reducer openFile activate flag | decision-table | L1 | automated | `activate:false`, tab NOT open | dispatch openFile | tab pushed; `activeIndex` unchanged; new tab `unread:true` |
| E2 | reducer openFile activate flag | decision-table | L1 | automated | `activate:false`, tab open + INACTIVE | dispatch openFile | `activeIndex` unchanged; that tab `unread:true` (re-signal) |
| E3 | reducer openFile activate flag | decision-table | L1 | automated | `activate:false`, tab open + ACTIVE | dispatch openFile | no-op; active tab stays `unread:false` (invariant) |
| E4 | reducer openFile default | decision-table | L1 | automated | `activate` omitted (undefined) | dispatch openFile | tab activated; `unread` unset (back-compat with today) |
| E5 | active-tab-never-unread invariant | state-transition | L1 | automated | unread inactive tab adjacent to active | `closeTab` active tab → adjacent becomes active | newly-active tab `unread` cleared (not only via setActive) |
| E6 | isValidState tolerates unread | EP | L1 | automated | persisted blob with NO `unread` field | `loadEditorPaneState` | loads valid; tabs render; no throw |
| E7 | isValidState type-guards unread | BVA (invalid) | L1 | automated | persisted blob `unread: 42` | `loadEditorPaneState` | rejected as corrupt → EMPTY_PANE_STATE, logged |
| E8 | unread persists | EP | L1 | automated | background tab `unread:true`, not activated | save → load (reload) | tab still present, still `unread:true` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | mode: reveal only from closed | state-transition | L1 | automated | mode `closed` | `openInSplit('a.ts')` (foreground) | `split.mode === 'split'`; `a.ts` active |
| F2 | mode: full is sticky | state-transition | L1 | automated | mode `full` | `openInSplit('a.ts')` (foreground) | `split.mode === 'full'`; `a.ts` active; chat stays hidden |
| F3 | mode: split stays split | state-transition | L1 | automated | mode `split` | `openInSplit('a.ts')` | `split.mode === 'split'`; `a.ts` active |
| F4 | openChanges from full stays full | state-transition | L1 | automated | mode `full` | `openChanges()` | `split.mode === 'full'` (was `split` pre-change — F9 rewrite) |
| F5 | user click always activates | decision-table | L1 | automated | mode `split`/`full`, reading `a.ts` | user `openInSplit('b.ts')` | `b.ts` active; `b.ts` NOT unread |
| F6 | agent open silent when shown | decision-table | L1 | automated | mode `split`/`full`, reading `a.ts` | `openInSplit('b.ts',{background:true})` | `a.ts` stays active; `b.ts` added `unread`; mode unchanged |
| F7 | agent open from closed shows it | state-transition | L1 | automated | mode `closed` | `openInSplit('b.ts',{background:true})` | mode→`split`; `b.ts` active; NOT unread |
| F8 | background path — live target | decision-table | L1 | automated | mode `split`, reading `a.ts` | `openLiveTarget(url,{background:true})` | live tab added `unread`; `a.ts` active |
| F9 | background path — url target | decision-table | L1 | automated | mode `split`, reading `a.ts` | `openUrlTarget(url,{background:true})` | url tab added `unread`; `a.ts` active |
| F10 | pendingScroll guard | state-transition | L1 | automated | background open with `line=20` | dispatch background open | NO `pendingScroll` stashed; active tab scroll unaffected |
| F11 | deep-link param-less sticky | state-transition | L3 | automated | mode `full` | navigate `/session/:id/editor` (no `file`) | mode stays `full` (routed via ensureRevealed) |
| F12 | auto-canvas silent while reading | state-transition | L3 | automated | desktop, `split`, reading `a.ts` | agent canvas target → `b.ts` | `a.ts` stays active; `b.ts` tab unread + dot; mode unchanged |
| F13 | auto-canvas reveals from closed | state-transition | L3 | automated | desktop, `closed` | agent canvas target → `b.ts` | mode→`split`; `b.ts` active |
| F14 | mobile: no yank, chip shown | state-transition | L3 | automated | mobile viewport (<768w) | canvas target changes | no pane yanked; `canvas-file-chip` visible |
| F15 | mobile chip tap = foreground | decision-table | L3 | automated | mobile chip shown | user taps chip | target opens as active tab; NOT unread |
| F16 | unread dot renders + clears | state-transition | L1 | automated | tab strip with a background `unread` tab | render, then click it | dot present on unread tab; gone after activation |
| F17 | re-pulse on repeat background | state-transition | L1 | automated | `b.ts` already open, unread, inactive | second background open of `b.ts` | pulse re-triggers; `b.ts` stays unread + inactive |
| F18 | pulse smoothness / one-shot feel | visual/subjective | — | manual-only | editor with a background tab arriving | human watches the pulse | [judgment: pulse plays once, feels non-jarring, draws the eye without stealing focus] |
| F19 | reduced-motion → dot only | state-transition | L3 | automated | `prefers-reduced-motion: reduce` set | background tab arrives | unread dot shows; NO pulse animation runs |
| F20 | changed-files rail-in-full visual | visual/subjective | — | manual-only | mode `full` | click header Changed-Files chip | [judgment: Changes/tree rail expands inside the editor with chat hidden; layout reads OK, not cramped] |

---

## Coverage summary

- Requirements covered: mode-stickiness, focus-intent, reducer+persistence, all-3-canvas-openers, shared-callsite, deep-link, unread affordance + a11y — full spec-delta coverage.
- Scenarios by class: edge 8 · perf 0 · frontend 20 · error 0
- Scenarios by level: L1 16 · L2 0 · L3 6 · manual-only 2 (F18, F20)
- Scenarios by disposition: automated 26 · manual-only 2

## New infra needed

- none — L1 extends `packages/client/src/**/__tests__/*.test.ts` (incl. the existing
  `SplitWorkspaceContext.test.tsx` where the `F9`/`F4` rewrite lands); L3 extends
  `tests/e2e/*.spec.ts` against the docker harness port from `.pi-test-harness.json`
  (`dashboardPort`, never hardcoded `:18000`).
