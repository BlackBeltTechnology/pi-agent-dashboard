import { mdiDotsHorizontal } from "@mdi/js";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { gotoDashboard, pinDirectory } from "./helpers/index.js";

/**
 * Browser E2E — dragging folders into, out of, and between workspaces.
 *
 * These scenarios need REAL geometry: spring-load dwell, mid-drag droppable
 * remeasurement, and the empty-tier eject zone's computed height are all
 * things jsdom cannot express (the resolvers and the message dispatch are
 * unit-tested in `packages/client/src/lib/__tests__/sidebar-dnd.test.ts` and
 * `SessionList.folder-membership-drag.test.tsx`).
 *
 * Covers test-plan #F11, #F12, #F13, #F16, #F18, #F20, #X6.
 * See change: drag-folders-across-workspaces.
 */

// Baked fixture dirs materialized by docker/test-entrypoint.sh.
const F_A = "/fixtures/sample-git";
const F_X = "/fixtures/kb-sample";
const F_Y = "/fixtures/kb-parent";
const F_Z = "/fixtures/sample-hook-ok";
const ALL_FIXTURES = [F_A, F_X, F_Y, F_Z];

const WS_A = "E2E Drag A";
const WS_B = "E2E Drag B";

const SPRING_DWELL_MS = 600;

async function visible(loc: Locator): Promise<boolean> {
  return loc.isVisible().catch(() => false);
}

/** Map workspace NAME → generated workspace id, read off the rendered headers. */
async function workspaceIds(page: Page): Promise<Map<string, string>> {
  const ids = await page.locator('[data-testid^="workspace-header-"]').evaluateAll((nodes) =>
    nodes.map((n) => {
      const id = (n as HTMLElement).dataset.testid!.replace("workspace-header-", "");
      const name = n.querySelector(`[data-testid="workspace-name-${id}"]`)?.textContent ?? "";
      return [name.trim(), id] as const;
    }),
  );
  return new Map(ids);
}

/** The folder row (workspace-owned or pinned) whose open-home affordance is `cwd`. */
function folderRow(page: Page, cwd: string): Locator {
  return page
    .locator('[data-testid="sortable-workspace-folder"], [data-testid="sortable-pinned-group"]')
    .filter({ has: page.getByTestId(`folder-home-row-${cwd}`) })
    .first();
}

function folderHandle(page: Page, cwd: string): Locator {
  return folderRow(page, cwd).getByTestId("drag-handle-pinned").first();
}

/**
 * Every directory mutation now lives behind the folder actions menu trigger
 * (change: add-folder-actions-menu) — the header cluster is one control, so the
 * menu must be opened before add-to-workspace / remove-from-workspace are
 * reachable. Idempotent: a menu already open is left open.
 */
async function openFolderMenu(page: Page, cwd: string): Promise<void> {
  const trigger = page.getByTestId(`folder-actions-menu-${cwd}`).first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  if ((await trigger.getAttribute("aria-expanded")) === "true") return;
  await trigger.click();
  await expect(page.getByTestId(`folder-actions-menu-panel-${cwd}`).first()).toBeVisible({
    timeout: 15_000,
  });
}

async function centerOf(loc: Locator): Promise<{ x: number; y: number }> {
  const box = await loc.boundingBox();
  if (!box) throw new Error("locator has no bounding box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Moves the in-flight drag so the dragged card's CENTER lands on `target`. */
type DragCursor = (target: Locator) => Promise<void>;

/**
 * Press the folder's drag gutter and move onto `target`, WITHOUT releasing.
 * Returns a cursor to keep moving the same drag.
 *
 * `closestCenter` measures from the DRAGGED ITEM'S collision rect (its initial
 * rect translated by the pointer delta) — NOT from the pointer. Folder cards
 * are hundreds of px tall, so parking the pointer on a target leaves the card's
 * center somewhere else entirely and the drop resolves to the wrong droppable.
 * Every move therefore aims the CARD CENTER, not the cursor. dnd-kit's
 * PointerSensor also needs >5px of travel to activate, and stepped moves so
 * collision detection runs more than once.
 */
async function beginDragOnto(
  page: Page,
  cwd: string,
  target: Locator,
): Promise<DragCursor> {
  await folderHandle(page, cwd).scrollIntoViewIfNeeded();
  const from = await centerOf(folderHandle(page, cwd));
  const cardCenter = await centerOf(folderRow(page, cwd));

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });

  const vp = page.viewportSize()!;
  const moveOnto: DragCursor = async (t) => {
    const c = await centerOf(t);
    const x = from.x + (c.x - cardCenter.x);
    const y = from.y + (c.y - cardCenter.y);
    if (y < 0 || y > vp.height || x < 0 || x > vp.width) {
      throw new Error(`drag destination (${x}, ${y}) is off-screen in ${vp.width}x${vp.height}`);
    }
    await page.mouse.move(x, y, { steps: 12 });
    await page.mouse.move(x, y, { steps: 2 });
  };

  await moveOnto(target);
  return moveOnto;
}

