/**
 * Shared setup + drag primitives for the OpenSpec board drop-targeting specs.
 *
 * The board state (groups, assignments, per-group order) is established through
 * the REST API from inside the page rather than by dragging: the specs under
 * test ARE the drag path, so using drags to arrange the fixture would make a
 * failure impossible to localise.
 *
 * See change: fix-openspec-board-drop-targeting.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { gotoDashboard, pinDirectory } from "./index.js";

/** Fixture OpenSpec project; 64 `board-card-NN` changes generated at boot. */
export const BOARD_FIXTURE = "/fixtures/openspec-board";
export const BOARD_URL = `/folder/${Buffer.from(BOARD_FIXTURE).toString("base64url")}/openspec`;
export const UNGROUPED = "__ungrouped__";

/** `board-card-01` … — the generated fixture change names. */
export const card = (n: number) => `board-card-${String(n).padStart(2, "0")}`;

export function column(page: Page, colKey: string): Locator {
  return page.getByTestId(`board-column-${colKey}`);
}
export function columnBody(page: Page, colKey: string): Locator {
  return page.getByTestId(`board-column-body-${colKey}`);
}
export function columnHead(page: Page, colKey: string): Locator {
  return page.getByTestId(`board-column-head-${colKey}`);
}
export function rail(page: Page, colKey: string): Locator {
  return page.getByTestId(`board-append-rail-${colKey}`);
}
export function cardEl(page: Page, name: string): Locator {
  return page.getByTestId(`board-card-${name}`);
}

/** Pin the fixture and land on its board with the cards hydrated. */
export async function openBoard(page: Page, minCards = 1): Promise<void> {
  await gotoDashboard(page);
  const row = page.getByTestId(`folder-open-home-${BOARD_FIXTURE}`);
  // The sidebar hydrates over the websocket, so "not visible yet" is not the
  // same as "not pinned" — poll before deciding to pin, or a slow first paint
  // sends every spec down the onboarding path.
  const alreadyPinned = await row
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!alreadyPinned) await pinDirectory(page, BOARD_FIXTURE);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await page.goto(BOARD_URL);
  await page.getByTestId("openspec-board").waitFor({ state: "visible", timeout: 30_000 });
  // The board's changes arrive from the server's openspec poll, which on a
  // busy shared container can lag well past a default expect timeout.
  await expect
    .poll(async () => page.locator('[data-testid^="board-card-board-card-"]').count(), { timeout: 90_000 })
    .toBeGreaterThanOrEqual(minCards);
}

type Layout = Array<{ name: string; changes: string[] }>;

/**
 * Reset the board to `layout` (group name → ordered change names) plus an
 * `ungrouped` remainder, via REST. Returns group name → generated id.
 *
 * Each spec re-establishes its own layout: the specs MUTATE assignments and
 * order, and they share one container.
 */
export async function setBoardLayout(
  page: Page,
  layout: Layout,
  ungrouped: string[] = [],
): Promise<Map<string, string>> {
  const ids = await page.evaluate(
    async ([cwd, layoutJson, ungroupedJson]) => {
      const url = (suffix = "") =>
        `/api/openspec/groups${suffix}?cwd=${encodeURIComponent(cwd as string)}`;
      const json = async (res: Response) => {
        const body = await res.json();
        if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body.data;
      };
      const wanted = JSON.parse(layoutJson as string) as Array<{ name: string; changes: string[] }>;
      const loose = JSON.parse(ungroupedJson as string) as string[];

      // Clean slate: assignments live in the same file as the groups, so
      // deleting every group also drops every assignment into Ungrouped.
      const existing = await json(await fetch(url()));
      for (const g of existing.groups ?? []) {
        await fetch(url(`/${encodeURIComponent(g.id)}`), { method: "DELETE" });
      }

      const out: Array<[string, string]> = [];
      for (const { name, changes } of wanted) {
        const g = await json(
          await fetch(url(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, color: "blue" }),
          }),
        );
        out.push([name, g.id]);
        for (const changeName of changes) {
          await fetch(url("/assignments"), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ changeName, groupId: g.id }),
          });
        }
        await fetch(url("/change-order"), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId: g.id, order: changes }),
        });
      }
      if (loose.length > 0) {
        await fetch(url("/change-order"), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId: "__ungrouped__", order: loose }),
        });
      }
      return out;
    },
    [BOARD_FIXTURE, JSON.stringify(layout), JSON.stringify(ungrouped)] as const,
  );
  await page.reload();
  await page.getByTestId("openspec-board").waitFor({ state: "visible", timeout: 30_000 });
  const map = new Map(ids);
  // The reload must show the new columns before a spec starts dragging.
  for (const id of map.values()) {
    await expect(column(page, id)).toBeVisible({ timeout: 20_000 });
  }
  return map;
}

