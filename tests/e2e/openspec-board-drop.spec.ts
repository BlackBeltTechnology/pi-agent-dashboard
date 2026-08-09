import { expect, test } from "@playwright/test";
import {
  beginCardDrag,
  beginColumnDrag,
  boxOf,
  card,
  cardEl,
  column,
  columnBody,
  columnKeys,
  headerGrabPoint,
  midpointOf,
  openBoard,
  orderOf,
  persisted,
  rail,
  setBoardLayout,
  UNGROUPED,
} from "./helpers/openspec-board.js";

/**
 * Browser E2E — OpenSpec board drop resolution and commit.
 *
 * These need REAL geometry: the midpoint rule reads dnd-kit's scroll-live
 * droppable rects, the append rail is `position: sticky` against a scrolled
 * body, and `pointerWithin` elects the innermost droppable under the pointer.
 * None of that exists in jsdom — the pure resolver is unit-tested in
 * `packages/client/src/lib/__tests__/openspec-board-drop.test.ts`, and the
 * DEFECT lived in the caller, so only these specs can regress it.
 *
 * Covers test-plan #F1, #F2, #F3, #F5, #F6, #F10, #F11, #F12, #F13, #F14,
 * #F15, #F17, #F18, #X1, #X2, #X3, #X4, #X5, #X6.
 * See change: fix-openspec-board-drop-targeting.
 */

const VIEWPORT = { width: 1500, height: 900 };
const A = card(1);
const B = card(2);
const C = card(3);
const D = card(4);
const X = card(5);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await openBoard(page, 10);
});

