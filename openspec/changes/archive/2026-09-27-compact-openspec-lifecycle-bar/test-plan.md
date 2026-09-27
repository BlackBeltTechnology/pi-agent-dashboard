# Test Plan — compact-openspec-lifecycle-bar

Stage: design   Generated: 2026-09-27

No clarifications were outstanding: every Triple is filled from the delta specs, design D1–D9 and the user decisions recorded during the doubt review.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | attach-combo: Lifecycle bar — Tasks/Archive state | decision-table | L1 | automated | `deriveStepperState` with changeState ∈ {PLANNING, READY, IMPLEMENTING, COMPLETE, null} × tasks {0/0, 0/39, 12/39, 39/39} | call derive | Tasks = todo (PLANNING), current (READY/IMPLEMENTING, incl. 39/39), done (COMPLETE); Archive = current iff COMPLETE; null ⇒ all 5 `todo`; returned keys exactly `proposal,design,specs,tasks,archive` |
| E2 | attach-combo: artifact segment states | EP | L1 | automated | artifact status ∈ {done, skipped, ready, blocked, absent} for proposal/design/specs | call derive | maps to done / skipped / current / todo / todo respectively |
| E3 | attach-combo: current-count invariant | decision-table | L1 | automated | READY, IMPLEMENTING (12/39 and 39/39), COMPLETE; PLANNING with design+specs both `ready` | call derive, count `current` | exactly 1 current in READY/IMPLEMENTING/COMPLETE; exactly 2 (`design`,`specs`) in that PLANNING case |
| E4 | attach-combo: Tasks label + fill | BVA | L1 | automated | totalTasks ∈ {0, 1, 39}; completed ∈ {0, 12, total} | render bar | label `Tasks —` + inert `<div>` at 0; `0/1`→fill 0 %; `12/39`→fill style width 31 %±1; `39/39`→100 % |
| E5 | attach-combo: skipped rendering | EP | L1 | automated | specs status `skipped` | render bar | `stepper-segment-specs` has `data-state="skipped"`, label contains `–`, uses `done` token from `statusPresentation` |
| E6 | attach-combo: header primary by state + wf gating | decision-table | L1 | automated | state × workflows {all, core=`propose,explore,apply,archive`, all-minus-archive} | render `SessionOpenSpecActions` | PLANNING: all→`continue-btn`, core→no primary; READY/IMPLEMENTING→`apply-btn`; COMPLETE: all→`archive-btn`, minus-archive→`verify-btn`; no `state-pill`, no inline `explore-btn`, no disabled `archive-btn` in any row |
| E7 | attach-combo: `⋯` contents by state | decision-table | L1 | automated | state × isComplete × workflows(all) | open `openspec-overflow-btn` | PLANNING: FF, Explore…, Detach; READY: Explore…, Detach; IMPLEMENTING+isComplete+artifacts done: Archive anyway…, Explore…, Detach; IMPLEMENTING+isComplete≠true: no Archive anyway; COMPLETE: Verify, Explore…, Detach; each item shows an MDI icon |
| E8 | attach-combo: ended + not-found branches | state-transition | L1 | automated | (a) attached, status `ended`; (b) attachedProposal `archived-change` absent from data | render + open `⋯` | (a) no primary, bar rendered, `⋯` contains only Detach; (b) badge + `⋯` with only Detach, no bar, no standalone `detach-btn` outside the menu |
| E9 | attach-combo: unattached branch unchanged | EP | L1 | automated | attachedProposal null, status active / ended | render | active: attach combo + `+ Change` + enabled `explore-unattached-btn`, no Archive; ended: none of them |
| E10 | chat-view: composer gating | decision-table | L1 | automated | attached {no, yes} × state {IMPLEMENTING 12/39, COMPLETE} | render `ComposerSessionActions` | unattached: enabled `composer-explore-btn`, no archive; attached IMPLEMENTING: no explore, no archive, `composer-artifact-t` text `12/39`, aria-label "Tasks 12 of 39 done", underline width 31 %; attached COMPLETE: enabled `composer-archive-btn` |
| E11 | board: card content | EP | L1 | automated | board change IMPLEMENTING 3/8 | render `OpenSpecBoardView` | card has compact bar with Tasks `3/8`; no `board-card-state`, no `board-card-progress`; no primary / `⋯` in the bar |
| E12 | chat-view i18n: orphan keys | EP | L1 | automated | locale sources `i18n.tsx`, `i18n-hu.ts` | read files | `openspec.node.explore` and `openspec.node.apply` absent; new overflow + segment-name keys present in both |
| E13 | attach-combo: segment accessible names | EP | L1 | automated | design ready, tasks 12/39 | render bar | root `role="group"` named "OpenSpec lifecycle"; `Design, current`; `Tasks 12 of 39 done`; inert segments are not focusable (`<div>`, no tabindex) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| — | none | — | — | — | No spec'd latency/throughput budget; change is presentational. | — | — |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | attach-combo: segment clicks | state-transition | L1 | automated | attached IMPLEMENTING 12/39, idle | click Design, Tasks | `onReadArtifact("add-auth","design")` called once; TasksPopover opens; card `onSelect` not called |
| F2 | attach-combo: Archive segment gating | state-transition | L1 | automated | (a) COMPLETE idle wf all; (b) COMPLETE streaming; (c) IMPLEMENTING | click `stepper-segment-archive` | (a) archive Confirm opens → confirm sends `/skill:openspec-archive-change add-auth`; (b),(c) no dialog, no prompt, segment rendered as `<div>` |
| F3 | attach-combo + task-toggle: streaming | state-transition | L1 | automated | attached IMPLEMENTING 12/39, status `streaming` | click Proposal, click Tasks, open `⋯` | proposal opens; Tasks does not open popover; primary `aria-disabled="true"` title "Session is streaming"; menu items disabled except Detach |
| F4 | attach-combo: portal bubbling | state-transition | L1 | automated | `SessionCard` (not selected) with attached change | open `⋯`, select Explore… | ExploreDialog opens; card `onSelect` spy called 0 times |
| F5 | attach-combo: keyboard menu | state-transition | L1 | automated | attached READY | focus `⋯`, press Enter; press Escape | after rAF, `document.activeElement` = first enabled item; after Escape menu gone and focus on `openspec-overflow-btn` |
| F6 | attach-combo: Explore change-scoped | state-transition | L1 | automated | attached `add-auth` | `⋯` → Explore… → submit `what does step 3 mean?` | `onSendPrompt("/skill:openspec-explore add-auth\nwhat does step 3 mean?")` |
| F7 | attach-combo: Detach via `⋯` | state-transition | L1 | automated | attached, idle and ended | `⋯` → Detach | `onDetach` called once; unattached combo renders after prop update |
| F8 | card-section: board session-row panel | state-transition | L1 | automated | board card with session row attached to IMPLEMENTING change | open `session-os-menu-<id>` → `⋯` → Detach | `onDetachProposal(<id>)` called; no navigation callback; no dnd drag start |
| F9 | board: segment press vs drag | state-transition | L3 | automated | board with one card, proposal done | pointer-down + up on `stepper-segment-design` inside card | artifact dialog opens; card stays in its column (no reorder, no drag overlay `DragChip`) |
| F10 | attach-combo + board: container-query collapse | BVA | L3 | automated | session card and board card; viewport/pane so bar width = 280 px, 251 px, 249 px, 220 px | render | ≥250 px: labels `✓ PROPOSAL`… full; <250 px: labels `P D S A`, Tasks still `12/39`; no segment overflows its card (bar scrollWidth ≤ clientWidth) |
| F11 | attach-combo: hit target | BVA | L3 | automated | session card, IMPLEMENTING | measure every interactive `stepper-segment-*` boundingBox | height ≥ 24 px for all |
| F12 | attach-combo: reduced motion | EP | L3 | automated | COMPLETE change (Archive current), `emulateMedia({reducedMotion:"reduce"})` | read computed `animation-name` of Archive track | `none`; without emulation ≠ `none` |
| F13 | chat-view: tasks chip while streaming | state-transition | L1 | automated | composer bound to streaming session, attached 12/39 | click P chip, click tasks chip | P → `onReadArtifact` called; tasks chip `disabled`, popover not opened |
| F14 | mockup parity (visual) | visual/subjective | — | manual-only | session card PLANNING/IMPLEMENTING/COMPLETE, board card, composer strip; Studio + Light | human compares to `mockups/openspec-compact-states/index.html` | [judgment: looks like mockup, ≈48 px block, no clipped labels at 300 px] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | attach-combo: missing change | fault-injection (abort) | L1 | automated | attached change removed from OpenSpec data between renders | re-render | bar + primary disappear; badge + `⋯` (Detach only) remain; no throw |
| X2 | attach-combo: no onArchive / onReadArtifact | EP | L1 | automated | bar rendered with `onReadArtifact` undefined and `onArchive` undefined (board compact) | click Proposal, Archive | no throw; Archive inert; Proposal rendered inert when no handler |

---

## Coverage summary

- Requirements covered:
  - attach-combo: 4 ADDED/MODIFIED + 4 REMOVED (asserted by absence);
  - board: 2;
  - chat-view: 1;
  - card-section: 2 (F8; worktree Tasks-count via E11 + existing worktree tests);
  - board-status-visuals: 1 (existing stripe tests; wording only);
  - task-toggle: 1 (F3, E4 + existing TasksPopover tests).
- Scenarios by class: edge 13 · perf 0 · frontend 14 · error 2
- Scenarios by level: L1 24 · L2 0 · L3 4
- Scenarios by disposition: automated 28 · manual-only 1

## New infra needed

- none. L3 rows extend existing Playwright specs (`openspec-init-affordances-session-card.spec.ts`, `openspec-board-drop.spec.ts`) against the docker harness. Read the port from `.pi-test-harness.json` and never hardcode it.
