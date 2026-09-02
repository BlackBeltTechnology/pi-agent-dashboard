## 1. PathPicker self-row rendering

- [x] 1.1 Add a `{ type: "self" }` variant to the `DisplayItem` union in `packages/client/src/components/primitives/PathPicker.tsx` and, in multi-select mode only, prepend it to `displayItems` (index 0) when the current directory resolves to a non-empty absolute path (`fetchedDirRef.current`); verify by rendering the picker in `selection` mode and asserting a self-row appears at the top, and that it is absent during the initial default-directory load (per design D1/D4).
- [x] 1.2 Render the self-row with the open-folder MDI glyph and NO trailing chevron, reusing the child-row checkbox wired to `selection.onToggle(<current-dir path>)`; verify the self-row DOM has the open-folder `@mdi/js` path and no `mdiChevronRight` (design D1/D3).
- [x] 1.3 Render the current directory's session-count badge on the self-row using the same `sessionCounts`/`pathKey` lookup child rows use; verify a badge shows when `sessionCounts` has an entry for the current dir's key (spec R1 badge).
- [x] 1.4 Render a presentational `CONTENTS` label between the self-row and the `..`/child rows — NOT a `role="option"`, not focusable, not in `displayItems`; verify it renders below the self-row and above `..`, and that `[role="option"]` count is unchanged by its presence (design D7, spec R2).

## 2. PathPicker self-row interaction

- [x] 2.1 Extend `handleItemClick` and the Enter branch so activating a `type: "self"` item TOGGLES its selection (never calls `descendInto`); verify clicking/Enter on the self-row toggles the basket entry and does NOT trigger a browse (spec MODIFIED gesture requirement).
- [x] 2.2 Widen the multi-select Space handler (today `item.type === "entry"` only) to also toggle `type: "self"`; verify Space on the highlighted self-row toggles it and inserts no literal space into the input (design D1).
- [x] 2.3 Make the checkbox checked-state comparison canonical: normalize (`normalizePath`) both the stored basket paths and the compared row path before `.has()` for the self-row (and child rows), so a self-selection with a trailing separator matches an equivalent child `entry.path`; verify a dir ticked via the self-row while browsing `.../work/` renders the `work` child checked after navigating up, counted once (design D5, spec R1 no-double-count). Scope caveat: parity with existing child behavior only — do NOT add case-insensitive dedup.

## 3. AddFoldersDialog root-label fallback

- [x] 3.1 In `packages/client/src/components/workspace/AddFoldersDialog.tsx`, make `leafName` fall back to the full path when the trailing-separator-stripped leaf is empty (filesystem roots), and use it for both the pill label and the remove-control `aria-label`; verify ticking the self-row at `/` yields a non-empty pill label and a non-empty remove `aria-label` (design D6, spec R1 root scenario).

## 4. Tests — fold of test-plan.md automated scenarios (L1, extend `packages/client/src/components/__tests__/PathPicker.test.tsx`)

- [x] 4.1 E1 — self-row activation toggles ON. Input: picker browsing `/home/user`, self-row unticked · Trigger: click self-row body · Observable: `/home/user` enters basket, browsed dir stays `/home/user` (no browse), 1-item label. See `packages/client/src/components/__tests__/PathPicker.test.tsx`. (test-plan #E1)
- [x] 4.2 E2 — self-row activation toggles OFF. Input: self-row `/home/user` ticked · Trigger: Enter while self-row highlighted · Observable: basket empty, primary action disabled. See `PathPicker.test.tsx`. (test-plan #E2)
- [x] 4.3 E3 — no chevron + open-folder glyph. Input: browsing `/home/user` · Trigger: render self-row · Observable: open-folder `@mdi/js` path present, no `mdiChevronRight`. See `PathPicker.test.tsx`. (test-plan #E3)
- [x] 4.4 E4 — commit pins current dir. Input: self-row `/home/user` ticked, sole selection · Trigger: click commit · Observable: `onPin` called once with `/home/user`, dialog closes. See `PathPicker.test.tsx`. (test-plan #E4)
- [x] 4.5 E5 — coexists with child selections. Input: self-row `/home/user` ticked · Trigger: navigate into `/home/user/projects`, tick `alpha` · Observable: basket has both paths, 2-item label. See `PathPicker.test.tsx`. (test-plan #E5)
- [x] 4.6 E6 — self-row + equivalent child do not double-count. Input: self-row ticked while browsing `/home/user/work/` (trailing sep) · Trigger: navigate to `/home/user`, `work` child renders · Observable: `work` checkbox checked, dir counted once. See `PathPicker.test.tsx`. (test-plan #E6)
- [x] 4.7 E7 — current dir with live sessions badged on self-row. Input: `sessionCounts` = 2 for `pathKey('/home/user')`, browsing `/home/user` · Trigger: render self-row · Observable: badge reads 2 sessions. See `PathPicker.test.tsx`. (test-plan #E7)
- [x] 4.8 E8 — filesystem-root self-row non-empty pill label. Input: browsing `/` · Trigger: tick self-row, render pill · Observable: pill label non-empty, remove `aria-label` non-empty. See `PathPicker.test.tsx`. (test-plan #E8)
- [x] 4.9 E9 — self-row absent when no current dir resolved. Input: initial default-directory load, unresolved current dir · Trigger: render · Observable: no self-row element. See `PathPicker.test.tsx`. (test-plan #E9)
- [x] 4.10 E10 — child-row activation still descends (regression). Input: browsing `/home/user` · Trigger: click `work` child body · Observable: browses `/home/user/work`, `work` not added to basket. See `PathPicker.test.tsx`. (test-plan #E10)
- [x] 4.11 E11 — single-select mode unaffected (invariant). Input: `PathPicker` without `selection` prop, browsing `/home/user` · Trigger: render · Observable: no self-row, no `CONTENTS` label, no checkboxes. See `PathPicker.test.tsx`. (test-plan #E11)
- [x] 4.12 F1 — CONTENTS label skipped by keyboard traversal. Input: self-row + label + children rendered, highlight on self-row · Trigger: ArrowDown · Observable: highlight lands on next selectable row, label has no `role="option"` and never highlights. See `PathPicker.test.tsx`. (test-plan #F1)
- [x] 4.13 F2 — CONTENTS label separates the two groups. Input: resolved current dir · Trigger: render · Observable: `CONTENTS` below self-row and above `..`, no label above self-row. See `PathPicker.test.tsx`. (test-plan #F2)
- [x] 4.14 F3 — Space toggles the self-row. Input: self-row highlighted, unticked · Trigger: press Space · Observable: self-row toggles into basket, no literal space in input. See `PathPicker.test.tsx`. (test-plan #F3)

## 5. Verify

- [x] 5.1 Run `npm test` and confirm the `PathPicker.test.tsx` suite (existing + 14 new scenarios) passes with no regressions in `AddFoldersDialog`/`PinDirectoryDialog` tests.
- [x] 5.2 Run the `review-code` inline review→fix loop on the diff before commit (per proposal Discipline Skills).
