# Test Plan — fix-split-divider-drag

Stage: design   Generated: 2026-10-14

No clarifications needed: every Triple fills from `specs/resize-drag-lifecycle/spec.md`
+ `design.md` (D1–D7). Existing clamps come from `split-state.ts` (`clampRatio`
0.25–0.75) and `rail-width.ts` (`RAIL_MIN` 160 / `RAIL_MAX` 480).

L1 glue: pointer helper `packages/client/src/test-support/pointer.ts` (task 1.1)
— typed `MouseEvent`s with `bubbles`, `buttons`, defined `pointerId`, and
`nextFrame()`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Drag tracking not interrupted by frames (shield) | state-transition | L1 | automated | `useResizeDrag` consumer, idle, body styles empty | primary `pointerdown` (button 0), then held `pointermove` to a coordinate +1px | after down: `body.style.cursor`=cursor, `userSelect`="none", **0** shield nodes; after move: exactly **1** body child with classes `fixed inset-0 z-lightbox`, `aria-hidden="true"`, `style.touchAction`="none" |
| E2 | Drag start (primary only) | EP | L1 | automated | idle consumer | `pointerdown` with `button: 2` | `onStart` not called, body styles unchanged, no window `pointermove` effect (later move → no `onPreview`) |
| E3 | One drag at a time (D3 slot) | state-transition (illegal edge) | L1 | automated | instance A mid-drag, instance B idle | `pointerdown` on B; then unmount B | B's `onStart` not called; A's overrides + shield still present; A's next frame still calls A's `onPreview` |
| E4 | Preview ≤1 per frame | BVA (count) | L1 | automated | drag active, `axis:"x"` | 3 held moves (clientX 110, 120, 130) before one `nextFrame()` | `onPreview` called exactly once, with 130 |
| E5 | Preview axis | EP | L1 | automated | drag active, `axis:"y"` | held move clientX 500 / clientY 42, `nextFrame()` | `onPreview(42)` |
| E6 | Foreign pointer ignored | EP | L1 | automated | drag started with `pointerId` 1 | held move with `pointerId` 2, `nextFrame()` | `onPreview` not called |
| E7 | Release commits release point | state-transition | L1 | automated | drag active, previewed 120, move to 130 pending (no frame yet) | `pointerup` at 140 | `onPreview` last call = 140 (130 never previewed), then `onEnd(140)` exactly once; shield removed |
| E8 | Click without movement | BVA (Δ=0) | L1 | automated | idle consumer | `pointerdown` at 100 → `pointerup` at 100 | `onEnd(null)`, `onPreview` never called, no shield ever mounted |
| E9 | Moved threshold | BVA (Δ=0 vs Δ=1) | L1 | automated | drag started at 100 | held move at 100, then `pointerup` at 100; separately held move at 101 then `pointerup` at 101 | first: `onEnd(null)`; second: `onEnd(101)` |
| E10 | Stable handler identity | state-transition | L1 | automated | consumer rendered with inline callbacks | re-render with new inline callbacks, then drag | `onPointerDown` reference `===` previous render's; the NEW callbacks receive `onPreview`/`onEnd` |
| E11 | Divider press keeps focus | EP | L1 | automated | `SplitDivider` mounted | `mousedown` on the divider (compat event) | event `defaultPrevented === true` |
| E12 | Split commits once on release | BVA (count) | L1 | automated | `SplitWorkspace` `split`, container 1000px wide at left 0, ratio 0.5 | 5 held moves to clientX 600 with frames, `pointerup` at 600 | `onRatioChange` called exactly once, with 0.6, after release |
| E13 | Split ratio clamp | BVA | L1 | automated | same container | drag to clientX 100 (→0.1) and release; separately to 900 (→0.9) | `onRatioChange(0.25)` / `onRatioChange(0.75)` |
| E14 | Split live preview | state-convergence | L1 | automated | same container, drag active | held move to 600, `await nextFrame()` | chat wrapper `style.flexGrow`="0.6", editor wrapper `style.flexGrow`="0.4"; `onRatioChange` not yet called |
| E15 | Unrelated re-render keeps preview | state-transition | L1 | automated | drag active, preview at 0.6, prop `ratio` 0.5 | re-render `SplitWorkspace` with identical props mid-drag | chat wrapper `style.flexGrow` still "0.6" |
| E16 | Split click no-op | BVA (Δ=0) | L1 | automated | `split`, ratio 0.5 | down + up on divider at same point | `onRatioChange` not called |
| E17 | Split ratio persisted once | BVA (count) | L1 | automated | `SessionSplitView` for session `s1`, rendered; `localStorage.setItem` spy installed **after** initial render | drag 5 frames, release | `setItem` called exactly once with key `pi-dashboard:split:s1` |
| E18 | Handles opt out of touch panning (split) | EP | L1 | automated | `SplitDivider` in `h` and `v` | render | `style.touchAction === "none"` on both |
| E19 | Rail preview clamp | BVA | L1 | automated | `EditorPane` tree visible, row left 0, rail 224 | held moves to clientX 100 / 300 / 600, `nextFrame()` each | rail wrapper `style.width` = "160px" / "300px" / "480px" |
| E20 | Rail width persisted once | BVA (count) | L1 | automated | `EditorPane` for session `s1`, spy installed after render | drag to 300, release | `setItem` with key `pi-dashboard:rail:s1` exactly once, value 300 |
| E21 | Rail click no-op | BVA (Δ=0) | L1 | automated | rail 224 | down + up on `rail-divider` at same point | rail width still 224, no `pi-dashboard:rail:` write |
| E22 | Sidebar normal release unchanged | state-transition | L1 | automated | `ResizableSidebar` width 280 | drag to clientX 400, `pointerup` at 400 | `setWidth(400)` once |
| E23 | Sidebar knob never drags | EP | L1 | automated | expanded sidebar | `pointerdown` on `sidebar-collapse` knob, then held move | no shield, body cursor unchanged, `setWidth` not called |
| E25 | Handles opt out of touch panning (rail) | EP | L1 | automated | `EditorPane` rail divider | render | `style.touchAction === "none"` |
| E26 | Handles opt out of touch panning (sidebar + tree) | EP | L1 | automated | sidebar seam `drag-handle` + `ResizableTreePanel` handle | render | `style.touchAction === "none"` on both |
| E24 | Tree panel normal release | state-transition | L1 | automated | `ResizableTreePanel` width 250, parent left 0 | drag to 320, `pointerup` at 320 | panel `style.width`="320px" after release and no further change on later no-button moves |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Split/rail commit once (no per-frame React/storage work) | tail-latency (trace) | — | manual-only | live session with ≥200 messages, split open, outer divider dragged continuously | DevTools Performance trace: 0 React commits and 0 `localStorage.setItem` inside the drag window; scripting ms/frame lower than the pre-change trace — [judgment: relative comparison on real hardware, no CI-stable absolute threshold] | 3 s drag |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Releasing over an embedded frame ends the drag (split) | state-transition | L3 | automated | session in `split`, editor tab = HTML file preview (iframe) | mouse down on `split-divider`, move right into the iframe, mouse up over iframe, then `mouse.move` 200px with no button | `split-chat-pane` width after the no-button move === width at release (±1px) |
| F2 | Same, rail divider | state-transition | L3 | automated | split open, tree visible, HTML preview active | down on `rail-divider`, move right over iframe, up over iframe, no-button move 150px | rail width unchanged after the no-button move (±1px) |
| F3 | Shield works without pointer capture | fault-injection (abort capability) | L3 | automated | F1 setup + `page.evaluate` deleting `Element.prototype.setPointerCapture`/`releasePointerCapture` | F1 drag + release over iframe + no-button move | divider follows into the iframe region during the drag (width changes) and does not move after release |
| F4 | Pressing the divider keeps editing focus | state-transition | L3 | automated | split open, chat composer textarea focused | mouse down + up on `split-divider` without movement | `document.activeElement` is still the composer textarea |
| F5 | drag-body-style regression | state-transition | L3 | automated | existing `drag-body-style.spec.ts` scenarios | sidebar/split drag + mid-drag breakpoint flip | page text selectable, no residual resize cursor (spec unchanged, must stay green) |
| F6 | Engine coverage (Electron + Safari) | exploratory | — | manual-only | Electron app + Safari, HTML preview open, streaming session | release over iframe; release outside window and return; drag during streaming | [judgment: drag ends with no jump, no preview flicker — real engines/hardware] |
| F7 | Touch drag | exploratory | — | manual-only | phone/tablet, mobile stacked (`v`) divider | touch-drag the divider | [judgment: drag not cancelled by scroll, not ended early — hardware] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Pointer cancelled by platform | fault-injection (abort) | L1 | automated | drag active, previewed 120, move to 130 pending | `pointercancel` | `onPreview` not called again (130 never applied); `onEnd(120)` once; shield removed; body styles cleared |
| X2 | Capture lost | fault-injection (abort) | L1 | automated | same state | `lostpointercapture` on the handle | `onEnd(120)` once; teardown as X1 |
| X3 | Release missed, pointer returns with no button | fault-injection (lost event) | L1 | automated | same state | `pointermove` with `buttons: 0` at clientX 900 | `onEnd(120)` (not 900, not 130); later held moves → no `onPreview` |
| X4 | Lost release before any preview | BVA (nothing previewed) | L1 | automated | drag started, one held move pending, no frame yet | `pointercancel` | `onEnd(null)`, `onPreview` never called |
| X5 | Affordance removed mid-drag | fault-injection (unmount) | L1 | automated | drag active with pending frame | unmount the consumer | shield removed, body styles cleared, `onEnd` not called, pending frame never fires `onPreview`; a new instance can then start a drag |
| X6 | Sidebar lost release | fault-injection (lost event) | L1 | automated | `ResizableSidebar` mid-drag, previewed width 350 | `pointermove` `buttons: 0` at clientX 480 | `setWidth(350)` once; sidebar width stays 350px; no shield |

---

## Coverage summary

- Requirements covered: 4/4 ADDED requirements in `resize-drag-lifecycle`
  (frames shielding: E1, F1–F3 · lost release: X1–X6, F1–F2 · ≤1 preview/frame:
  E4–E7 · commit once on release: E12–E17, E19–E21) + regression guards for
  `drag-body-style` (F5), `split-editor-workspace` clamps (E13),
  `resizable-sidebar` (E22–E23); touch opt-out E18, E25, E26.
- Scenarios by class: edge 26 · perf 1 · frontend 7 · error 6
- Scenarios by level: L1 32 · L2 0 · L3 5 · — 3
- Scenarios by disposition: automated 37 · manual-only 3

## New infra needed

- `packages/client/src/test-support/pointer.ts` pointer-event helper (task 1.1).
  No new harness or level.
