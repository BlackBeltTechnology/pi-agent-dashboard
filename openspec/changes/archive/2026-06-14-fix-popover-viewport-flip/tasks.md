# Tasks — fix-popover-viewport-flip

## 1. Shared hook
- [x] 1.1 Write `packages/client/src/hooks/__tests__/usePopoverFlip.test.ts`: mock `getBoundingClientRect` + `window.innerHeight`; assert (a) downward by default when ample space below, (b) `flipUp=true` when below-space < threshold and above-space larger, (c) `maxHeight` clamps to available space with a 120px floor, (d) re-evaluates on `resize`/`scroll` while open, (e) no listeners attached when `open=false`. → verify: tests fail (red).
- [x] 1.2 Implement `packages/client/src/hooks/usePopoverFlip.ts` per design (rect measure on open + passive resize/scroll listeners, `typeof window` guard). → verify: 1.1 passes.

## 2. Fix the reported bug — ChatViewMenu (spec-drift restore)
- [x] 2.1 Add a failing test asserting `ChatViewMenu` popover applies the up-direction class + `max-height` when its trigger is near the viewport bottom (mock rect). → verify: red.
- [x] 2.2 Adopt `usePopoverFlip` in `ChatViewMenu.tsx`: add `triggerRef`, swap `top-full mt-1` ⇄ `bottom-full mb-1` on `flipUp`, add `overflow-y-auto` + inline `maxHeight`. → verify: 2.1 passes; manual/QA-browser check the menu is fully reachable from the StatusBar.

## 3. Adopt in latent-risk down-openers (only those that actually clip)
- [x] 3.1 In the QA browser harness, confirm which of `WorktreeActionsMenu`, `PackageRow`, `OpenSpecGroupPicker`, `ThemePicker` clip when low in a scroll container. Record findings. → verify: list of genuinely-affected components.
- [x] 3.2 Adopt `usePopoverFlip` in each confirmed-affected component (one commit each, with a test). → verify: each opens fully on-screen at the bottom edge.

## 4. Retire duplicated flip logic (no behavior change)
- [x] 4.1 Refactor `ModelSelector.tsx` to read `flipUp`/`maxHeight` from the hook, dropping static `bottom-full`/`max-h-64`. → verify: existing ModelSelector tests pass; visual parity in StatusBar.
- [x] 4.2 Refactor `ThinkingLevelSelector.tsx` likewise (drop `max-h-48`). → verify: tests pass.
- [x] 4.3 Refactor `CommandInput.tsx` autocomplete popovers likewise (drop `max-h-64`). → verify: CommandInput-view tests pass.

## 5. Spec + regression guard
- [x] 5.1 Re-affirm the `chat-display-preferences` auto-flip requirement points at the shared hook (spec delta in this change). → verify: `openspec validate fix-popover-viewport-flip`.
- [x] 5.2 Full client test run green. → verify: `npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|✗' /tmp/pi-test.log` returns nothing.
- [x] 5.3 Build + restart, manually confirm the `⚙ View` menu near the bottom edge shows every row. → verify: `npm run build && curl -X POST http://localhost:8000/api/restart`.