/** Expand every workspace so its folder rows are mounted and inspectable. */
async function expandAllWorkspaces(page: Page): Promise<void> {
  for (const id of (await workspaceIds(page)).values()) {
    const toggle = page.getByTestId(`workspace-toggle-${id}`);
    if ((await toggle.getAttribute("aria-label")) === "Expand workspace") await toggle.click();
  }
}

/**
 * A drag needs BOTH ends on screen at once, and expanded folder cards (git +
 * automations + goals + openspec panels) make the sidebar very tall. Collapsing
 * the cards is not an option: the drag gutter then shrinks to just its chevron
 * button, which stops `pointerdown`, so no drag ever starts. A tall viewport
 * keeps the gutter grabbable AND every target reachable.
 */
const TALL_VIEWPORT = { width: 1400, height: 2400 };

/**
 * Normalize the shared container to a known state: every fixture pinned,
 * `WS_A` holding exactly `[F_A]` and `WS_B` holding `[F_X, F_Y, F_Z]`. Specs
 * share one container AND these specs deliberately MUTATE membership, so each
 * one re-establishes the baseline rather than assuming it.
 */
async function setupWorkspaces(page: Page): Promise<{ idA: string; idB: string }> {
  await page.setViewportSize(TALL_VIEWPORT);
  await gotoDashboard(page);
  await expandAllWorkspaces(page);

  for (const cwd of ALL_FIXTURES) {
    if (!(await visible(page.getByTestId(`folder-home-row-${cwd}`)))) {
      await pinDirectory(page, cwd);
      await expect(page.getByTestId(`folder-home-row-${cwd}`)).toBeVisible({ timeout: 15_000 });
    }
  }

  const layout = [
    [WS_A, [F_A]],
    [WS_B, [F_X, F_Y, F_Z]],
  ] as const;

  for (const [name, folders] of layout) {
    if (!(await workspaceIds(page)).has(name)) {
      // Creating from a folder's menu also assigns that folder.
      await ensureTopLevel(page, folders[0]);
      await openFolderMenu(page, folders[0]);
      await page.getByTestId(`add-to-workspace-btn-${folders[0]}`).first().click();
      await page.getByTestId("add-to-workspace-new").click();
      await page.getByTestId("new-workspace-input").fill(name);
      await page.getByTestId("new-workspace-create").click();
      await expect
        .poll(async () => (await workspaceIds(page)).has(name), { timeout: 15_000 })
        .toBe(true);
      await expandAllWorkspaces(page);
    }
  }

  const ids = await workspaceIds(page);
  const idA = ids.get(WS_A)!;
  const idB = ids.get(WS_B)!;

  for (const [name, folders] of layout) {
    const id = ids.get(name)!;
    for (const cwd of folders) {
      if ((await foldersOf(page, id)).includes(cwd)) continue;
      await ensureTopLevel(page, cwd);
      await openFolderMenu(page, cwd);
      await page.getByTestId(`add-to-workspace-btn-${cwd}`).first().click();
      await page.getByTestId(`add-to-workspace-pick-${id}`).click();
      await expect
        .poll(async () => (await foldersOf(page, id)).includes(cwd), { timeout: 15_000 })
        .toBe(true);
    }
  }

  return { idA, idB };
}

/**
 * Detach `cwd` from whatever workspace owns it so its TOP-LEVEL row (which is
 * the only one carrying the add-to-workspace menu) renders.
 */
