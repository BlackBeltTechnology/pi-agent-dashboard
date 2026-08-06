## Context

`OpenSpecBoardView.tsx` (~963 lines) renders the board with `@dnd-kit/core@^6.3.1` + `@dnd-kit/sortable@^10`. Columns are a horizontal `SortableContext`; each column body is a vertical `SortableContext` of proposal cards. `DndContext` uses `collisionDetection={closestCenter}` and handles only `onDragStart` / `onDragEnd`.

Drop resolution lives in `handleDragEnd`'s card branch. It derives `insertIndex` against `targetNames` (column minus the moved card), then applies a `+1` guarded by comparing that index against `findIndex(movedName)` in the *unfiltered* array — two index spaces mixed. Replaying it over `a,b,c,d`: adjacent downward drags are no-ops, same-column down inserts *after*, same-column up inserts *before*, cross-column always inserts *before*.

`computeReorder(currentOrderedNames, movedName, targetIndex)` in `lib/openspec/openspec-board-order.ts:60-68` filters the moved name and clamps — **its `targetIndex` is an index into the without-moved list**, which is exactly the raw `insertIndex`. The caller's `+1` is a spurious correction, not a missing one. Verified against source; the helper is correct and stays untouched.

Measured live: 9 columns, every body `clientHeight` 378px against `scrollHeight` up to 2468px; in 8 of 9 the space below the last card is negative.

> **Revision note.** This design was rewritten after an adversarial review pass (single-model + cross-model on `@propose-review-1`) invalidated four load-bearing claims in the first draft: the wrong dnd-kit event, a collision fallback that destroyed the cancel path, an append rail that sat below the scroll fold, and auto-scroll that cannot reach a descendant scroller. Each is now a named decision below with the source line that settles it. A fifth claim — "4 themes (studio/earth/athlete/gradient)" — was simply false; see D7.

## Goals / Non-Goals

**Goals**

- One drop rule, independent of drag direction and of same- vs cross-column.
- Every slot reachable by pointer, including after the final card of an overflowing column, **without scrolling first**.
- The resolved slot visible continuously and *truthfully* during the drag.
- The whole column — header, body, padding — accepts a drop.
- No change to persistence format, group-assignment semantics, or `computeReorder`.

**Non-Goals**

- Keyboard-accessible DnD. dnd-kit ships `KeyboardSensor`; the board never had it, and adding it here widens the change past the reported defect. Follow-up.
- Multi-card selection / drag.
- Column drag behaviour, except where D5's ref merge provably touches it.
- Touch-specific tuning beyond `PointerSensor` defaults.
- Virtualising long columns (real at 64 cards; separate change).

## Decisions

### D1 — Resolve on `onDragMove`, not `onDragOver`

`handleDragMove` computes `{ colKey, index }` into `dropSlot`; `handleDragEnd` only commits it.

*Why not `onDragOver`:* it fires only when the hovered droppable changes — `core.cjs.development.js:3283` gives the effect deps as `[overId]`. Crossing a card's midpoint *within one droppable* does not change `over`, so the marker would freeze and `handleDragEnd` would commit a stale slot — the exact "the line said one thing, the drop did another" failure this decision exists to prevent. `onDragMove`'s deps are `[scrollAdjustedTranslate.x, scrollAdjustedTranslate.y]` (`:3240`), i.e. every pointer move.

*Guard:* compare the newly resolved slot against the previous one and return early when equal, so a move within one gap causes no `setState`.

### D2 — Midpoint rule, one index space, explicit tie-break

```
index = |{ cards in target column, excluding the moved card,
           whose rect midpoint Y is above pointer Y }|
```

Yields an index into the without-moved list — `computeReorder`'s contract — for every case. The `+1` is deleted, not repaired. **Pointer exactly at a midpoint resolves to *after*** (the `>` vs `>=` boundary is pinned so it is not left to the implementer).

*Rect source (load-bearing):* read the cards' rects from dnd-kit's `droppableContainers` rect map, not a per-move `getBoundingClientRect()` sweep — a 64-card column then costs a map read per move instead of 64 forced layout reads.