test.describe("board card drop resolution", () => {
  // #F1 — the baseline cross-column move still persists.
  test("F1: a cross-column move persists and survives a reload", async ({ page }) => {
    const ids = await setBoardLayout(page, [
      { name: "E2E Backlog", changes: [A, B] },
      { name: "E2E Flight", changes: [C] },
    ]);
    const backlog = ids.get("E2E Backlog")!;
    const flight = ids.get("E2E Flight")!;

    const move = await beginCardDrag(page, A);
    await move(await headerGrabPoint(page, flight));
    await page.mouse.up();

    await expect.poll(async () => orderOf(page, flight), { timeout: 15_000 }).toContain(A);
    expect(await orderOf(page, backlog)).not.toContain(A);
    // The local update is optimistic, so the persisted read is polled.
    await expect
      .poll(async () => (await persisted(page)).assignments[A], { timeout: 15_000 })
      .toBe(flight);

    await page.reload();
    await page.getByTestId("openspec-board").waitFor({ state: "visible", timeout: 30_000 });
    await expect.poll(async () => orderOf(page, flight), { timeout: 20_000 }).toContain(A);
  });

  // #F2 — intra-column reorder below a midpoint. Under the OLD code this exact
  // adjacent-downward drag was a silent no-op.
  test("F2: an intra-column reorder below a midpoint persists", async ({ page }) => {
    const ids = await setBoardLayout(page, [{ name: "E2E Reorder", changes: [A, B] }]);
    const col = ids.get("E2E Reorder")!;
    expect(await orderOf(page, col)).toEqual([A, B]);

    const move = await beginCardDrag(page, A);
    const mid = await midpointOf(cardEl(page, B));
    await move({ x: mid.x, y: mid.y + 6 });
    await page.mouse.up();

    await expect.poll(async () => orderOf(page, col), { timeout: 15_000 }).toEqual([B, A]);

    await page.reload();
    await page.getByTestId("openspec-board").waitFor({ state: "visible", timeout: 30_000 });
    await expect.poll(async () => orderOf(page, col), { timeout: 20_000 }).toEqual([B, A]);
    await expect
      .poll(async () => (await persisted(page)).changeOrder?.[col], { timeout: 15_000 })
      .toEqual([B, A]);
  });

  // #F3 — the reported defect: the last slot of an OVERFLOWING column was
  // unreachable for every cross-column move.
  test("F3: a card drops into the last position of an overflowing column", async ({ page }) => {
    const deep = Array.from({ length: 16 }, (_, i) => card(i + 10));
    const ids = await setBoardLayout(page, [
      { name: "E2E Deep", changes: deep },
      { name: "E2E Source", changes: [A] },
    ]);
    const deepCol = ids.get("E2E Deep")!;

    // The column must actually overflow, else the scenario is vacuous.
    const overflow = await columnBody(page, deepCol).evaluate(
      (el) => el.scrollHeight - el.clientHeight,
    );
    expect(overflow, "fixture column does not overflow").toBeGreaterThan(50);

    // Scroll to the bottom so the last card is on screen, then aim below its
    // midpoint — the pointer never touches the rail.
    await columnBody(page, deepCol).evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const last = deep[deep.length - 1];
    const move = await beginCardDrag(page, A);
    const mid = await midpointOf(cardEl(page, last));
    await move({ x: mid.x, y: mid.y + 8 });
    await expect(columnBody(page, deepCol)).toHaveAttribute("data-drop-slot", String(deep.length));
    await page.mouse.up();

    await expect.poll(async () => orderOf(page, deepCol), { timeout: 15_000 }).toEqual([...deep, A]);
    // The column's prior order is unchanged ahead of it.
    await expect
      .poll(async () => (await persisted(page)).changeOrder?.[deepCol], { timeout: 15_000 })
      .toEqual([...deep, A]);
  });

  // #F5 — the rail must resolve to the last slot, NOT replace the order with a
  // single entry (which a bogus `rail:<k>` group key would have done).
  test("F5: dropping on the rail appends and preserves the existing order", async ({ page }) => {
    const ids = await setBoardLayout(page, [
      { name: "E2E Target", changes: [A, B, C] },
      { name: "E2E Source", changes: [X] },
    ]);
    const target = ids.get("E2E Target")!;

    const move = await beginCardDrag(page, X);
    await move(await headerGrabPoint(page, target));
    await expect(rail(page, target)).toBeVisible();
    await move(await midpointOf(rail(page, target)));
    await expect(rail(page, target)).toHaveAttribute("data-rail-active", "true");
    await page.mouse.up();

    await expect.poll(async () => orderOf(page, target), { timeout: 15_000 }).toEqual([A, B, C, X]);
    await expect
      .poll(async () => (await persisted(page)).changeOrder?.[target], { timeout: 15_000 })
      .toEqual([A, B, C, X]);
    const store = await persisted(page);
    // No namespaced droppable id ever became a group key.
    for (const key of Object.keys(store.changeOrder ?? {})) {
      expect(key.startsWith("rail:")).toBe(false);
      expect(key.startsWith("col-root:")).toBe(false);
    }
    for (const gid of Object.values(store.assignments)) {
      expect(gid.startsWith("rail:")).toBe(false);
      expect(gid.startsWith("col-root:")).toBe(false);
    }
  });

  // #F6 — the requirement is unconditional, so an empty column has a rail too.
  test("F6: the rail works in an empty column", async ({ page }) => {
    const ids = await setBoardLayout(page, [
      { name: "E2E Empty", changes: [] },
      { name: "E2E Source", changes: [A] },
    ]);
    const empty = ids.get("E2E Empty")!;
    expect(await orderOf(page, empty)).toEqual([]);

    const move = await beginCardDrag(page, A);
    await move(await headerGrabPoint(page, empty));
    await expect(rail(page, empty)).toBeVisible();
    await move(await midpointOf(rail(page, empty)));
    await expect(rail(page, empty)).toHaveAttribute("data-rail-active", "true");
    await page.mouse.up();

    await expect.poll(async () => orderOf(page, empty), { timeout: 15_000 }).toEqual([A]);
  });

  // #F10 / #F11 — the droppable used to sit on the scroll-clipped inner body,
  // so the header and outer padding rejected drops entirely.
  test("F10+F11: the header, body, and outer padding all accept a drop", async ({ page }) => {
    const ids = await setBoardLayout(page, [
      { name: "E2E Target", changes: [A, B] },
      { name: "E2E Source", changes: [X] },
    ]);
    const target = ids.get("E2E Target")!;

    const move = await beginCardDrag(page, X);
    const col = column(page, target);

    // Header.
    await move(await headerGrabPoint(page, target));
    await expect(col).toHaveAttribute("data-drop-target", "true");
    // Body.
    await move(await midpointOf(cardEl(page, A)));
    await expect(col).toHaveAttribute("data-drop-target", "true");
    // Outer padding: inside the column root, outside the body's content box.
    const rootBox = await boxOf(col);
    const bodyBox = await boxOf(columnBody(page, target));
    const padX = Math.min(rootBox.x + 2, bodyBox.x - 1);
    await move({ x: padX, y: bodyBox.y + bodyBox.height / 2 });
    await expect(col).toHaveAttribute("data-drop-target", "true");

    // #F10 — releasing over the header moves the card in.
    await move(await headerGrabPoint(page, target));
    await page.mouse.up();
    await expect.poll(async () => orderOf(page, target), { timeout: 15_000 }).toContain(X);
  });

  // #F12 — exactly one column reads as the destination.
  test("F12: only the pointed-at column is marked as the drop target", async ({ page }) => {
    const ids = await setBoardLayout(page, [
      { name: "E2E One", changes: [A, B] },
      { name: "E2E Two", changes: [C] },
    ]);
    const one = ids.get("E2E One")!;
    const two = ids.get("E2E Two")!;

    const move = await beginCardDrag(page, C);
    await move(await midpointOf(cardEl(page, A)));
    await expect(column(page, one)).toHaveAttribute("data-drop-target", "true");
    await expect(column(page, two)).not.toHaveAttribute("data-drop-target", "true");
    await expect(column(page, UNGROUPED)).not.toHaveAttribute("data-drop-target", "true");
    // The non-target columns visibly recede.
    await expect(column(page, two)).toHaveClass(/board-column-receded/);
    await expect(column(page, one)).not.toHaveClass(/board-column-receded/);
    await page.keyboard.press("Escape");
    await page.mouse.up();
  });

  // #F13 — the affordances are drag-only, so the board at rest is unchanged.
  test("F13: no rail exists until a drag starts", async ({ page }) => {
    await setBoardLayout(page, [{ name: "E2E Rest", changes: [A, B] }]);
    expect(await page.locator('[data-testid^="board-append-rail-"]').count()).toBe(0);

    const move = await beginCardDrag(page, A);
    await move(await midpointOf(cardEl(page, B)));
    expect(await page.locator('[data-testid^="board-append-rail-"]').count()).toBeGreaterThan(0);

    await page.mouse.up();
    await expect
      .poll(async () => page.locator('[data-testid^="board-append-rail-"]').count(), { timeout: 10_000 })
      .toBe(0);
  });

  // #F14 / #F15 — pre-existing guarantees the collision change must not break.
  test("F14+F15: grab cursor at rest, grabbing while pressed, preview follows", async ({ page }) => {
    await setBoardLayout(page, [{ name: "E2E Cursor", changes: [A, B, C] }]);
    const el = cardEl(page, A);
    expect(await el.evaluate((n) => getComputedStyle(n).cursor)).toBe("grab");

    const move = await beginCardDrag(page, A);
    const chip = page.getByTestId("board-drag-chip");
    await expect(chip).toBeVisible();
    expect(await chip.evaluate((n) => getComputedStyle(n).cursor)).toBe("grabbing");

    const before = await boxOf(chip);
    const mid = await midpointOf(cardEl(page, C));
    await move({ x: mid.x, y: mid.y + 200 });
    const after = await boxOf(chip);
    expect(Math.abs(after.y - before.y), "preview did not track the pointer").toBeGreaterThan(100);
    await page.mouse.up();
  });

  // #F17 / #F18 — `collisionDetection` is a single DndContext prop, so the
  // switch to `pointerWithin` changes COLUMN drag too. Both releases used to
  // resolve to an id the column branch could not find → silent no-op.
  test("F17+F18: column reorder survives the collision change", async ({ page }) => {
    const ids = await setBoardLayout(page, [
      { name: "E2E Col1", changes: [A] },
      { name: "E2E Col2", changes: [B] },
      { name: "E2E Col3", changes: [C] },
    ]);
    const one = ids.get("E2E Col1")!;
    const two = ids.get("E2E Col2")!;
    const three = ids.get("E2E Col3")!;
    expect(await columnKeys(page)).toEqual([UNGROUPED, one, two, three]);

    // #F17 — release over the target column's HEADER. `pointerWithin` elects
    // `col-root:<one>` there, which is not a group id until the resolver
    // normalises it.
    const move = await beginColumnDrag(page, three);
    await move(await headerGrabPoint(page, one));
    await page.mouse.up();
    await expect.poll(() => columnKeys(page), { timeout: 15_000 }).toEqual([UNGROUPED, three, one, two]);

    // #F18 — release over one of the target column's CARDS. `pointerWithin`
    // elects the card, whose id the column branch would otherwise not find.
    const move2 = await beginColumnDrag(page, two);
    await move2(await midpointOf(cardEl(page, A)));
    await page.mouse.up();
    // `one` holds card A, so `two` lands where `one` was.
    await expect.poll(() => columnKeys(page), { timeout: 15_000 }).toEqual([UNGROUPED, three, two, one]);
  });
});

