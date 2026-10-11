# Test Plan — fix-canvas-chip-tray-overlay

Stage: design   Generated: 2026-10-11

No clarification gaps: every Triple below is concrete.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | tray floats without affecting layout | state (no chip → chip) | L3 | automated | desktop 1200×800, fresh git session, no chip | `sendPrompt("[[faux:canvas-declare-server]] go")` | `canvas-server-chip` visible; the bounding boxes of the session header/toolbar and `split-chat-pane` are identical (±0.5 px) before and after the chip appears; `canvas-chip-tray`'s parent is `document.body` (portal) |
| E2 | tray is never wider than the viewport | BVA (narrow viewport, long title) | L3 | automated | 360×740 viewport; server chip whose title is ≥ 80 chars | chip shown | tray `getBoundingClientRect().left ≥ 0` and `.right ≤ 360 − 16`; label span `scrollWidth > clientWidth` (truncated) |
| E3 | no-anchor fallback | EP (anchor: none) | L1 | automated | `<CanvasDriver state={withChip} />` (no `anchor` prop) | render | tray rendered via portal under `document.body`; inline `bottom` is `calc(1rem + env(safe-area-inset-bottom))`; `visibility` not hidden |
| E4 | pre-measure hidden | state (anchor set, unmeasured) | L1 | automated | `anchor` = a detached-then-attached element, `ResizeObserver` shim not yet fired | first render | tray has `visibility: hidden` until the first measure callback, then `visible` with numeric `bottom` |
| E5 | pointer-event split | EP | L1 | automated | `state` with a server chip and a mobile file target | render | tray element has class `pointer-events-none`; each chip `<button>` has `pointer-events-auto` |
| E6 | jsdom safety | fault (missing API) | L1 | automated | jsdom (no `visualViewport`), `ResizeObserver` shimmed | mount + unmount `<CanvasDriver anchor={el} … />` | no throw; all observers disconnected and listeners removed on unmount (spy counts add == remove) |
| E7 | frozen underlay never anchors | decision table (frozen × readOnly) | L3 | automated | desktop 1200×800, live session (a) plain, (b) with the Settings route-overlay open over its frozen underlay | count `[data-testid=composer-stack-anchor]` | (a) 1 · (b) 0. (The read-only branch shares the same `!readOnly` guard as the composer itself.) App.tsx cannot be mounted in a unit test (see `chat-pane-row-completeness.test.ts`), so this is L3 |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | tray follows a growing composer stack | state-convergence | L3 | automated | desktop, server chip shown | type a 6-line draft (Shift+Enter ×5) in the composer | converges to: chip `rect.bottom ≤ composer-stack top` (the `composer-context-strip`, else `composer-root`, top) after growth; the tray's `bottom` value increased |
| F2 | tray follows a row mounting | state-convergence | L3 | automated | desktop, server chip shown, idle (no `StatusBar`) | send a prompt so the session streams (`StatusBar` mounts) | while streaming: chip `rect.bottom ≤` top of the topmost stack row; after the turn ends: invariant still holds |
| F3 | composer popover above tray | layering | L3 | automated | desktop, server chip shown | open the composer model selector | `document.elementFromPoint` at the chip's centre returns a node inside the popover whenever the popover covers that point; otherwise the chip stays clickable |
| F4 | empty tray area passes clicks | layering | L3 | automated | desktop, server chip shown | `elementFromPoint` 4 px left of the chip, inside the tray box | returns chat-pane content, not the tray element |
| F5 | dialog paints over tray | layering | L3 | automated | desktop, server chip shown | open Settings (route-backed overlay) | `elementFromPoint` at the chip centre is inside the dialog/backdrop; after closing, the chip is back above the composer stack (F1 invariant) |
| F6 | mobile file chip floats too | state | L3 | automated | 767×800 viewport, fresh session | `sendPrompt("[[faux:canvas-write-md]] go")` | `canvas-file-chip` visible; `split-chat-pane` box unchanged vs before; tapping the chip opens `split-editor-pane` with the file as the active tab (foreground) |
| F7 | stays above soft keyboard | device | — | manual-only | iPhone Safari, server chip shown | focus the composer (keyboard opens) | [judgment: chip visible above the composer and not hidden by the keyboard; no automatable soft-keyboard signal in the docker harness] |
| F8 | no flash on first appearance | visual timing | — | manual-only | desktop, throttled CPU | chip first appears | [judgment: no visible frame with the chip over the composer; E4 covers the mechanism at L1] |

---

## Coverage summary

- Requirements covered: 1/1 delta requirement (all 9 scenarios mapped: E1/E2/E3 · F1/F2 · E7/F5 · E4/F8 · F7 · F3 · F4/E5 · F6) + #681
- Scenarios by class: edge 7 · perf 0 · frontend 8 · error 0
- Scenarios by level: L1 4 · L2 0 · L3 9
- Scenarios by disposition: automated 13 · manual-only 2

## New infra needed

- none (L3 reuses `faux:canvas-declare-server` / `faux:canvas-write-md` and the helpers in `tests/e2e/canvas-declare-tool.spec.ts`)
