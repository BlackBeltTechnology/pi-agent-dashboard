# Tasks

## 1. Implementation

- [ ] 1.1 `packages/automation-plugin/src/client/AutomationBoard.tsx` main branch (~L257): root becomes the unpadded scroller `flex flex-col flex-1 min-h-0 overflow-y-auto text-sm`; the header row (~L258) becomes `sticky top-0 z-10 shrink-0 px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)]`; everything below the header moves into a body wrapper `flex flex-col gap-3 p-3` (design D1, D2). The invalid-scope root (~L241) gets the same root classes only, with no restructure.
- [ ] 1.2 `AutomationBoard.tsx`: `min-w-0` on the title group (~L259) and `truncate` on the `h2` and the crumb (~L266), so a long folder name cannot force horizontal overflow (design D4).
- [ ] 1.3 `packages/automation-plugin/src/client/AutomationRunMonitor.tsx` (~L113-123): same root / sticky header / body-wrapper structure; add `data-testid="automation-run-monitor-back"` to the Back button; `min-w-0 truncate` on the header `h2`; wrap `runId`; put the findings block in a `min-w-0 overflow-x-auto` wrapper (design D4, D5).
- [ ] 1.4 `CreateAutomationDialog`: check the design pass criterion (375x667 and 1440x900, every section expanded, last field and Save/Cancel reachable). If it is red, render the dialog through a `document.body` portal (design Risks).

## 2. Tests

L3 cases extend `tests/e2e/overlay-layout.spec.ts` in a new `describe("automation overlay scroll")` block. `beforeAll` seeds the `sbs-` definitions and run; `afterAll` removes them even on failure. Seeding glue: copy `seedDeclaredRun`/`cleanupSeeded` from `tests/e2e/archive-service-sessions-on-end.spec.ts` and the create REST call from `tests/e2e/automation-fanout.spec.ts`. L1 cases extend the sibling `packages/automation-plugin/src/__tests__/*.test.tsx`.

- [ ] 2.1 L1 board class guard: render `AutomationBoard` with a valid route and with an invalid-scope route, then inspect classes. Both roots contain `flex-1 min-h-0 overflow-y-auto`, and the valid branch's Back header contains `sticky top-0`. Exemplar `packages/automation-plugin/src/__tests__/AutomationBoard.test.tsx` (test-plan #U1)
- [ ] 2.2 L1 run-monitor guard: render `AutomationRunMonitor` with an ended run and an `onBack` spy, inspect classes, click `automation-run-monitor-back`. Root contains `flex-1 min-h-0 overflow-y-auto`, the header is `sticky`, and `onBack` is called once. Exemplar `packages/automation-plugin/src/__tests__/AutomationRunMonitor.test.tsx` (test-plan #U2)
- [ ] 2.3 L3 desktop reachability: 12 seeded `sbs-*` definitions at 1440x900, open the board, scroll `automation-board` to its end. Its `overflow-y` is auto and its height is bounded by the panel, the last `sbs-*` card is inside the panel box, and the panel is not clipped. Exemplar: the E5 block in `tests/e2e/overlay-layout.spec.ts` (test-plan #E1)
- [ ] 2.4 L3 mobile reachability: 12 seeded definitions at 375x667, open the board, scroll to the end. The board is a bounded vertical scroller and the last `sbs-*` card is inside the viewport. Exemplar `tests/e2e/overlay-layout.spec.ts` (test-plan #E2)
- [ ] 2.5 L3 short list: no `sbs-*` definitions (run before seeding) at 1440x900, open the board. Board `scrollHeight` ≤ `clientHeight` + 4 and the panel is not clipped. Exemplar `tests/e2e/overlay-layout.spec.ts` E6 (test-plan #E3)
- [ ] 2.6 L3 single scroller: the 12-definition state at 1440x900, count the overflowing auto/scroll descendants of the panel. Exactly 1, and it is `automation-board`. Exemplar: the `measure()` scrollers probe in `tests/e2e/overlay-layout.spec.ts` (test-plan #E4)
- [ ] 2.7 L3 board no horizontal scroll: one definition named `sbs-` plus 110 × `x` at 375x667, open the board. Board `scrollWidth` ≤ `clientWidth` + 1. Exemplar `tests/e2e/overlay-layout.spec.ts` (test-plan #E5)
- [ ] 2.8 L3 run monitor reachability: seeded run with a 200-line `result.md` at 1440x900, open `/automations/run/<sid>`, scroll `automation-run-monitor` to its end. The root is a bounded vertical scroller and `sbs finding 200` is inside the panel box. Exemplar: the run monitor case in `tests/e2e/archive-service-sessions-on-end.spec.ts` (test-plan #E6)
- [ ] 2.9 L3 run monitor wide markdown: seeded run whose `result.md` has a 30-column table and a 400-char code line, open the run monitor. Root `scrollWidth` ≤ `clientWidth` + 1; the findings wrapper scrolls horizontally, and its last header cell can be reached. Exemplar `tests/e2e/archive-service-sessions-on-end.spec.ts` (test-plan #E7)
- [ ] 2.10 L3 board Back while scrolled: the 12-definition state, scroll the board to its end. `automation-board-back` is inside the panel and is the hit-test target at its centre, and clicking it leaves `/automations`. Exemplar: the occlusion probe in `tests/e2e/overlay-layout.spec.ts` F5 (test-plan #F1)
- [ ] 2.11 L3 run monitor Back while scrolled: the 200-line run state, scroll to the end. `automation-run-monitor-back` is inside the panel and is the hit-test target. Exemplar `tests/e2e/overlay-layout.spec.ts` F5 (test-plan #F2)
- [ ] 2.12 L3 create dialog reachable: open Create Automation from the board at 375x667 and at 1440x900, scroll the dialog panel to its end. The Save button is inside the viewport at both sizes; if it is not, do task 1.4's portal fix. Exemplar `tests/e2e/automation-fanout.spec.ts` (create flow) (test-plan #F3)
- [ ] 2.13 Manual check, post-merge: on desktop and mobile, with the board scrolled mid-list, confirm the sticky `--bg-primary` header strip reads as intentional (KB parity) with no content showing through above it (test-plan: manual-only, #F4)

## 3. Docs and closeout

- [ ] 3.1 Update the `AutomationBoard.tsx` and `AutomationRunMonitor.tsx` rows in `packages/automation-plugin/src/client/AGENTS.md` with `See change: fix-automation-board-scroll`; if a row is over the size cap, promote it to a per-file `<File>.AGENTS.md` sidecar per the dox size rule.
- [ ] 3.2 After the PR is merged, close GitHub issue #1158 with a comment naming the merged PR number: `gh issue close 1158 --comment "Fixed by #PR_NUMBER (fix-automation-board-scroll)"`, substituting the real number.
