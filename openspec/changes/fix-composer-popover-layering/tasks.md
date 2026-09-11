# Tasks

## 1. Red tests first

- [ ] 1.1 Re-scope `packages/client/src/__tests__/ThinkingLevelSelector.test.tsx` off `container.querySelector` (lines 16, 27, 35, 45, …) onto `screen` / `baseElement` queries, so the dropdown is found wherever it renders; verify the suite still passes against the CURRENT inline implementation (a re-scope must not depend on the fix).
- [ ] 1.2 Add a test asserting a `mousedown` **inside** the open model dropdown does NOT close it (select a model via click and assert `onSelect` fired); verify it passes pre-change — it is the regression guard for the portal outside-click trap.
- [ ] 1.3 Add a test asserting the open panel is NOT a descendant of the `[data-testid="model-selector"]` container (i.e. it is portaled) and carries the `z-popover` class; verify it FAILS now — this is the red test for the bug.
- [ ] 1.4 Mirror 1.3 for `ThinkingLevelSelector`; verify it fails now.

## 2. ModelSelector → portaled layer surface

- [ ] 2.1 Import `LayerPortal` and destructure `triggerRect` from `usePopoverFlip`; add a `panelRef`. Verify `npx tsc --noEmit` in `packages/client` is clean.
- [ ] 2.2 Build the `fixed` positioning style from `triggerRect`/`flipUp`/`anchorRight` per design.md's table, including `GAP = 4` and the `visibility` guard against the pre-measure `(0,0)` flash; keep `width: Math.min(320, maxWidth)`, `maxHeight`, `minHeight`. Verify by opening the dropdown in both flip directions — panel sits flush to the trigger, no flash on open.
- [ ] 2.3 Wrap the open panel in `<LayerPortal>`, swap `absolute … z-50` + the `left-0/right-0/top-full/bottom-full` classes for `fixed z-popover`, and attach `panelRef`. Verify test 1.3 now passes.
- [ ] 2.4 Fix outside-click: check `panelRef` **before** `triggerRef`, return early for both, and add `touchstart` beside `mousedown`. Verify test 1.2 still passes and clicking outside still closes.

## 3. ThinkingLevelSelector → same treatment

- [ ] 3.1 Apply the identical port (portal, `fixed z-popover`, `triggerRect` positioning, `panelRef` + two-ref outside-click), keeping the fixed `w-32` and NOT destructuring `maxWidth`. Verify test 1.4 passes and the suite from 1.1 is green.

## 4. Shrink the ratchet

- [ ] 4.1 Delete the `settings/ModelSelector.tsx|z-50` and `settings/ThinkingLevelSelector.tsx|z-50` entries from `scripts/z-layer-baseline.json` (35 → 33). Verify `node scripts/z-layer-lint.mjs` passes — it proves no raw `z-` remains in either file.

## 5. Verify the whole

- [ ] 5.1 Run the full client suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep the summary pattern); verify no regressions in `SettingsPanel`, `OpenSpecRunConfig`, `StatusBar`, `shell-primitives`.
- [ ] 5.2 Build + restart (`npm run build && curl -X POST http://localhost:8000/api/restart`) and manually confirm the ORIGINAL reported bug: open the model dropdown upward in the composer — fully visible above the context strip, not clipped at the toolbar border, first row clickable.
- [ ] 5.3 Manually verify both selectors inside an OpenSpec run-config dialog — the popover must not be occluded by its host dialog (`z-popover` 40 sits below `z-dialog` 50), and must still track its trigger when the chat pane scrolls.
- [ ] 5.4 Run `review-code` on the final diff (per the proposal's Discipline Skills) and address findings before commit.