async function ensureTopLevel(page: Page, cwd: string): Promise<void> {
  for (const id of (await workspaceIds(page)).values()) {
    if (!(await foldersOf(page, id)).includes(cwd)) continue;
    await openFolderMenu(page, cwd);
    await page.getByTestId("folder-menu-item-remove-from-workspace").first().click();
    await expect
      .poll(async () => (await foldersOf(page, id)).includes(cwd), { timeout: 15_000 })
      .toBe(false);
  }
  await openFolderMenu(page, cwd);
  await expect(page.getByTestId(`add-to-workspace-btn-${cwd}`).first()).toBeVisible({
    timeout: 15_000,
  });
  // Leave the sidebar in a neutral state for the caller: toggle the trigger.
  await page.getByTestId(`folder-actions-menu-${cwd}`).first().click();
  await expect(page.getByTestId(`folder-actions-menu-panel-${cwd}`)).toHaveCount(0);
}

/** Folder cwds currently rendered inside workspace `id`, in DOM order. */
async function foldersOf(page: Page, id: string): Promise<string[]> {
  return page
    .getByTestId(`workspace-header-${id}`)
    .locator("xpath=../..")
    .locator('[data-testid="sortable-workspace-folder"] [data-testid^="folder-home-row-"]')
    .evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLElement).dataset.testid!.replace("folder-home-row-", "")),
    );
}

async function setCollapsed(page: Page, id: string, collapsed: boolean): Promise<void> {
  const toggle = page.getByTestId(`workspace-toggle-${id}`);
  const wanted = collapsed ? "Collapse workspace" : "Expand workspace";
  if ((await toggle.getAttribute("aria-label")) !== wanted) return;
  await toggle.click();
  await expect(toggle).toHaveAttribute(
    "aria-label",
    collapsed ? "Expand workspace" : "Collapse workspace",
    { timeout: 10_000 },
  );
}

