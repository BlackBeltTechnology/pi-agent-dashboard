## 1. Lock in the regression with a failing test

- [ ] 1.1 Create `packages/client/src/components/__tests__/SessionList.expanded-pinned-drag.test.tsx` mirroring the style of `session-drag-reorder.test.tsx` (jsdom, render `<SessionList>` with two pinned groups, both expanded by default).
- [ ] 1.2 Add scenario "expanded pinned-group drag reorders": fire a synthetic `DragEndEvent` with `active = { id: groupA-cwd, data: { current: { type: "pinned-group" } } }` and `over = { id: groupB-cwd, data: { current: { type: "pinned-group" } } }`. Assert `onReorderPinnedDirs` is called with the swapped cwd order.
- [ ] 1.3 Add scenario "session drag inside expanded group does not reorder pinned groups": fire a `DragEndEvent` with both `active.type` and `over.type` = `"session"`. Assert `onReorderSessions` is called and `onReorderPinnedDirs` is NOT called.
- [ ] 1.4 Run `npm test -- SessionList.expanded-pinned-drag` and confirm 1.2 fails (because real-browser-shaped collision picks a session over the group), 1.3 passes. Capture both as the red baseline. (Note: jsdom may not reproduce the geometric collision-detection failure directly — if not, fall back to a unit test of `sameTypeClosestCenter` itself in `__tests__/sameTypeClosestCenter.test.ts` that constructs synthetic `DroppableContainer` rectangles and asserts only same-type containers participate. Both layers of coverage are valuable.)

## 2. Add the type-aware collision detection helper

- [ ] 2.1 In `packages/client/src/components/SessionList.tsx`, define `sameTypeClosestCenter: CollisionDetection` above the `SessionList` component (or in a small adjacent file `lib/same-type-closest-center.ts` if the test in 1.4 prefers a separate module).
- [ ] 2.2 The function MUST: read `args.active.data.current?.type`; if absent, delegate to `closestCenter(args)` unchanged; otherwise filter `args.droppableContainers` to entries whose `data.current?.type === activeType` and delegate to `closestCenter({ ...args, droppableContainers: filtered })`.
- [ ] 2.3 Replace `collisionDetection={closestCenter}` on the sidebar `DndContext` with `collisionDetection={sameTypeClosestCenter}`.
- [ ] 2.4 Re-run the test suite from §1; both scenarios pass.
- [ ] 2.5 Confirm no other test regressed (`npm test`).

## 3. Defensive verification

- [ ] 3.1 Leave the `if (activeType !== overType) return;` guard in `handleDragEnd` untouched. Add an inline comment citing this change name explaining that the collision filter makes this guard effectively unreachable for in-tree drag types but it stays as defense-in-depth for future drag types.
- [ ] 3.2 Manually verify in a running dashboard:
  - Pin two folders A and B.
  - Expand both.
  - Drag A's drag-handle onto B's header → A and B swap order, persistence updates.
  - Collapse both → repeat the drag → still works (regression check on the previously-working path).
  - Drag a session card inside expanded group A → session reorder works, pinned-group order unchanged.
  - Drag an ended session inside group A onto an alive session → drag-to-resume still fires.

## 4. Documentation

- [ ] 4.1 Update the `SortablePinnedGroup.tsx` row (or the `SessionList.tsx` row) in `AGENTS.md` with a one-line note: *"Drag-to-reorder uses `sameTypeClosestCenter` collision detection so expanded groups stay reorderable. See change: fix-expanded-pinned-group-drag."*
- [ ] 4.2 Check `docs/architecture.md` for any section describing sidebar drag-and-drop. Update if present; skip if absent.
- [ ] 4.3 No README changes (this is internal mechanics).

## 5. Verify

- [ ] 5.1 `npm test 2>&1 | tee /tmp/pi-test.log` — confirm zero new failures.
- [ ] 5.2 `npm run reload:check` once before merging to ensure type-check passes.
- [ ] 5.3 `openspec change validate fix-expanded-pinned-group-drag` returns clean.