/**
 * Type into the board's text filter, shrinking what every column renders.
 *
 * Needed by the narrow-viewport specs: at ≤900px the columns STACK, and the
 * always-first Ungrouped column holds every fixture change not placed in a
 * group — which would push the columns under test kilopixels down the page.
 */
export async function filterBoard(page: Page, text: string): Promise<void> {
  await page.getByTestId("board-filter-text").fill(text);
  await expect
    .poll(async () => page.locator('[data-testid^="board-card-board-card-"]').count(), { timeout: 15_000 })
    .toBeLessThan(20);
}

/** Change names rendered in `colKey`, in DOM order. */
export async function orderOf(page: Page, colKey: string): Promise<string[]> {
  return columnBody(page, colKey)
    .locator('[data-testid^="board-card-board-card-"]')
    .evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLElement).dataset.testid!.replace("board-card-", "")),
    );
}

/** The persisted groups file, read straight from the API. */
export async function persisted(page: Page): Promise<{
  groups: Array<{ id: string; name: string }>;
  assignments: Record<string, string>;
  changeOrder?: Record<string, string[]>;
}> {
  return page.evaluate(async (cwd) => {
    const res = await fetch(`/api/openspec/groups?cwd=${encodeURIComponent(cwd)}`);
    return (await res.json()).data;
  }, BOARD_FIXTURE);
}

export type Point = { x: number; y: number };

export async function boxOf(loc: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await loc.boundingBox();
  if (!box) throw new Error("locator has no bounding box");
  return box;
}

/** Vertical midpoint of a card, in viewport coordinates. */
export async function midpointOf(loc: Locator): Promise<Point> {
  const b = await boxOf(loc);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * Press a card and start dragging it, WITHOUT releasing. Returns a cursor.
 *
 * `pointerWithin` resolves the droppable containing the POINTER, and the drop
 * slot is resolved from the pointer's Y — so unlike the sidebar's
 * `closestCenter` drags, aiming the cursor at the target is exactly right.
 * dnd-kit's PointerSensor needs >8px of travel to activate.
 */
export async function beginCardDrag(
  page: Page,
  name: string,
): Promise<(p: Point, steps?: number) => Promise<void>> {
  const handle = cardEl(page, name);
  await handle.scrollIntoViewIfNeeded();
  const b = await boxOf(handle);
  // Grab near the card's top edge: the lower part of a card hosts the stepper
  // and action buttons, which stop `pointerdown`.
  const from = { x: b.x + b.width / 2, y: b.y + 8 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 12, { steps: 4 });

  const moveTo = async (p: Point, steps = 8) => {
    await page.mouse.move(p.x, p.y, { steps });
    // A second, shorter move guarantees another `onDragMove` at the final
    // position even when the first one landed mid-interpolation.
    await page.mouse.move(p.x, p.y, { steps: 2 });
  };
  return moveTo;
}

/**
 * A grabbable point on a column header, scrolled into view first.
 *
 * The board scrolls HORIZONTALLY, so a column's header midpoint is routinely
 * outside the viewport and `page.mouse.move` there silently does nothing. The
 * point also sits over the group NAME (left side), not the header centre: the
 * right side carries the new-proposal / manage buttons.
 */
export async function headerGrabPoint(page: Page, colKey: string): Promise<Point> {
  const head = columnHead(page, colKey);
  await head.scrollIntoViewIfNeeded();
  const b = await boxOf(head);
  const vp = page.viewportSize()!;
  const x = Math.max(2, Math.min(b.x + Math.min(60, b.width / 2), vp.width - 4));
  return { x, y: b.y + b.height / 2 };
}

/**
 * Press a column header and drag it onto `to`, WITHOUT releasing. Returns a
 * cursor, mirroring {@link beginCardDrag}.
 */
export async function beginColumnDrag(
  page: Page,
  colKey: string,
): Promise<(p: Point, steps?: number) => Promise<void>> {
  const from = await headerGrabPoint(page, colKey);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 12, from.y, { steps: 4 });
  return async (p: Point, steps = 10) => {
    await page.mouse.move(p.x, p.y, { steps });
    await page.mouse.move(p.x, p.y, { steps: 2 });
  };
}

/** Column keys in rendered order. */
export async function columnKeys(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="board-column-body-"]')
    .evaluateAll((n) =>
      n.map((e) => (e as HTMLElement).dataset.testid!.replace("board-column-body-", "")),
    );
}

/** Read the slot the board currently resolves for `colKey`, or null. */
export async function resolvedSlot(page: Page, colKey: string): Promise<string | null> {
  return columnBody(page, colKey).getAttribute("data-drop-slot");
}
