# Tasks

> TDD throughout: each test task is written first and confirmed FAILING on
> current `develop` before its implementation task lands. Exceptions are
> scenarios marked "regression guard", which may already pass. Test tasks are
> folded from `test-plan.md`. Each carries its manifest id, its Triple, and a
> harness exemplar. `test-plan.md` is the source of truth for automated vs
> manual.
>
> - Client test glue: jsdom 25 has no `PointerEvent` / `setPointerCapture`.
>   Use the helper from 1.1.
> - Full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`.
> - Rebuild after client edits:
>   `npm run build && curl -X POST http://localhost:8000/api/restart`.

## 1. Shared drag hook `useResizeDrag` (design D1–D4, D7)

- [ ] 1.1 Add `packages/client/src/test-support/pointer.ts` with `pointerDown/pointerMove/pointerUp/pointerCancel(target, { clientX, clientY, button, buttons, pointerId })`, `lostPointerCapture(target)` and `nextFrame()` (`await new Promise(r => requestAnimationFrame(r))`).
  - Defaults: `bubbles:true`, `cancelable:true`, `button:0`; `buttons:1` on down/move and `0` on up; `pointerId` attached via `Object.defineProperty`, default `1`.
  - If rAF is absent under the client vitest env, install a minimal rAF shim here.
  - Add the helper's row to `test-support/AGENTS.md`.
  - Spike test proving the premises: React's `onPointerDown` fires for a dispatched `MouseEvent("pointerdown")` carrying the defined `pointerId`.
  - See `packages/client/src/test-support/restore-globals.ts` for test-support conventions. Verify the spike test passes.