test.describe("board card drag cancellation", () => {
  // #X1 — a null `over` is a real cancel. This is why `pointerWithin` ships
  // with NO `closestCorners` fallback: with one, `over` is never null and this
  // release would commit — usually into a NEIGHBOURING column.
  test("X1: releasing outside every column changes nothing", async ({ page }) => {
    const ids = await setBoardLayout(page, [{ name: "E2E Cancel", changes: [A, B, C] }]);
    const col = ids.get("E2E Cancel")!;
    const before = await orderOf(page, col);

    const move = await beginCardDrag(page, A);
    await move(await midpointOf(cardEl(page, C)));
    // The page margin below the board columns.
    const vp = page.viewportSize()!;
    await move({ x: vp.width - 4, y: vp.height - 4 });
    await page.mouse.up();

    await page.waitForTimeout(600);
    expect(await orderOf(page, col)).toEqual(before);
    await expect(columnBody(page, col)).not.toHaveAttribute("data-drop-slot", /.*/);
    expect(await page.locator('[data-testid^="board-append-rail-"]').count()).toBe(0);
    await expect(page.getByTestId("board-drag-chip")).toBeHidden();
  });

  // #X2 — the gutter is the case a `closestCorners` fallback silently turned
  // into a move into whichever neighbour was nearest.
  test("X2: releasing in the gutter between two columns changes nothing", async ({ page }) => {
    const ids = await setBoardLayout(page, [
      { name: "E2E Left", changes: [A, B] },
      { name: "E2E Right", changes: [C] },
    ]);
    const left = ids.get("E2E Left")!;
    const right = ids.get("E2E Right")!;
    const beforeL = await orderOf(page, left);
    const beforeR = await orderOf(page, right);

    const leftBox = await boxOf(column(page, left));
    const rightBox = await boxOf(column(page, right));
    const gutterX = (leftBox.x + leftBox.width + rightBox.x) / 2;
    expect(gutterX, "columns are not separated by a gutter").toBeGreaterThan(leftBox.x + leftBox.width - 1);

    const move = await beginCardDrag(page, A);
    await move({ x: gutterX, y: leftBox.y + leftBox.height / 2 });
    await page.mouse.up();

    await page.waitForTimeout(600);
    expect(await orderOf(page, left)).toEqual(beforeL);
    expect(await orderOf(page, right)).toEqual(beforeR);
  });

  // #X3 / #X4 / #X5 — dnd-kit binds `pointercancel`, `resize`, and
  // `visibilitychange`; there is NO blur listener in core, so X5 exercises the
  // separate handler the board adds.
  for (const fault of ["pointercancel", "visibilitychange", "blur"] as const) {
    test(`X3-X5: an interrupted drag (${fault}) clears every affordance`, async ({ page }) => {
      const ids = await setBoardLayout(page, [{ name: `E2E Int ${fault}`, changes: [A, B, C] }]);
      const col = ids.get(`E2E Int ${fault}`)!;
      const before = await orderOf(page, col);

      const move = await beginCardDrag(page, A);
      const mid = await midpointOf(cardEl(page, B));
      await move({ x: mid.x, y: mid.y + 6 });
      await expect(columnBody(page, col)).toHaveAttribute("data-drop-slot", /\d/);

      await page.evaluate((kind) => {
        if (kind === "pointercancel") {
          document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
        } else if (kind === "visibilitychange") {
          Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
          // dnd-kit binds `visibilitychange` on the WINDOW (`core.cjs:1449`),
          // which is where the browser's document-dispatched event lands, so
          // the synthetic one is dispatched there directly.
          window.dispatchEvent(new Event("visibilitychange"));
        } else {
          window.dispatchEvent(new Event("blur"));
        }
      }, fault);

      // Every affordance goes away and nothing commits.
      await expect(page.getByTestId("board-drag-chip")).toBeHidden({ timeout: 10_000 });
      await expect
        .poll(async () => page.locator('[data-testid^="board-append-rail-"]').count(), { timeout: 10_000 })
        .toBe(0);
      await expect(columnBody(page, col)).not.toHaveAttribute("data-drop-slot", /.*/);
      await expect(column(page, col)).not.toHaveClass(/board-column-receded/);

      // Releasing after the interruption must still not commit.
      await page.mouse.up();
      await page.waitForTimeout(600);
      expect(await orderOf(page, col)).toEqual(before);
    });
  }

  // #X6b — the SAME-COLUMN variant of the frame race, which a colKey-only
  // guard cannot catch: the rail resolves to the last slot, so a one-frame
  // flick from the rail onto a card in the SAME column agrees on the column
  // while disagreeing on the index. Caught only because the commit re-resolves
  // from the end event instead of trusting the last `onDragMove`.
  test("X6b: a one-frame flick from the rail onto a card commits the card's slot", async ({ page }) => {
    const ids = await setBoardLayout(page, [
      { name: "E2E Flick", changes: [A, B, C] },
      { name: "E2E FlickSrc", changes: [X] },
    ]);
    const col = ids.get("E2E Flick")!;

    const move = await beginCardDrag(page, X);
    // Park on the rail so the resolved slot becomes "last".
    await move(await headerGrabPoint(page, col));
    await move(await midpointOf(rail(page, col)));
    await expect(rail(page, col)).toHaveAttribute("data-rail-active", "true");
    await expect(columnBody(page, col)).toHaveAttribute("data-drop-slot", "3");

    // One un-stepped jump above A's midpoint, then release in the same frame:
    // no intermediate `onDragMove` refreshes the slot.
    const a = await midpointOf(cardEl(page, A));
    await page.mouse.move(a.x, a.y - 6);
    await page.mouse.up();

    // Must land FIRST (the card's midpoint slot), not last (the stale rail slot).
    await expect.poll(async () => orderOf(page, col), { timeout: 15_000 }).toEqual([X, A, B, C]);
  });

  // #X6 — the commit is gated on the END event's live `over`, not on the last
  // resolved slot: `dropSlot` is only cleared by a subsequent `onDragMove`, so
  // a single-frame move into the gutter followed by a release would otherwise
  // land a stale slot.
  test("X6: a stale slot is not committed when the release lands outside", async ({ page }) => {
    const ids = await setBoardLayout(page, [{ name: "E2E Race", changes: [A, B, C, D] }]);
    const col = ids.get("E2E Race")!;
    const before = await orderOf(page, col);

    const move = await beginCardDrag(page, A);
    const mid = await midpointOf(cardEl(page, C));
    await move({ x: mid.x, y: mid.y + 6 });
    await expect(columnBody(page, col)).toHaveAttribute("data-drop-slot", /\d/);

    // One un-stepped jump out of the column, immediately followed by release —
    // no intermediate `onDragMove` inside another droppable.
    const vp = page.viewportSize()!;
    await page.mouse.move(vp.width - 4, vp.height - 4);
    await page.mouse.up();

    await page.waitForTimeout(600);
    expect(await orderOf(page, col)).toEqual(before);
  });
});
