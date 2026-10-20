# Test Plan: move-session-actions-trigger-to-card-edge

Stage: design   Generated: 2026-10-18

The HARD gate is resolved. There was one clarification: what a trigger click does on a hover-opened menu. The user chose **pin** (convert the menu to click-opened; a second click closes it). That is now spec scenario "Clicking the trigger pins a hover-opened menu" and design D4b.

Notation: R = the card's border-box right edge. Hit box = [R−19, R+5] × 26 px.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | session-actions-menu: Trigger not in header | structural | L1 | automated | desktop `SessionCard` for alive session `s1` | render | `session-actions-trigger-s1` is not a descendant of the header row; its wrapper is a direct child of `[data-session-card]` placed immediately after the content flex row and carries `absolute` + `card-edge-trigger`; the header contains Archive and ✕ |
| E2 | session-card-subcards: header controls | structural | L1 | automated | desktop card for an ended session with `sessionFile` in a git repo | render | the header renders the Archive button; no `session-actions-trigger-*` inside the header; the trigger exists on the card; no Resume/Fork/+Session/+Worktree buttons |
| E3 | Reserved gutter | structural | L1 | automated | desktop card | render | the card root className contains `pr-[18px]` and not `pr-2` (rewrites the pin at `SessionCard.test.tsx:1131`) |
| E4 | Glyph and pill markup | structural | L1 | automated | `SessionActionsMenu` with session `s1` | render | the button contains an inline SVG with 3 `<circle>`, `fill="currentColor"`, `aria-hidden="true"`; no `mdiDotsVertical` path; button classes include `focus-ring`, `inline-flex`, `before:content-['']`, `before:w-[24px]`, and lack `min-h-[44px]` / `sm:min-h-[32px]`; wrapper lacks `relative` |
| E5 | Selected ring escape | structural (CSS order) | L1 | automated | `packages/client/src/index.css` source | parse | a `.card-edge-trigger` rule declares `position: absolute` and `z-index: 20`, at a byte offset after `.card-selected-ring > *` |
| E6 | Faint trigger meets non-text contrast | EP over all palettes | L1 | automated | `--text-tertiary` and `--text-secondary` vs `--bg-primary` for base `index.css` dark/light + every palette × mode in `themes.ts` (18 pairs) | compute WCAG ratio | every pair ≥ 3.00; observed minimums ≈ 5.79 (tertiary) / 6.66 (secondary); a synthetic `#8a8a8a` on `#e1e2e7` fixture yields < 3 (proves the assertion can fail) |
| E7 | Trigger centred vertically on the whole card | BVA on card height | L3 | automated | (a) minimal card (title + status + model rows, about 87 px); (b) tall card with OPENSPEC + PROCESS + FLOWS (≥ 250 px) | load the page and read `getBoundingClientRect` | \|trigger centre y − card centre y\| ≤ 1 px on both; trigger x-span contains R |
| E8 | Bounds: 1 px clear of folder border | BVA (zoom) | L3 | automated | card inside a grouped folder enclosure | zoom 90% / 100% / 125% | pill right edge ≤ folder-border left edge − 1 px at every zoom |
| E9 | Bounds: ungrouped container | BVA | L3 | automated | card in an ungrouped list | render and focus the trigger with Tab | pill and its focus-visible outline are inside the scroller's right clearance; the scroller has `scrollWidth === clientWidth` (no horizontal scrollbar) |
| E10 | Focus ring not clipped | boundary | L3 | automated | grouped card, trigger focused via Tab | read the outline rect against the nearest clipping ancestor | outline right edge (≈R+10) < clip edge (≈R+14) |
| E11 | Hit area real (pseudo-element exists) | structural | L3 | automated | minimal card | `getComputedStyle(trigger,'::before').content` and `elementFromPoint(R−10, centreY)` | content ≠ `none`; elementFromPoint resolves to the trigger button (or a descendant) |
| E12 | Hit area ≥ 24×24, no overlap | decision table over card shapes × zoom | L3 | automated | shapes: (a) minimal; (b) attached change + lifecycle bar + dirty + PR pills; (c) PROCESS row; (d) running flow abort + MEMORY + STATUS badge claim + worktree slot claim; (e) inline rename active; zoom 100% and 125% | intersect the hit rect [R−18,R+6]×26 with every other `button, a, [role=button]` rect | hit rect ≥ 24×26; zero intersections in every cell |
| E13 | No overlap at minimum sidebar width | BVA (sidebar = `MIN_WIDTH` 180 px) | L3 | automated | shapes (a) and (b), sidebar resized to 180 px | measure every descendant border box, overflow included | no descendant other than the trigger intersects [R−18, R] |
| E14 | Clicking anywhere in the hit area toggles | EP (pill vs extension) | L3 | automated | minimal card, menu closed | click at (R−3, centreY) [pill], then Escape; then click at (R−15, centreY) [extension only] | both clicks open `session-actions-menu-s1`; `s1` does not become selected |
| E15 | Selected card height unchanged | invariant | L3 | automated | card `s1` unselected, then selected | measure the card height in both states | heights equal (±0.5 px); the trigger's wrapper computes `position: absolute` when selected |
| E16 | Tab order | sequence | L3 | automated | a card with header Archive + ✕ + an OPENSPEC lifecycle bar | Tab from the card's first control through to the trigger | the trigger receives focus after ✕ and after the subcard controls; Enter opens the menu with focus on its first enabled item |
| E17 | Mobile card has no trigger | EP (layout) | L1 | automated | mobile layout render (`isMobile`) | render | no `session-actions-trigger-*` in the DOM |
| E18 | Dimmed card exemption | EP (card opacity) | L1 | automated | card rendered with `isHidden` (and separately `session.closing`) | render | the card root carries `opacity-40` / `opacity-50`; the trigger is still rendered and clickable (the contrast floor is not asserted for dimmed cards, per spec) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Menu opens within 100 ms (unchanged requirement, new trigger location) | tail-latency regression | L3 | automated | 50 rendered session cards, click the edge trigger of one card 20× (close in between) | p95 click → panel visible ≤ 100 ms | 20 opens |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Clicking the trigger pins a hover-opened menu | state-transition (hover-open → click) | L1 | automated | `SessionActionsMenu` rendered `open` with source `"hover"` | click the trigger | `onOpenChange` is called with `(true, { source: "trigger", opener: <button> })`, never with `false` |
| F2 | Pinned menu survives pointer leave; second click closes | state-transition (pinned → leave → click) | L3 | automated | card `s1`; pointer rests in the strip below the pill until the hover open | click the pill; move the pointer to the chat pane and wait 600 ms (> 300 ms grace); click the pill again | after the first click the menu stays open and `aria-expanded="true"`; after the 600 ms wait it is still open; after the second click it is closed and `aria-expanded="false"` |
| F3 | Toggle unchanged for click-opened menus | state-transition (click-open → click) | L1 | automated | `SessionActionsMenu` `open` with source `"trigger"` | click the trigger | `onOpenChange(false)` is called once |
| F4 | Resting on the pill or its hit area does not dwell-open | state-transition (strip arming) | L1 | automated | `createHoverIntent` harness; pointer target = trigger button (pill) and, separately, the button via its `::before` region (same target) | pointermove samples at < 0.4 px/ms for 500 ms | no `open` callback fires |
| F5 | Strip off the pill still dwell-opens | state-transition (strip arming) | L3 | automated | card `s1`, pointer at (R−20, top + 12) (inside the strip, outside the hit box, not over ✕) | rest 400 ms below the speed cutoff | the menu for `s1` opens; keyboard focus is unchanged |
| F6 | Emphasis states | EP over states | L3 | automated | card `s1` at rest; hovered; trigger focused via Tab; menu open | read the computed `color` of the trigger button | rest = resolved `--text-tertiary`; hover / focus-visible / open = resolved `--text-secondary`; at rest opacity = 1 |
| F7 | `aria-expanded:` variant actually generated | structural | L1 | automated | trigger rendered with `aria-expanded="true"` in the vitest DOM with the built CSS (or class assertion fallback) | read className / computed style | className contains the `aria-expanded:` emphasis classes; in the L3 run (F6 "open") the computed colour equals `--text-secondary` |
| F8 | Touch device: trigger visible, tap opens | EP (pointer type) | L3 | automated | Playwright context with `hasTouch: true`, `isMobile: false`, desktop width (≥ 1024 px) so the desktop card renders | tap `session-actions-trigger-s1` | the trigger is visible at rest (opacity 1, not hidden); the menu opens; no hover strip arms (no open without the tap) |
| F9 | Right-click on the pill | EP (event type) | L3 | automated | card `s1` | right-click on the pill | the browser context menu is suppressed; the session menu opens at the pointer (clamped); `aria-expanded="true"` |
| F10 | Escape returns focus to the moved trigger | state-transition | L1 | automated | menu opened by clicking the trigger | press Escape | the menu closes; `document.activeElement` is `session-actions-trigger-s1` |
| F11 | Visual balance of the left bead / right pill | visual/subjective | — | manual-only | desktop sidebar with several cards, dark and light, two palettes | a human compares rest / hover / open | [judgment: the pill reads as a quiet but discoverable affordance and mirrors the drag bead; no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Menu opens despite a lazy panel chunk delay | fault-injection (delay) | L3 | automated | route the `SessionActionsPanel` chunk with a 1500 ms delay (first load, no prefetch cache) | click the edge trigger | `aria-expanded="true"` immediately; the panel appears after the chunk resolves; no error boundary fallback; a second click before it resolves closes cleanly with no orphan portal |
| X2 | Card unmount under a pinned menu | state-transition (unmount) | L1 | automated | menu pinned (F1 path) on card `s1` | remove `s1` from the session list | the menu closes; no element with `session-actions-menu-s1` remains; focus goes to the session region (existing unmount rule) |

---

## Coverage summary

- Requirements covered: 14/14:
  - session-actions-menu Trigger: Position, Bounds, Rest, Full emphasis, Reserved gutter, Hit area, Activation incl. pin, Glyph, Tab order;
  - Resting / strip interplay;
  - Touch;
  - Mobile;
  - session-card-subcards (×2);
  - session-card-selection.
- Scenarios by class: edge 18 · perf 1 · frontend 11 · error 2.
- Scenarios by level: L1 14 · L2 0 · L3 17 · manual-only 1.
- Scenarios by disposition: automated 31 · manual-only 1.

## New infra needed

- none. L1 extends `SessionActionsMenu.test.tsx`, `SessionCard.actions-menu.test.tsx`, `SessionCard.test.tsx`, `session-hover-intent.test.ts`, `selected-card-fx-css.test.ts`, and adds a sibling of `theme-body-text-contrast.test.ts`. L3 extends `tests/e2e/session-actions-menu.spec.ts`, using the geometry style of `tests/e2e/flow-card-grid-geometry.spec.ts`.