- [ ] 1.2 Test in `packages/client/src/hooks/__tests__/useResizeDrag.test.tsx` (exemplar for hook glue: `hooks/__tests__/useBodyDragStyle.test.tsx`). Idle consumer · primary `pointerdown`, then a held move +1px · after the down, body cursor and `userSelect:"none"` are set and 0 shields exist; after the move, exactly 1 body child has `fixed inset-0 z-lightbox`, `aria-hidden="true"` and `touchAction:"none"`. Verify FAIL (module absent). (test-plan #E1)
- [ ] 1.3 Test: idle consumer · `pointerdown` with `button:2` · `onStart` not called, body unchanged, a later move gives no `onPreview`. (test-plan #E2)
- [ ] 1.4 Test: A mid-drag, B idle · `pointerdown` on B, then unmount B · B's `onStart` not called; A's overrides and shield remain; A's next frame still calls A's `onPreview`. (test-plan #E3)
- [ ] 1.5 Test: drag active, `axis:"x"` · 3 held moves (clientX 110/120/130) before one `nextFrame()` · `onPreview` called once, with 130. (test-plan #E4)
- [ ] 1.6 Test: drag active, `axis:"y"` · held move at clientX 500 / clientY 42, `nextFrame()` · `onPreview(42)`. (test-plan #E5)
- [ ] 1.7 Test: drag started with `pointerId` 1 · held move with `pointerId` 2, `nextFrame()` · `onPreview` not called. (test-plan #E6)
- [ ] 1.8 Test: previewed 120, move to 130 pending · `pointerup` at 140 · the last `onPreview` call is 140 (130 is never applied), then `onEnd(140)` once, and the shield is removed. (test-plan #E7)
- [ ] 1.9 Test: idle · `pointerdown` at 100 → `pointerup` at 100 · `onEnd(null)`, no `onPreview`, no shield ever mounted. (test-plan #E8)
- [ ] 1.10 Test the BVA boundary on the "moved" rule. Case 1: down at 100 · held move at 100 · up at 100 → `onEnd(null)`. Case 2: down at 100 · held move at 101 · up at 101 → `onEnd(101)`. (test-plan #E9)
- [ ] 1.11 Test: consumer with inline callbacks · re-render with new inline callbacks, then drag · `onPointerDown` is `===` the previous render's, and the NEW callbacks receive `onPreview`/`onEnd`. (test-plan #E10)
- [ ] 1.12 Test: previewed 120, move to 130 pending · `pointercancel` · no further `onPreview` (130 never applied); `onEnd(120)` once; shield removed; body styles cleared. (test-plan #X1)
- [ ] 1.13 Test: same state · `lostpointercapture` on the handle · `onEnd(120)` once, teardown as in 1.13. (test-plan #X2)
- [ ] 1.14 Test: same state · `pointermove` with `buttons:0` at clientX 900 · `onEnd(120)` (not 900, not 130); later held moves give no `onPreview`. (test-plan #X3)
- [ ] 1.15 Test: drag started, one held move pending, no frame run yet · `pointercancel` · `onEnd(null)`, `onPreview` never called. (test-plan #X4)
- [ ] 1.16 Test: drag active with a pending frame · unmount the consumer · shield removed, body styles cleared, `onEnd` not called, the pending frame never fires `onPreview`, and a new instance can then start a drag. Exemplar for unmount glue: `hooks/__tests__/effect-cleanup-contract.test.tsx`. (test-plan #X5)
- [ ] 1.17 Implement `packages/client/src/hooks/useResizeDrag.ts` per design D1–D4/D7:
  - composes `useBodyDragStyle`;
  - no `preventDefault` on `pointerdown`; the returned `onMouseDown` prevents default;
  - guarded `setPointerCapture` on the handle;
  - owner-token active-drag slot;
  - lazy shield on the first moved move, using the `z-lightbox` token class;
  - end-trigger table from D3.

  Verify 1.2–1.16 pass and `npm run z-layer:lint` passes.
- [ ] 1.18 Add a `useResizeDrag.ts` row to `packages/client/src/hooks/AGENTS.md` (caveman style, `See change: fix-split-divider-drag`). Verify `grep -n useResizeDrag packages/client/src/hooks/AGENTS.md` hits.

## 2. Split divider + outer chat│editor split (design D5)

Exemplar for 2.1–2.6 and 2.8: `packages/client/src/components/__tests__/SplitWorkspace.test.tsx` (container box stub). Move its existing split-divider drags to the pointer helper. The per-move `onRatioChange` assertions at `SplitWorkspace.test.tsx:83-103` are replaced, not ported.

- [ ] 2.1 Test: `split`, container 1000px at left 0, ratio 0.5 · 5 held moves to clientX 600 with frames, `pointerup` at 600 · `onRatioChange` called exactly once, with 0.6, after release. Verify FAIL. (test-plan #E12)
- [ ] 2.2 Test (regression guard, clamps exist today): same container · drag to clientX 100 and release; separately drag to 900 and release · `onRatioChange(0.25)` / `onRatioChange(0.75)`. (test-plan #E13)
- [ ] 2.3 Test: drag active · held move to 600, `await nextFrame()` · chat wrapper `style.flexGrow`="0.6", editor wrapper "0.4", and `onRatioChange` not yet called. Verify FAIL. (test-plan #E14)
- [ ] 2.4 Test (regression guard): drag active with preview 0.6, prop `ratio` 0.5 · re-render with identical props mid-drag · chat wrapper `style.flexGrow` is still "0.6". (test-plan #E15)
- [ ] 2.5 Test (regression guard): ratio 0.5 · down + up on the divider at the same point · `onRatioChange` not called. (test-plan #E16)
- [ ] 2.6 Test: `SplitDivider` mounted · `mousedown` on the divider · `defaultPrevented === true`. It covers the hook's returned `onMouseDown`. (test-plan #E11)
- [ ] 2.7 Test in `packages/client/src/lib/__tests__/split-state.test.ts` (exemplar: same file) or a `SessionSplitView` render test: session `s1` rendered, `localStorage.setItem` spy installed AFTER the initial render (`useSplitState` also writes on mount) · drag 5 frames, release · `setItem` called exactly once with key `pi-dashboard:split:s1`. Verify FAIL. (test-plan #E17)
- [ ] 2.8 Test: `SplitDivider` in both orientations (`h` and `v`) · render · `style.touchAction === "none"`. Verify FAIL. (test-plan #E18)
- [ ] 2.9 Rewrite `components/split/SplitDivider.tsx` onto `useResizeDrag`:
  - spread the hook's `onPointerDown`/`onMouseDown`, inline `touchAction:"none"`;
  - `onResize` = per-frame preview; `onResizeEnd(clientPos | null)` = commit; `onResizeStart` forwarded to `onStart`;
  - keep testids, grip, and the orientation cursor.

  Verify 2.6, 2.8 and the existing `body-drag-delegation.test.tsx` unmount case pass.
- [ ] 2.10 Update `components/split/SplitWorkspace.tsx`:
  - reuse `chatPaneRef` for the chat wrapper and add an editor-wrapper ref;
  - DOM `flexGrow` preview via `ratioFromPointer`/`clampRatio`;
  - a single `onRatioChange` on end.

  Remove the now-callerless `useSplitRatio` hook export from `lib/layout/useSplitRatio.ts`, keeping `ratioFromPointer` and `clampWidth`. Verify 2.1–2.7 pass and `rg -n "useSplitRatio\(" packages/client/src` is empty.
- [ ] 2.11 Update the `SplitDivider.tsx.AGENTS.md` and `SplitWorkspace.tsx.AGENTS.md` sidecars in `components/split/`, and the `useSplitRatio.ts` row in `lib/layout/AGENTS.md`, with the new contract and `See change: fix-split-divider-drag`. Verify `rg -l "fix-split-divider-drag" packages/client/src/components/split packages/client/src/lib/layout` lists all three files.

## 3. Editor browse-rail divider (design D5)

Exemplar for 3.1–3.4: `packages/client/src/components/editor-pane/__tests__/EditorPane.test.tsx`. Move its rail-divider drags to the pointer helper.

- [ ] 3.1 Test: tree visible, row left 0, rail 224 · held moves to clientX 100, 300 and 600, with `nextFrame()` after each · rail wrapper `style.width` = "160px" / "300px" / "480px". Verify FAIL. (test-plan #E19)
- [ ] 3.2 Test: session `s1`, spy installed after render (`useRailWidth` writes on mount) · drag to 300, release · `setItem` with key `pi-dashboard:rail:s1` called exactly once, with value 300. Verify FAIL. (test-plan #E20)
- [ ] 3.3 Test (regression guard): rail 224 · down + up on `rail-divider` at the same point · width still 224, no `pi-dashboard:rail:` write after mount. (test-plan #E21)
- [ ] 3.4 Test: render the rail divider · `style.touchAction === "none"`. Verify FAIL. (test-plan #E25)
- [ ] 3.5 Update `components/editor-pane/EditorPane.tsx`: add a rail wrapper ref, preview the width in the DOM via `clampRailWidth`, call `setRailWidth` once on end. Verify 3.1–3.4 pass.
- [ ] 3.6 Update the `EditorPane.tsx` row (or its `.AGENTS.md` sidecar) in `components/editor-pane/` with `See change: fix-split-divider-drag`. Verify `rg -n "fix-split-divider-drag" packages/client/src/components/editor-pane` hits.

## 4. Session sidebar + diff tree panel (design D6)

Exemplars: `packages/client/src/components/__tests__/ResizableSidebar.test.tsx`, plus the tree-panel cases in `components/__tests__/body-drag-delegation.test.tsx`. Move both to the pointer helper. The no-move-`mouseup`-commits assertion at `ResizableSidebar.test.tsx:96-98` is replaced.

- [ ] 4.1 Test (regression guard): sidebar width 280 · drag to clientX 400, `pointerup` at 400 · `setWidth(400)` called once. (test-plan #E22)
- [ ] 4.2 Test: expanded sidebar · `pointerdown` on the `sidebar-collapse` knob, then a held move · no shield, body cursor unchanged, `setWidth` not called. (test-plan #E23)
- [ ] 4.3 Test: `ResizableSidebar` mid-drag with previewed width 350 · `pointermove` with `buttons:0` at clientX 480 · `setWidth(350)` called once, sidebar `style.width` "350px", no shield. Verify FAIL. (test-plan #X6)
- [ ] 4.4 Test: sidebar seam (`drag-handle`) and tree-panel handle · render · `style.touchAction === "none"`. Verify FAIL. (test-plan #E26)
- [ ] 4.5 Test: `ResizableTreePanel` width 250, parent left 0 · drag to 320, `pointerup` at 320, then a no-button move to 450 · panel `style.width` stays "320px". Verify FAIL on the post-release part. (test-plan #E24)
- [ ] 4.6 Move `components/shell/ResizableSidebar.tsx` onto `useResizeDrag`. Keep the direct `style.width` preview and `setWidth` on end. The knob gains `onPointerDown` stopPropagation; the seam gets inline `touchAction:"none"`. Verify 4.1–4.4 pass, along with the existing clamp tests.
- [ ] 4.7 Move `ResizableTreePanel` in `components/diff/FileDiffView.tsx` onto `useResizeDrag`, same pattern. Verify 4.4–4.5 pass and `rg -n "mousemove|mouseup" packages/client/src/components/split packages/client/src/components/shell packages/client/src/components/diff --glob '!**/__tests__/**'` is empty.
- [ ] 4.8 Update the `ResizableSidebar.tsx` and `FileDiffView.tsx` rows/sidecars with `See change: fix-split-divider-drag`. Verify with `rg -l fix-split-divider-drag` on both directories, and check that `hooks/useTreeColumnWidth.ts` is untouched (`git diff --stat`).

## 5. Browser E2E (Playwright, docker harness)

Exemplar for 5.1–5.4: `tests/e2e/editor-pane.spec.ts` (seeded session, `/session/:id/editor?file=` deep link, `split-divider` testids).

- Open an `.html` file from the seeded workspace so the editor shows the iframe HTML preview. If the seed has none, add a fixture via the e2e seed.
- Read the port from `.pi-test-harness.json`; never hardcode it.

- [ ] 5.1 Test: split open, HTML preview active · mouse down on `split-divider`, move right into the iframe, mouse up over the iframe, then `mouse.move` 200px with no button · `split-chat-pane` width after that move equals the width at release (±1px). Verify FAIL on `develop`, pass after groups 1–2. (test-plan #F1)
- [ ] 5.2 Test: tree visible, HTML preview active · down on `rail-divider`, move right over the iframe, up over the iframe, no-button move of 150px · rail width unchanged after that move (±1px). Verify FAIL on `develop`, pass after group 3. (test-plan #F2)
- [ ] 5.3 Test: 5.1 setup plus `page.evaluate` deleting `Element.prototype.setPointerCapture` and `releasePointerCapture` · run the 5.1 drag and release over the iframe, then a no-button move · during the drag the chat pane width changes while the pointer is over the iframe region; after release it does not change. This proves the shield works independently of capture. (test-plan #F3)
- [ ] 5.4 Test: split open, chat composer textarea focused · mouse down + up on `split-divider` with no movement · `document.activeElement` is still the composer textarea. (test-plan #F4)
- [ ] 5.5 Re-run `tests/e2e/drag-body-style.spec.ts` unchanged. Exemplar: same file. It covers a sidebar/split drag plus a mid-drag breakpoint flip; page text stays selectable and no resize cursor remains. Run against the local harness using the `run-dashboard-e2e-local-changes` skill, together with the full `editor-pane.spec.ts`. Verify green. (test-plan #F5)

## 6. Integration + manual verification

- [ ] 6.1 Full suite green: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`; `grep -nE 'FAIL|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log` shows no failures. `npm run quality:changed` is clean.
- [ ] 6.2 Manual perf trace (performance-optimization) (test-plan: manual-only, #P1). Session with ≥200 messages, split open · drag the outer divider continuously for 3 s while recording a DevTools Performance trace, before and after the change · pass = 0 React commits and 0 `localStorage.setItem` inside the drag window, and lower scripting ms/frame than the pre-change trace. Record both numbers in the PR description.
- [ ] 6.3 Manual engine check in the Electron app and Safari (test-plan: manual-only, #F6). HTML preview open, streaming session. Release over the iframe; release outside the window and return; drag while streaming · pass = the drag ends with no jump and no preview flicker in both engines.
- [ ] 6.4 Manual touch check on a phone or tablet (test-plan: manual-only, #F7). Touch-drag the mobile stacked (`v`) divider · pass = the drag is not cancelled by scrolling and does not end early.
- [ ] 6.5 Run a `review-code` inline review of the diff. Verify the review report has zero open blocker/major findings before commit.

## Workflow follow-up

- Rebuild the client and restart the dashboard (`implement` skill matrix).
- Ship via `ship-change`; the archive syncs `resize-drag-lifecycle` into `openspec/specs/`.
- Follow-up candidate: migrate `hooks/useTreeColumnWidth.ts` onto `useResizeDrag`.