**Read the adjusted getters (`rect.top` / `rect.bottom`), never the raw snapshot (`rect.rect.top`).** `class Rect` (`core.cjs.development.js:977-1010`) defines each edge as a getter returning `this.rect[key] + (scrollOffsetsAtMeasure[axis] − currentOffsets[axis])`, so the getters are **already scroll-live** and stay correct through auto-scroll with no re-measure. The raw `rect.rect` snapshot is frozen at measure time and would diverge by the body's scroll offset — 0–2000px on this board — silently resolving the wrong slot.

No `measuring` prop change is required. (An earlier draft called for `measuring.dragging.frequency = Always`; that is wrong three ways — the key is `measuring.droppable`, `MeasuringFrequency` only defines `"optimized"` (`:1953-1955`), and `Always` is a `MeasuringStrategy` (`:1947-1951`). Defaults suffice because of the getter behaviour above.)

*Why not dnd-kit's `arrayMove` displacement semantics:* it is the convention inside a single sortable list, but cross-column drops have no displacement analogue — which is how the current up/down/cross asymmetry arose.

### D3 — `pointerWithin` alone; a null `over` is a real cancel

Replace `closestCenter` with `pointerWithin`, **with no `closestCorners` fallback**.

*Why the fallback is removed:* `closestCorners` returns the globally nearest droppable and is empty only when zero droppables exist — there are always 9 columns. With it composed in, `over` is never null in the board gutter or off-window, so the `if (!over) return` guard (`OpenSpecBoardView.tsx:294`) can never fire, and D1's commit path would land the last in-column slot on a release the user meant as a cancel. Worse, the nearest column from the gutter is a *neighbour*, so a cancel becomes an unintended cross-column move.

*Commit gate (frame race):* `handleDragEnd` must gate on the **live `over` from the end event**, not merely on a non-null `dropSlot`. `dropSlot` is only cleared when a subsequent `onDragMove` fires with `over == null`; a single-frame move into the gutter followed by release would otherwise commit a stale slot. Rule: commit only when the end event's `over` is non-null **and** `dropSlot` agrees with it.

Gaps between cards are still inside the column droppable, so `pointerWithin` returns the column there — the "dead frames" the fallback was meant to cover do not exist. `over == null` ⇒ `dropSlot = null` ⇒ `handleDragEnd` commits nothing.

### D4 — Append rail: sticky, inside the scrollable body, own id namespace

The rail renders **inside** `board-column-body` as the last flex child with `position: sticky; bottom: 0`, only while a card drag is active, ≥44px tall.

*Why sticky, not in-flow:* an in-flow rail "after the last card" sits below the scroll fold in 8 of 9 measured columns — unreachable in precisely the case it exists for, which was the first draft's self-contradiction. Sticky pins it to the visible bottom edge regardless of scroll position.

*Why inside the body, not the column root:* see D5 — auto-scroll follows the **over node's ancestors**, so the rail must live inside the scroller it needs to scroll.

