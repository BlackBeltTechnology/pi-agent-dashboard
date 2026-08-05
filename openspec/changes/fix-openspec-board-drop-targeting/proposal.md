## Why

On the OpenSpec board a card cannot reliably be dropped into the **last position** of a column, and while dragging there is **no indication of where the card will land**.

Three defects in `OpenSpecBoardView.tsx` combine:

1. **The insertion index is direction- and scope-dependent, and partly wrong.** `handleDragEnd` computes `insertIndex` as an index into `targetNames` (the column *minus* the moved card), then adds a `+1` guarded by `insertIndex > colNames.findIndex(movedName)` — comparing an index in the *filtered* array against an index in the *unfiltered* array. Two index spaces are mixed. Replaying the exact expression over a column `a,b,c,d`:

   | drag | result | |
   |---|---|---|
   | `b` onto `c` (adjacent, down) | `a,b,c,d` | **no-op — the card springs back** |
   | `a` onto `b` (adjacent, down) | `a,b,c,d` | **no-op** |
   | `b` onto `d` (down) | `a,c,d,b` | inserts *after* |
   | `c` onto `a` (up) | `c,a,b,d` | inserts *before* |
   | cross-column, drop onto last card `d` | `a,b,c,X,d` | inserts *before* — **append impossible** |

   So: same-column downward inserts *after*, same-column upward inserts *before*, cross-column always inserts *before*, and any adjacent downward drag silently does nothing. The last slot is unreachable for every cross-column move, and every adjacent nudge appears broken.

2. **The drop target is the scroll-clipped inner body.** `useDroppable`'s ref is attached to `board-column-body` (`overflow-y-auto`), not the column root. The header and everything past the scroll fold reject drops, and there is no `flex-1` tail filler. The fallback `insertIndex = targetNames.length` (the only path to the last slot for a cross-column move) fires solely when `over` resolves to the *column* droppable — but with `collisionDetection={closestCenter}` the column's centre sits at the body's vertical midpoint, so a card centre always wins.

3. **Drop feedback is column-wide and effectively dead.** The only affordance is `isOver ? "ring-2 ring-inset ring-blue-500/60 bg-blue-500/5"` on the whole 378px body. Because of (2), `isOver` almost never becomes true during a card drag, so the spec's existing guarantee — *"the column under the pointer SHALL be highlighted as the drop target"* — does not hold in practice.

Measured on the live board (`/folder/<cwd>/openspec`, 9 columns): every column body renders at `clientHeight` 378px against `scrollHeight` up to **2468px**. In **8 of 9 columns** the space below the last card is *negative* (−536px, −2036px, −822px …) — the only "drop at end" region is an 8px padding strip that sits **below the scroll fold**, i.e. zero reachable pixels.

An interactive mockup at `mockups/openspec-board-dnd/index.html` reproduces the defect (`Fixes: OFF`) and validates the fix (`Fixes: ON`). With fixes off, hovering the last card at 20%/50%/80% of its height all yield "position 4 of 5"; only 97% reaches last.

## What Changes