test.describe("folder membership drag", () => {
  // #F11 — dwelling on a collapsed workspace's header spring-opens it.
  test("spring-expands a collapsed workspace after the dwell", async ({ page }) => {
    const { idB } = await setupWorkspaces(page);
    await setCollapsed(page, idB, true);
    expect(await foldersOf(page, idB)).toHaveLength(0);

    const moveOnto = await beginDragOnto(page, F_A, page.getByTestId(`workspace-header-${idB}`));
    await page.waitForTimeout(SPRING_DWELL_MS + 250);
    // #F11 — B's folders are now mounted.
    expect((await foldersOf(page, idB)).length).toBeGreaterThan(0);

    // #F12 — moving onto a just-revealed folder must NOT re-collapse (the
    // open-Set is add-only for the drag; clearing it on `over` change would
    // unmount the children and start a flicker loop).
    await moveOnto(folderRow(page, F_X));
    await page.waitForTimeout(300);
    expect((await foldersOf(page, idB)).length).toBeGreaterThan(0);

    await page.mouse.up();
    // No collapse state was persisted: after the drag B renders collapsed again.
    await expect
      .poll(async () => (await foldersOf(page, idB)).length, { timeout: 10_000 })
      .toBe(0);
  });

  // #F13 — proves dnd-kit remeasured droppables mounted MID-DRAG: without
  // MeasuringStrategy.Always the drop resolves against stale rects.
  test("drops positionally into a spring-expanded workspace body", async ({ page }) => {
    const { idA, idB } = await setupWorkspaces(page);
    await setCollapsed(page, idB, true);

    const moveOnto = await beginDragOnto(page, F_A, page.getByTestId(`workspace-header-${idB}`));
    await page.waitForTimeout(SPRING_DWELL_MS + 250);

    // Drop on the slot of B's SECOND folder → the moved folder lands at index 1.
    const before = await foldersOf(page, idB);
    await moveOnto(folderRow(page, before[1]));
    await page.mouse.up();

    await setCollapsed(page, idB, false);
    await expect
      .poll(async () => (await foldersOf(page, idB)).includes(F_A), { timeout: 15_000 })
      .toBe(true);
    const after = await foldersOf(page, idB);
    expect(after.indexOf(F_A)).toBe(1);
    // Single membership: gone from A.
    expect(await foldersOf(page, idA)).not.toContain(F_A);
  });

  // #F16 — with an EMPTY pinned tier the zone is the sole eject affordance, so
  // it needs real geometry, not a zero-height hairline.
  test("renders an empty-tier eject zone with real height and a hover indicator", async ({ page }) => {
    const { idA, idB } = await setupWorkspaces(page);
    // Every fixture lives in a workspace → the pinned tier renders empty.
    const pinnedLeft = await page
      .locator('[data-testid="sortable-pinned-group"]')
      .count();
    test.skip(pinnedLeft > 0, "pinned tier not empty in this shared container");

    const zone = page.getByTestId("pinned-tier-drop-zone");
    await expect(zone).toBeHidden();

    const moveOnto = await beginDragOnto(page, F_A, page.getByTestId(`workspace-header-${idB}`));
    await expect(zone).toBeVisible({ timeout: 10_000 });
    const box = await zone.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(64);

    // Hovering it shows the standard drop indicator.
    await moveOnto(zone);
    await expect(zone).toHaveAttribute("data-over", "true", { timeout: 10_000 });

    // #F18 — eject: the row must never DISAPPEAR across the two broadcasts.
    // `pinned_dirs_updated` lands first, so the folder is pinned while the
    // stale workspace list still claims it (suppressed by visibleTopPinned) —
    // it stays rendered, then transitions when `workspaces_updated` arrives.
    // The reverse order would leave it in NEITHER list for a frame. Identity
    // is not the contract (React may move the node between tiers); PRESENCE
    // is, so the observer counts frames where no such row exists at all.
    await page.evaluate((cwd) => {
      const present = () => !!document.querySelector(`[data-testid="folder-home-row-${cwd}"]`);
      (window as any).__absent = 0;
      const obs = new MutationObserver(() => {
        if (!present()) (window as any).__absent++;
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }, F_A);

    await page.mouse.up();
    await expect
      .poll(async () => (await foldersOf(page, idA)).includes(F_A), { timeout: 15_000 })
      .toBe(false);
    await expect(page.getByTestId(`folder-home-row-${F_A}`)).toBeVisible();
    expect(await page.evaluate(() => (window as any).__absent)).toBe(0);
  });

  // #F20 — closestCenter flips its resolved target at Voronoi cell boundaries;
  // jitter WITHIN one workspace must not re-arm the dwell timer.
  test("jitter between a header and its own folder does not reset the dwell", async ({ page }) => {
    const { idB } = await setupWorkspaces(page);
    await setCollapsed(page, idB, false);
    const header = page.getByTestId(`workspace-header-${idB}`);
    await setCollapsed(page, idB, true);

    const moveOnto = await beginDragOnto(page, F_A, header);
    // Oscillate around the header for the full dwell: `closestCenter` flips
    // its resolved target at Voronoi cell boundaries, so the timer must be
    // keyed on the WORKSPACE, not the raw `over.id`.
    const deadline = Date.now() + SPRING_DWELL_MS;
    while (Date.now() < deadline) {
      await moveOnto(header);
    }
    await page.waitForTimeout(400);
    expect((await foldersOf(page, idB)).length).toBeGreaterThan(0);
    await page.mouse.up();
  });

  // #X6 — no optimistic client state: every client converges off the same
  // broadcasts, so a second tab reflects the move without a reload.
  test("a second client converges on the move without reloading", async ({ page, context }) => {
    const { idA, idB } = await setupWorkspaces(page);
    await setCollapsed(page, idA, false);
    await setCollapsed(page, idB, false);
    const moved = (await foldersOf(page, idB))[0];

    const second = await context.newPage();
    await second.setViewportSize(TALL_VIEWPORT);
    await gotoDashboard(second);
    await expect
      .poll(async () => (await foldersOf(second, idB)).includes(moved), { timeout: 20_000 })
      .toBe(true);

    await beginDragOnto(page, moved, page.getByTestId(`workspace-header-${idA}`));
    await page.mouse.up();

    await expect
      .poll(async () => (await foldersOf(page, idA)).includes(moved), { timeout: 15_000 })
      .toBe(true);
    // The second tab never reloaded.
    await expect
      .poll(async () => (await foldersOf(second, idA)).includes(moved), { timeout: 20_000 })
      .toBe(true);
    expect(await foldersOf(second, idB)).not.toContain(moved);
    await second.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// add-folder-actions-menu — glyph uniqueness on the RENDERED card, the session
// card losing its add-to-workspace affordance, and the menu surviving the two
// state changes that can yank its anchor out from under it.
// Covers test-plan F9, F10, X5, X6.
// ─────────────────────────────────────────────────────────────────────────────
test.describe("folder actions menu — anchor stability and glyph uniqueness", () => {
  /** Every `d` attribute the trigger's glyph renders. */
  async function glyphPaths(loc: Locator): Promise<string[]> {
    return loc.locator("svg path").evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("d") ?? ""),
    );
  }

  /**
   * Harness-emitted console noise that has nothing to do with the interaction
   * under test. The container serves the SW registration path as `text/html`,
   * so Chrome logs this on every page load. Filtering it keeps the X5/X6
   * "no console error" assertion about the menu instead of about the fixture.
   */
  const HARNESS_NOISE = [/unsupported MIME type/i];

  /**
   * Start collecting console/page errors. Call AFTER setup so only errors the
   * interaction under test provokes are captured.
   */
  function collectErrors(page: Page): () => string[] {
    const errors: string[] = [];
    const push = (text: string) => {
      if (HARNESS_NOISE.some((re) => re.test(text))) return;
      errors.push(text);
    };
    page.on("console", (m) => { if (m.type() === "error") push(m.text()); });
    page.on("pageerror", (e) => push(e.message));
    return () => errors;
  }

  // F9 — the folder trigger must not reuse the worktree actions menu's glyph:
  // a worktree session card renders INSIDE the folder body, so two identical
  // triggers would share one card with different scopes.
  test("F9: the folder trigger's glyph is not the worktree menu's glyph", async ({ page }) => {
    await setupWorkspaces(page);
    const trigger = page.getByTestId(`folder-actions-menu-${F_A}`).first();
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    const paths = await glyphPaths(trigger);
    expect(paths.length).toBeGreaterThanOrEqual(1);
    // `mdiDotsHorizontal` is what WorktreeActionsMenu renders as its trigger.
    expect(paths).not.toContain(mdiDotsHorizontal);
  });

  // F10 — workspace membership is directory-scoped, so the affordance left the
  // session card entirely (it rendered N identical buttons with one effect).
  test("F10: no session card carries an add-to-workspace control", async ({ page }) => {
    await setupWorkspaces(page);
    await expect(page.locator('[data-testid^="session-card-add-to-workspace-"]')).toHaveCount(0);

    await page.setViewportSize({ width: 375, height: 900 });
    await gotoDashboard(page);
    await expect(page.locator('[data-testid^="session-card-add-to-workspace-"]')).toHaveCount(0);
  });

  // X5 — the header row renders in both collapse states, so the trigger keeps
  // its anchor; the invariant is that no popover is left floating without one.
  test("X5: collapsing the folder while its menu is open leaves no orphaned popover", async ({ page }) => {
    await setupWorkspaces(page);
    const errors = collectErrors(page);
    await openFolderMenu(page, F_A);
    const panel = page.getByTestId(`folder-actions-menu-panel-${F_A}`);
    await expect(panel).toBeVisible();

    await folderRow(page, F_A).getByTestId("folder-toggle-btn").first().click();

    // Either it closed cleanly, or it is still anchored to a rendered trigger.
    if ((await panel.count()) > 0) {
      await expect(panel).toBeVisible();
      await expect(page.getByTestId(`folder-actions-menu-${F_A}`).first()).toBeVisible();
    }
    expect(errors()).toEqual([]);
  });

  // X6 — a drag-reorder moves the row's DOM node; the popover must not be left
  // painted at the old position.
  test("X6: drag-reordering the folder while its menu is open leaves no orphaned popover", async ({ page }) => {
    // Target the OTHER workspace: F_A already lives in idA, so aiming at idA's
    // own header resolves above the row and `beginDragOnto` rejects the move as
    // off-screen. idB is a real relocation, the same move the sibling cases use.
    const { idB } = await setupWorkspaces(page);
    const errors = collectErrors(page);
    await openFolderMenu(page, F_A);
    const panel = page.getByTestId(`folder-actions-menu-panel-${F_A}`);
    await expect(panel).toBeVisible();
    const before = (await panel.boundingBox())!;

    await beginDragOnto(page, F_A, page.getByTestId(`workspace-header-${idB}`));
    await page.mouse.up();

    // Exactly zero or one panel — never a second, stranded copy.
    expect(await panel.count()).toBeLessThanOrEqual(1);
    if ((await panel.count()) === 1) {
      // Still anchored: it tracks its trigger rather than the old coordinates.
      const trigger = page.getByTestId(`folder-actions-menu-${F_A}`).first();
      await expect(trigger).toBeVisible();
      const after = (await panel.boundingBox())!;
      const triggerBox = (await trigger.boundingBox())!;
      expect(Math.abs(after.y - (triggerBox.y + triggerBox.height))).toBeLessThan(
        Math.abs(before.y - after.y) + 60,
      );
    }
    expect(errors()).toEqual([]);
  });
});
