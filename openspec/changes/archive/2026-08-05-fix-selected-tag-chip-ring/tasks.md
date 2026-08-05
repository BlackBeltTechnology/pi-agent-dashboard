## 1. Red tests

- [x] 1.1 In `packages/client/src/components/tags/__tests__/tags-components.test.tsx`, add a
      test rendering `<TagChip label="dashboard" variant="filter" tone="user" selected
      onToggle onRemove />` and assert the ring host's inline `outlineColor` equals
      `tagColor("dashboard").text` (import `tagColor` from
      `@blackbelt-technology/pi-dashboard-shared/tags.js`). Covers spec scenarios
      "Selection indicator color tracks the tag color" + "Remove-enabled selected chip is
      indicated on the enclosing wrapper".
- [x] 1.2 Add a test asserting the toggle-only selected layout (`selected`, no `onRemove`)
      resolves to the same `tagColor(label).text` ring color — pins the D3 invariant that
      both user-tone layouts render identically.
- [x] 1.3 Add a test asserting an unselected user-tone filter chip renders no selection
      indicator and reports `aria-pressed="false"`. Covers "Unselected chip renders no
      selection indicator".
- [x] 1.4 Run `npx vitest run packages/client/src/components/tags` and confirm 1.1 fails on
      the wrapper color (near-black / inherited, not the tag color) while 1.2 and 1.3 pass —
      this is the proof the defect is confined to the `onRemove` wrapper branch.

## 2. Implementation

- [x] 2.1 In `packages/client/src/components/tags/TagChip.tsx`, split the ring color out of
      the `selRing` class string so the color is supplied via inline style from
      `tagColor(label).text` for colorized chips (D1, D3). Keep `outline-current` for the
      `exec` tone (D5).
- [x] 2.2 Apply the ring color to the wrapper `<span>` in the `filter` + `tone="user"` +
      `onRemove` branch, keeping the ring hosted on the wrapper so the toggle and the ✕ stay
      enclosed as one unit (D2).
- [x] 2.3 Reduce the ring weight from `outline-2` to a 1px outline, retaining
      `outline-offset-1` (D4).
- [x] 2.4 Re-run `npx vitest run packages/client/src/components/tags` — all tests from
      group 1 green, and the existing `sidebar-tag-collapse-and-delete` remove-enabled
      filter-chip tests still green (no regression to the single-line ✕ layout).
- [x] 2.5 Added two regression tests pinning the decisions that are unreachable from the
      live sidebar: D4 (ring is `outline-1` + `outline-offset-1`, never `outline-2`) and D5
      (exec tone keeps `outline-current`, no inline ring color). 19/19 green.

## 3. Verify

- [x] 3.1 Run the full suite: `npm test 2>&1 | tee /tmp/pi-test.log` then
      `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log` — confirm no new failures.
      (66 failures, all pre-existing/environmental: `JimpMime` undefined in
      `pi-image-fit-extension`, `fs.watch` timing suites, a perf smoke over budget on a
      loaded box. None import `TagChip`.)
- [x] 3.2 Run `npm run quality:changed` and clear any new Biome findings on the touched
      files. (`--changed` processed 0 files; ran Biome directly on both touched files —
      the change first pushed the pre-existing `noExcessiveCognitiveComplexity` 17 → 24, so
      the ring logic was extracted into `selectionRing()`, which clears the warning
      entirely.)
- [x] 3.3 Verified against this worktree's OWN docker harness (`docker/test-up.sh`, port
      18156, image baked from worktree source) — NOT :8000, which serves the main repo.
      Overlay mode fails on this host (`cannot mount overlay read-only`), so the documented
      `TEST_COPY_MODE=1` fallback was used. Torn down with `docker/test-down.sh`.
- [x] 3.4 Visually confirmed, light AND dark. In the live harness sidebar (`Tags` expanded,
      `#dashboard` + `#urgent` selected) the ring is each chip's own palette color:
      wrapper inline `outlineColor: rgb(94,234,212)` == `tagColor("dashboard").text`
      (`#5eead4`), `1px solid`, `outline-offset: 1px`, identical in both themes. The
      near-black defect is gone — an UNSELECTED wrapper still reports the ambient
      `rgb(26,26,26)` that the old `outline-current` resolved to, but now renders
      `outline-style: none`, and the selected state uses the tag color instead.
      All three ring states were additionally rendered from the real `TagChip` source and
      measured in-browser: (a) toggle-only colorized selected → host `toggle-button`,
      inline `rgb(94,234,212)`, 1px/off:1px; (b) exec selected → no inline color,
      `outline-current` class retained, resolves to muted `rgb(119,119,119)` (D5);
      (c) colorized + ✕ selected → host `wrapper-span`, inline `rgb(165,180,252)` for
      `#urgent`, matching the toggle-only `#urgent` ring exactly (D3 invariant). Every
      unselected chip reports `no-ring`. Groups (a)+(b) are unreachable from the live
      sidebar (`App.tsx` always wires `onRemoveTagGlobally`, and the faux harness model
      never calls tools so no `openspecPhase` exists) — both are now pinned by CI tests
      instead (see 1.2 + the added D4/D5 cases).
- [x] 3.5 Confirmed in the live harness: the ✕ shares the toggle's line (measured
      `sameLine: true`, ✕ left edge ≥ toggle right edge, 24×24 hit area) and clicking it
      still opens the "Remove tag from all sessions" confirm dialog (Cancel / Remove tag).

## 4. Documentation

- [x] 4.1 Update the `TagChip.tsx` row in
      `packages/client/src/components/tags/AGENTS.md` to record the tag-colored selection
      ring, appending `See change: fix-selected-tag-chip-ring` to the existing
      `See change:` trail.