- **One direction-independent drop rule.** Replace the mixed-index-space arithmetic with a single midpoint test: pointer above the hovered card's vertical centre resolves to the slot *before* it, below resolves to the slot *after* it — identically for same-column and cross-column drags, upward and downward. The resolved index is computed once against the without-moved list, which is exactly what `computeReorder` already expects, so the `+1` correction is deleted rather than repaired. This subsumes the no-op adjacent drag, the up/down asymmetry, and the unreachable last slot.
- **Live insertion indicator.** Track the resolved drop slot on **`onDragMove`** (not `onDragOver`, whose effect deps are `[overId]` — it does not fire when the pointer crosses a midpoint *within* one droppable) and paint an insertion marker into the existing flex gap the card will occupy, including the slot after the final card.
- **Whole column accepts drops.** Keep the droppable on `board-column-body` (dnd-kit auto-scrolls the *over node's ancestors*, so the scroller must stay on the drop path) and register a second, separately-identified droppable on the column root so the header and outer padding also accept drops. Add an **append rail** ("Drop at end of \<group\>") rendered only during a card drag, `position: sticky` to the body's bottom edge so it is reachable without scrolling, giving last-position a ≥44px target that never depends on residual empty space.
- **Legible drag state.** Outline the live target column and recede non-target columns, so the destination reads at a glance. Add edge-glow zones on overflowing columns that indicate (and drive) auto-scroll.
- **Correct collision detection.** Switch `closestCenter` → `pointerWithin`, the dnd-kit-recommended detector when droppables nest inside one another, as columns and cards do here. **No `closestCorners` fallback**: it is empty only when zero droppables exist, so it would make `over` non-null in the board gutter and turn an intended cancel into a commit — usually into a *neighbouring* column. Because `collisionDetection` is a single `DndContext` prop, this also changes **column** drag; the column branch is routed through the same target resolver so column reorder does not silently regress.

No change to persistence, group assignment semantics, or the drag payload shape. This is drop-target resolution and feedback only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-board`: `Requirement: Cards drag between and within columns` — add the guarantees that a card can be dropped into the last position of a column, that the resolved insertion point is continuously indicated during the drag, and that the entire column (header, body, append rail) is a valid drop target. Existing scenarios for group reassignment, intra-column reorder, and grab cursor are unchanged.

## Impact

- `packages/client/src/components/openspec/OpenSpecBoardView.tsx` — `handleDragEnd`, new `handleDragOver` + drop-slot state, `BoardColumn` droppable ref and append rail, `DndContext` `collisionDetection`.
- `packages/client/src/lib/openspec/openspec-board-order.ts` — `computeReorder` unchanged (it already takes a without-moved index); gains a new pure `resolveDropSlot` helper so the midpoint rule is unit-testable without a DOM. The defect itself lives in the **caller**, so unit tests on this module cannot regress it — the caller is covered by the Playwright scenarios.
- `packages/client/src/index.css` — insertion-marker, append-rail, and edge-glow styles; theme tokens only, no raw hex. Contrast **to be verified** against all **9** themes (`themes.ts` — base, dracula, nord, github, catppuccin, tokyo-night, rose-pine, solarized, gruvbox) in light and dark. Note `--accent-primary` is static in `index.css`, not theme-switched, so the blue-accented themes (github, tokyo-night, rose-pine, solarized) need particular attention.
- `openspec/specs/openspec-board/spec.md` — modified requirement (via delta).
- Playwright E2E (`tests/e2e/`) — new scenarios for last-position drop and insertion-indicator visibility.
- No server, extension, shared-protocol, or persistence changes. No breaking changes.

## Integration spike — done, results folded into design D5c

Three adversarial review cycles surfaced one item prose could not settle: the drag handlers live in the **parent** of `<DndContext>`, so dnd-kit's droppable-rect map — which the midpoint rule reads — is not reachable from them. A throwaway spike against the real library (`@dnd-kit/core` 6.3.1, React 19.2.7) settled it by measurement:

| question | result |
|---|---|
| Parent of `<DndContext>` rect-map size | **0** at mount and at drag start — a literal implementation lands every drop at index 0 |
| Child via `useDndContext()` + `useDndMonitor()` | **19** rects / **17** card containers → **chosen approach**, additive, board shape unchanged |
| `pointerY = activatorEvent.clientY + delta.y` | derived 314.4 vs real 314.4 — **0px error** |
| Auto-scroll at the bottom edge | body scrolls 0 → 305 (max) under a real pointer; the gap-only stall is self-correcting → Playwright assertion, not a blocker |

## Discipline Skills

- `scenario-design` — derive the edge cases for drop resolution (empty column, single card, overflowing column, cross-column append, drop on header, pointer released outside any column).
- `systematic-debugging` — the index-space defect was found by replaying the expression, not by reading it; the same method should confirm each remaining drop case before the rewrite is trusted.
- `review-code` — non-trivial interaction change touching a shared board component before commit.
