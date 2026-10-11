## 1. Anchor

- [ ] 1.1 `App.tsx`: in `renderSessionDetail`, when `!frozen && !readOnly`, render the zero-height `composer-stack-anchor` sentinel immediately before `composer-context-strip`, with a state-backed callback ref, and pass the element to `<CanvasDriver anchor={…} />` (design D2, D2b), and classify the sentinel as a `fixed` row in `CHAT_PANE_ROW_TABLE` (`lib/layout/chat-pane-row-class.ts`) so `chat-pane-row-completeness.test.ts` stays green; verify with `tsc` and that test

## 2. Floating tray

- [ ] 2.1 `CanvasDriver`: add an optional `anchor?: HTMLElement | null` prop and render the tray inside `LayerPortal` as `fixed z-overlay pointer-events-none`, with `right: 1rem`, `max-width: calc(100vw - 2rem)` and per-chip `pointer-events-auto`. Compute `bottom` per design D2a (`ResizeObserver` over the sentinel's following siblings plus a `MutationObserver` on their parent, `visualViewport`-aware, guarded, cleaned up, safe-area fallback, `visibility: hidden` until first measure); verify the existing `CanvasDriver.test.tsx` suite still passes under jsdom
- [ ] 2.2 Make the chip chain shrinkable per design D2c (`CanvasServerChip.tsx` outer div + button + spans; mobile file chip in `CanvasDriver.tsx`); verify the existing chip tests pass
- [ ] 2.3 Update the `CanvasDriver.tsx`, `CanvasServerChip.tsx` and `App.tsx` rows/sidecars in their directory `AGENTS.md` (`See change: fix-canvas-chip-tray-overlay`), naming the sentinel-anchor contract; verify `node scripts/dox-byte-gate.mjs` passes

## 3. Tests (folded from test-plan.md)

- [ ] 3.1 Extend `packages/client/src/components/__tests__/CanvasDriver.test.tsx` (exemplar: its existing `Harness`): `<CanvasDriver state={withChip} />` with no `anchor` → tray is a child of `document.body` with inline `bottom: calc(1rem + env(safe-area-inset-bottom))` and visible (test-plan #E3)
- [ ] 3.2 Same file: with `anchor` set and the `ResizeObserver` shim not yet fired → tray has `visibility: hidden`; after the shim callback fires → visible with a numeric `bottom` (test-plan #E4)
- [ ] 3.3 Same file: server chip + mobile file target → tray has `pointer-events-none`, each chip button `pointer-events-auto` (test-plan #E5)
- [ ] 3.4 Same file: jsdom with no `visualViewport` → mount/unmount with `anchor` does not throw, and spies show every added listener/observer removed (test-plan #E6)
- [ ] 3.5 Add `tests/e2e/canvas-chip-tray-overlay.spec.ts` (exemplar: `tests/e2e/canvas-declare-tool.spec.ts`): at 1200×800, `[[faux:canvas-declare-server]]` → the header/toolbar and `split-chat-pane` boxes are unchanged (±0.5 px) and the tray's parent is `document.body` (test-plan #E1)
- [ ] 3.6 Same spec: at a 360×740 viewport with a ≥ 80-char server title, the tray stays within `[0, 344]` px horizontally and the label is truncated (`scrollWidth > clientWidth`) (test-plan #E2)
- [ ] 3.7 Same spec: (a) a plain live session has exactly one `composer-stack-anchor`; (b) with the Settings route-overlay open it has zero (test-plan #E7)
- [ ] 3.8 Same spec: typing a 6-line draft → chip `rect.bottom ≤` composer-stack top and the tray `bottom` increased (test-plan #F1)
- [ ] 3.9 Same spec: an idle chip, then a prompt so `StatusBar` mounts → chip `rect.bottom ≤` the topmost stack row while streaming and after the turn ends (test-plan #F2)
- [ ] 3.10 Same spec: with the model selector open, `elementFromPoint` at the chip centre returns the popover wherever the popover covers it (test-plan #F3)
- [ ] 3.11 Same spec: `elementFromPoint` 4 px left of the chip inside the tray box returns chat-pane content, not the tray (test-plan #F4)
- [ ] 3.12 Same spec: Settings open → `elementFromPoint` at the chip centre is inside the dialog/backdrop; after closing, the F1 invariant holds again (test-plan #F5)
- [ ] 3.13 Same spec: at 767×800 with `[[faux:canvas-write-md]]` → `canvas-file-chip` visible, `split-chat-pane` box unchanged, and tapping opens `split-editor-pane` with that file active (test-plan #F6)
- [ ] 3.14 Manual: on iPhone Safari with a chip shown, focus the composer; the chip stays visible above the composer and is not hidden by the keyboard (test-plan: manual-only, #F7)
- [ ] 3.15 Manual: on desktop with throttled CPU, there is no frame where a newly appearing chip covers the composer (test-plan: manual-only, #F8)

## 4. Close-out

- [ ] 4.1 `npm run build` + `curl -X POST http://localhost:8000/api/restart`; after merge, comment on and close #681
