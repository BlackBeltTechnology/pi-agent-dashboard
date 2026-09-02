# Test Plan — add-current-folder-to-add-flow

Stage: design   Generated: 2026-09-03

All scenarios are component-behavior with checkable DOM / MDI-path / callback
observables, authored at L1 (vitest + @testing-library) in the existing
`packages/client/src/components/__tests__/PathPicker.test.tsx`. No rendered-UI
assertion needs the docker harness, so no L3 rows. No spec gaps — every Triple
fills concretely.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Self-row activation toggles selection | state-transition | L1 | automated | picker browsing `/home/user`, self-row unticked | click self-row body | `/home/user` enters basket; browsed dir stays `/home/user` (no browse call fires); primary action reads a 1-item label |
| E2 | Self-row activation toggles selection (off) | state-transition | L1 | automated | self-row for `/home/user` ticked (1 in basket) | press Enter while self-row highlighted | basket empty; primary action disabled |
| E3 | Self-row has no chevron + open-folder glyph | decision-table | L1 | automated | picker browsing `/home/user` | render self-row | self-row contains the open-folder `@mdi/js` path; self-row contains NO `mdiChevronRight` element |
| E4 | Committing self-row pins current dir | state-transition | L1 | automated | self-row `/home/user` ticked, sole selection | click commit | `onPin` called once with `/home/user`; dialog closes (`onCancel`/close fires) |
| E5 | Self-row coexists with child selections | EP | L1 | automated | self-row `/home/user` ticked | navigate into `/home/user/projects`, tick `alpha` child | basket = {`/home/user`, `/home/user/projects/alpha`}; primary action reads a 2-item label |
| E6 | Self-row + equivalent child do not double-count | BVA (trailing-sep boundary) | L1 | automated | self-row ticked while browsing `/home/user/work/` (trailing separator) | navigate to `/home/user`; `work` child (path `/home/user/work`) renders | `work` child checkbox renders checked; basket contains the dir exactly once (1-item label) |
| E7 | Current dir with live sessions badged on self-row | EP | L1 | automated | `sessionCounts` has 2 for `pathKey('/home/user')`; browsing `/home/user` | render self-row | self-row renders a session-count badge reading 2 sessions |
| E8 | Filesystem-root self-row has non-empty pill label | BVA (root boundary) | L1 | automated | picker browsing `/` (root) | tick self-row; basket pill renders | pill label is non-empty; pill remove control `aria-label` is non-empty |
| E9 | Self-row absent when no current dir resolved | state-transition | L1 | automated | initial default-directory load, no resolved current dir | render | no self-row element in the list |
| E10 | Child-row activation still descends (regression) | decision-table | L1 | automated | picker browsing `/home/user` | click `work` child row body | picker browses `/home/user/work`; `work` NOT added to basket |
| E11 | Single-select mode unaffected (invariant) | decision-table | L1 | automated | `PathPicker` rendered WITHOUT `selection` prop, browsing `/home/user` | render | no self-row; no `CONTENTS` label; no row checkboxes (existing single-select layout intact) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | CONTENTS label skipped by keyboard traversal | state-transition | L1 | automated | self-row + `CONTENTS` label + child rows rendered, highlight on self-row | press ArrowDown | highlight lands on the next selectable row (`..` or first child); the `CONTENTS` label has no `role="option"` and never becomes highlighted |
| F2 | CONTENTS label separates the two groups | state-transition | L1 | automated | resolved current directory | render | a `CONTENTS` label renders below the self-row and above `..`; NO label renders above the self-row |
| F3 | Space toggles the self-row | decision-table | L1 | automated | self-row highlighted, unticked | press Space | self-row selection toggles on (`/home/user` enters basket); the input value gains no literal space character |

---

## Coverage summary

- Requirements covered: 3/3 (1 MODIFIED gesture requirement, 2 ADDED requirements)
- Scenarios by class: edge 11 · perf 0 · frontend 3 · error 0
- Scenarios by level: L1 14 · L2 0 · L3 0
- Scenarios by disposition: automated 14 · manual-only 0

## New infra needed

- none — extends the existing `PathPicker.test.tsx` vitest suite.