*Id namespacing (corruption guard):* the rail registers as `rail:<colKey>`, and `handleDragEnd` gets an explicit `overType === "rail"` branch mapping it back to `colKey`. Without that branch, `targetKey = String(over.id)` (`OpenSpecBoardView.tsx:317`) becomes `"rail:<colKey>"`, `columns.find()` misses, and the code persists **a bogus group assignment plus a `changeOrder` entry under a non-existent group key** — the dragged card then falls back to Ungrouped on reload. (The real column's own order is left intact; an earlier draft mis-stated this as an order-wipe.)

**The same guard applies to `col-root:<colKey>` from D5** — any non-card `over` id that is not a bare group key must be normalised to its `colKey` before it reaches `targetKey`. Resolve the column id in one place so a future droppable cannot reintroduce this.

*Empty columns:* the rail renders there too, alongside the existing `EmptyState`, and resolves to index 0. The spec requirement is unconditional, and the midpoint rule degenerates correctly (`|{}| = 0`).

### D5 — Droppable stays on the body; the column root gets a *second*, distinct droppable

`board-column-body` keeps its `useDroppable`. The column root additionally registers `col-root:<colKey>` so the header and outer padding accept drops, resolving to the same column.

*Why not "move the ref to the root" (the first draft's plan):* two independent reasons, both fatal.
1. **Auto-scroll.** `useScrollableAncestors(overNode ?? activeNode)` (`core.cjs.development.js:2953`) walks the *over node's ancestors*. With the droppable on the root, the scrollable body is a **descendant**, so hovering the append region would auto-scroll nothing — breaking the very scenario D6 specifies.
2. **Ref collision.** The root already carries `ref={sortable.setNodeRef}` (`:631`) for column reorder. A second `ref=` cannot be assigned; it needs an explicit merge callback, and the surviving registered rect would also change the *sortable's* own collision geometry.

Keeping the body droppable and adding a separately-identified root droppable avoids both: no ref merge on the body, and the root's merge is a deliberate, tested two-line callback rather than an unnoticed overwrite.

*Header caveat:* when `draggableHeader` is true the header carries `sortable.listeners` for column drag (`OpenSpecBoardView.tsx:638`). Those listeners only fire on pointer-down; during an active card drag no column drag can start, so accepting a card drop there does not conflict. Task-level verification is listed rather than assumed.

*Column-reorder regression (must handle):* the **column** branch of `handleDragEnd` does `ids.indexOf(String(over.id))` and bails on `-1`. Once `col-root:<colKey>` exists, dragging a *column* over another column's header resolves `over` to `col-root:…`, which is not a group id → silent no-op, breaking existing column reorder. The column branch must normalise `col-root:<k>` → `<k>` through the same resolver as D4.

*Note on the existing id collision:* `useSortable({id: colKey})` (`:624`) and `useDroppable({id: colKey})` (`:625`) **already** register the same droppable id today, and the registry `Map.set` means the body's registration wins purely by hook-call order. Namespacing the root as `col-root:<colKey>` is **orthogonal** — it neither removes nor worsens that pre-existing collision. (An earlier draft claimed it removed the shadowing; it does not.) The latent fragility is noted, not fixed here.

*Droppable `data` must be pinned:* register `rail:<k>` and `col-root:<k>` with explicit `data: { type, groupKey }` so `handleDragMove` and `handleDragEnd` derive the same `colKey` from the same field. The resolver must return **both** the column key and the kind (`card` | `body` | `root` | `rail`), because rail resolves to the last index while the others resolve by midpoint — collapsing ids to a bare `colKey` discards the distinction.

### D5a — `onDragCancel` is required, and it does **not** cover blur

`DndContext` currently wires only `onDragStart` / `onDragEnd` (`OpenSpecBoardView.tsx:438`). dnd-kit dispatches `Action.DragCancel` → **`onDragCancel`**, a callback distinct from `onDragEnd`. Without it, `activeDrag` and `dropSlot` survive an interrupted drag, so the marker, rail, and receded columns stick on screen. Wire `onDragCancel` to clear **both** `activeDrag` and `dropSlot`.

**Blur is not covered by dnd-kit.** `AbstractPointerSensor.attach()` binds `pointercancel`, window `resize`, and `visibilitychange` — there is **no `blur` listener** in core. So `onDragCancel` fires on pointer-cancel and tab-hide, but not when the window merely loses focus (alt-tab with the tab still visible, focus moving to devtools). The spec's interrupted-drag scenario names blur, so a **separate window `blur` handler** is required that clears the same state. An earlier draft asserted dnd-kit handled blur; it does not.

### D5b — The collision change is global, and it regresses column drag

`collisionDetection` is a single `DndContext` prop (`OpenSpecBoardView.tsx:438`) applying to **every** drag, cards and columns alike. Switching `closestCenter` → `pointerWithin` therefore changes column-drag behaviour, which the Non-Goals list as out of scope — exclusion is fine, silent breakage is not. Two concrete regressions:

1. **Gutter release.** Under `closestCenter` a column released in the inter-column gutter resolved to the nearest column and reordered. Under `pointerWithin` no droppable contains the pointer → `over = null` → the column branch bails → the reorder is silently lost.
2. **Release over a card.** `pointerWithin` elects the innermost droppable, so releasing a dragged *column* over any card of the target column yields `over = <card>`; `ids.indexOf(over.id)` → `-1` → silent no-op.

Both are fixed by the same measure: the column branch resolves its target through the D4 resolver, which maps a card id, a `col-root:<k>`, or a `rail:<k>` back to its owning column key. A spec scenario now pins column reorder surviving the change.

### D5c — RESOLVED BY SPIKE: resolve inside a headless probe child, not in the parent

D2 requires reading card rects from dnd-kit's `droppableRects` / `droppableContainers`. Those are exposed only through `useDndContext()`, i.e. from a component **inside** `<DndContext>`. The board's handlers are defined in `OpenSpecBoardView`, the **parent** of `<DndContext>` (`OpenSpecBoardView.tsx:438`), and the `DragMoveEvent` payload carries only `{active, activatorEvent, collisions, delta, over}` — no rect map, and `collisions` lists only droppables containing the pointer, not every card.

**Measured** (spike, `@dnd-kit/core` 6.3.1, React 19.2.7):

| position | `droppableRects.size` | card containers |
|---|---|---|
| parent of `<DndContext>`, at mount | **0** | 0 |
| parent of `<DndContext>`, at drag start | **0** | 0 |
| child inside `<DndContext>` (`useDndContext` + `useDndMonitor`) | **19** | **17** |

A literal parent-side implementation would resolve against empty rects — `resolveDropSlot` returns `0` and **every drop lands at index 0**, silently.

**Decision: option (c).** A headless probe component rendered inside `<DndContext>` calls `useDndContext()` for the rect map and `useDndMonitor()` for `onDragMove`, resolves the slot, and lifts it to the board via callback. Chosen over (a) restructuring the board and (b) a parent-held element-ref map, because it is additive — `OpenSpecBoardView`'s shape is unchanged — and it keeps D2's map read rather than reintroducing per-move `getBoundingClientRect` sweeps.

**`pointerY` derivation — measured, not assumed.** Inside `onDragMove`, `pointerY = activatorEvent.clientY + delta.y`. Spike measured derived `314.4` against a real pointer `314.4` — **0px error**. This is the space the scroll-live Rect getters live in; raw `translate` or `collisionRect` drifts under scroll.

### D6 — Insertion marker paints in the existing gap; it adds no flex child

The marker is **not** an inserted element. The card that would follow the resolved slot receives a marker class painting a 3px bar in the `gap-2` space above it via a pseudo-element.

**Host lookup crosses index spaces — the exact bug class this change exists to kill.** D2's index is into the **without-moved** list; "the card that follows the slot" is a lookup into the **rendered** list, which (with the strategy neutralised) still contains the dragged card. For a same-column drag, any slot at or after the moved card's rendered position needs `renderedIndex = withoutIndex + 1`; a cross-column drag needs no offset. Naively indexing the rendered list picks the dragged card itself as the marker host. The translation must be explicit and unit-tested — do not let a second `+1` be discovered at runtime.

**The final slot needs its own indicator.** There is no card following the last slot, so no marker can paint there. Per the spec, the append affordance enters its active state whenever the **resolved slot is last** — driven by the resolved slot, *not* by the pointer being over the affordance. Without that, hovering the bottom half of the last card resolves to "last" while nothing at all is indicated, which the contract forbids.

*Slot 0 note:* the first slot's marker paints into the body's `p-2` top padding rather than a flex gap; the zero-layout-change claim holds for padding as it does for the gap.

*Why not a flow element (the first draft's plan):* the body is `flex flex-col gap-2` (`OpenSpecBoardView.tsx:655`). Inserting a child adds its 3px height **plus a second 8px flex gap**; a `-3px` margin cancels only the height, leaving ~+8px of shift that relocates every time the marker moves — and at a midpoint boundary that shift can flip the resolved slot, oscillating the marker between two gaps. Painting into the existing gap is exactly zero layout change, so the resolution is stable and no re-measure-on-scroll is needed (the reason the overlay approach was rejected).

*Paint host:* the following card already carries `relative isolate` and may host a `.card-stripes-fx` overlay child, so the marker uses a distinct pseudo-element and its own z-index band to avoid colliding with that overlay.

*`verticalListSortingStrategy` must be neutralised — and `strategy={undefined}` does NOT do it.* `SortableContext` destructures `strategy = rectSortingStrategy` (`sortable.cjs.development.js:303`) and `useSortable` resolves `localStrategy ?? globalStrategy`, so omitting the prop silently enables `rectSortingStrategy`, which still displaces vertically in a stacked column. Pass an explicit no-op strategy (`() => null`) instead, keeping `SortableContext` for item registration only.

*Why neutralise at all — correctness, not cosmetics:* with displacement active, cards' **visual** positions diverge from **data** order mid-drag, so D2's rect-midpoint count no longer equals the data-order index `computeReorder` consumes. Neutralising the strategy is what keeps the count valid; the lost displacement animation is a side effect, not the motive. Do **not** "revisit by re-enabling a matching strategy" without re-deriving the index from data order first.

### D7 — Theme tokens: 9 themes × light/dark, and `--accent-primary` is *not* one of them

Correction to the first draft, which claimed "4 themes (studio, earth, athlete, gradient)" and "verified against all four". `THEMES` in `packages/client/src/lib/theme/themes.ts:611-620` defines **9**: base, dracula, nord, github, catppuccin, tokyo-night, rose-pine, solarized, gruvbox — each with `dark` and `light` maps. The named four do not exist in this repo.

Further, `--accent-primary` is **not** theme-switched: it is set statically in `index.css:62` (dark `#3b82f6`) and `:154` (light `#2563eb`) and appears nowhere in `themes.ts`. Using it is safe and consistent with existing board code, but "it adapts per theme" is false and must not be claimed.

Surfaces (`--bg-secondary`, `--bg-tertiary`, `--border-primary`) *are* per-theme, so marker/rail contrast must be checked against all 9 × 2 combinations — not asserted from one.

## Risks / Trade-offs

- **Disabling `verticalListSortingStrategy` removes live displacement animation** → accepted deliberately: an animation that contradicts the marker is worse than no animation. If it reads as static, revisit with a strategy that matches midpoint semantics rather than re-enabling the mismatched one.
- **Per-move resolution cost on a 64-card column** → measure against the 64-card `next-phase` column before landing. The early bail-out when the resolved slot is unchanged is the primary mitigation. (An earlier draft costed a `measuring.frequency: Always` config that D2 has since shown to be both wrong and unnecessary.)
- **Auto-scroll over an inter-card gap — investigated, downgraded to low risk.** In theory `getScrollableAncestors` skips the element itself, so with `over` = the body the body is not its own ancestor and would not scroll; the spike did confirm `over` can be the body (19 of 114 sampled y positions land in inter-card gaps). But a real-pointer drag to the bottom edge **does** auto-scroll the body to its maximum (0 → 305), and the gap-only stall could not be reproduced: the state is self-correcting, because any card hover resumes scrolling and once scrolled the last card occupies the edge. Pinned by a Playwright assertion rather than treated as a blocker.
- **Changing drop semantics surprises muscle memory** (same-column downward used to displace) → the new rule is strictly more predictable, pinned by the direction-independence scenario, and the marker makes the outcome legible pre-release.
- **Sticky rail overlays whichever card is at the body's bottom edge.** Only when scrolled to the bottom is that the last card (where rail and D2 agree). Mid-scroll the rail overlays a middle card whose midpoint would resolve to a non-last slot. **Precedence is therefore specified, not left to z-order: when `over` is the rail, the slot is the last index and the in-gap marker is suppressed.**
- **Auto-scroll is inert ≤900px** where `index.css:774` sets `overflow-y: visible` — no overflow, nothing to scroll. The spec scenario is therefore scoped to viewports >900px rather than asserted unconditionally.
- **The mockup validates interaction, not the dnd-kit binding** — hand-rolled pointer handling. It cannot validate D1, D3, D5, or D6; only the Playwright scenarios can.

## Migration Plan

Pure client-side interaction change. No persisted-data, protocol, or API change; `changeOrder[]` keeps its shape, so rollback needs no data migration. Ships via `npm run build` + `/api/restart`. Rollback = revert the commit.

## Open Questions

- The Ungrouped column's rail means "remove group assignment" — wording must not read as "add to a group". Resolved at task 4.3, not deferred.
- Is 44px workable on phone (`≤540px` stack), where vertical space is scarcest? Must be answered in task 6.4; the spec floor is 44px (WCAG 2.5.8), and the proposal's earlier "52px" was an inconsistency, now normalised to 44px.
- Should the marker also render in the source column at the card's original position to signal "release here to cancel"? Deferred; likely noise.
