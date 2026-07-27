## 1. Red tests

- [ ] 1.1 In `packages/client/src/components/tags/__tests__/tags-components.test.tsx`, add a
      test rendering `<TagChip label="dashboard" variant="filter" tone="user" selected
      onToggle onRemove />` and assert the ring host's inline `outlineColor` equals
      `tagColor("dashboard").text` (import `tagColor` from
      `@blackbelt-technology/pi-dashboard-shared/tags.js`). Covers spec scenarios
      "Selection indicator color tracks the tag color" + "Remove-enabled selected chip is
      indicated on the enclosing wrapper".
- [ ] 1.2 Add a test asserting the toggle-only selected layout (`selected`, no `onRemove`)
      resolves to the same `tagColor(label).text` ring color — pins the D3 invariant that
      both user-tone layouts render identically.
- [ ] 1.3 Add a test asserting an unselected user-tone filter chip renders no selection
      indicator and reports `aria-pressed="false"`. Covers "Unselected chip renders no
      selection indicator".
- [ ] 1.4 Run `npx vitest run packages/client/src/components/tags` and confirm 1.1 fails on
      the wrapper color (near-black / inherited, not the tag color) while 1.2 and 1.3 pass —
      this is the proof the defect is confined to the `onRemove` wrapper branch.

## 2. Implementation

- [ ] 2.1 In `packages/client/src/components/tags/TagChip.tsx`, split the ring color out of
      the `selRing` class string so the color is supplied via inline style from
      `tagColor(label).text` for colorized chips (D1, D3). Keep `outline-current` for the
      `exec` tone (D5).
- [ ] 2.2 Apply the ring color to the wrapper `<span>` in the `filter` + `tone="user"` +
      `onRemove` branch, keeping the ring hosted on the wrapper so the toggle and the ✕ stay
      enclosed as one unit (D2).
- [ ] 2.3 Reduce the ring weight from `outline-2` to a 1px outline, retaining
      `outline-offset-1` (D4).
- [ ] 2.4 Re-run `npx vitest run packages/client/src/components/tags` — all tests from
      group 1 green, and the existing `sidebar-tag-collapse-and-delete` remove-enabled
      filter-chip tests still green (no regression to the single-line ✕ layout).

## 3. Verify

- [ ] 3.1 Run the full suite: `npm test 2>&1 | tee /tmp/pi-test.log` then
      `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log` — confirm no new failures.
- [ ] 3.2 Run `npm run quality:changed` and clear any new Biome findings on the touched
      files.
- [ ] 3.3 Rebuild + restart the client per the `implement` skill:
      `npm run build && curl -X POST http://localhost:8000/api/restart`.
- [ ] 3.4 Visually confirm in the sidebar: expand `Tags`, select a user tag, and verify the
      selection ring is the tag's own color (not near-black) and reads as a selection
      affordance rather than a boxed outline. Check one light and one dark theme.
- [ ] 3.5 Confirm the destructive ✕ still sits inline with the toggle (no wrap to its own
      line) and still opens the delete-confirm dialog.

## 4. Documentation

- [ ] 4.1 Update the `TagChip.tsx` row in
      `packages/client/src/components/tags/AGENTS.md` to record the tag-colored selection
      ring, appending `See change: fix-selected-tag-chip-ring` to the existing
      `See change:` trail.
