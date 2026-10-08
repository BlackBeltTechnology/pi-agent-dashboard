import { expect, test } from "./fixtures.js";
import {
  dragChatPaneTo,
  gridCards,
  gridContainerOf,
  gridOf,
  openIdleGrid,
} from "./helpers/flow-card-grid.js";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — consolidate-flow-agent-cards, card-grid geometry (test-plan
 * #F1–#F6, #F10, #F12, #F14, #X1).
 *
 * Sibling of `flow-attach-before-run.spec.ts` (its harness glue: a fresh git
 * session, the flow slot, the real engine run), split out per test-plan "New
 * infra" so neither spec breaches the size rule.
 *
 * Two fixtures:
 *  - `openIdleGrid()` (helpers/flow-card-grid.ts) attaches a 6-step e2e fixture
 *    flow through the SAME localStorage attachment the app writes, so the panel
 *    renders PENDING cards — enough for grid geometry, the compact tile, the
 *    file controls and the editor route.
 *  - `runSyntheticToSummary()` drives the baked `e2e:synthetic` flow to
 *    completion (the frozen post-flow grid) for #F2.
 *
 * Rows #F3 (code card with 6 log lines) and #F4 (typed outputs + soft-failure
 * banner) need LIVE code-step state the harness does not produce; they are
 * declared `fixme` with the missing fixture named rather than asserted against a
 * state the container cannot reach.
 */

/** A row's cards, measured as boxes. Rows are derived from card y positions. */
async function rows(panel: import("@playwright/test").Locator) {
  const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const c of await gridCards(panel).all()) {
    const b = await c.boundingBox();
    if (b) boxes.push(b);
  }
  const byRow = new Map<number, typeof boxes>();
  for (const b of boxes) {
    const key = Math.round(b.y / 4) * 4;
    const arr = byRow.get(key);
    if (arr) arr.push(b);
    else byRow.set(key, [b]);
  }
  return [...byRow.values()];
}

/** A card's control row sits at the card's content bottom (inside the shell's `p-2.5`). */
async function expectControlRowAtCardBottom(card: import("@playwright/test").Locator) {
  const details = card.getByRole("button", { name: /details/i });
  if ((await details.count()) === 0) return;
  const cardBox = await card.boundingBox();
  const ctrlBox = await details.boundingBox();
  if (!cardBox || !ctrlBox) return;
  const gap = cardBox.y + cardBox.height - (ctrlBox.y + ctrlBox.height);
  // Shell padding is 10px (p-2.5): bottom-aligned means the control row sits at
  // the content bottom, i.e. within padding + 1px slack.
  expect(gap, "control row bottom vs card bottom").toBeLessThanOrEqual(12);
}

/** Drive the baked `e2e:synthetic` flow to completion (frozen summary grid). */
async function runSyntheticToSummary(page: import("@playwright/test").Page) {
  const card = await spawnFreshGitSession(page);
  await card.click();
  const open = card.getByTestId("flows-open-button");
  await expect(open).toBeVisible({ timeout: 60_000 });
  await expect(open).toBeEnabled();
  await open.click();
  const search = page.getByPlaceholder("Search flows...");
  await search.waitFor({ state: "visible", timeout: 15_000 });
  await search.fill("synthetic");
  await page.getByText("synthetic", { exact: false }).first().click();
  const panel = page.getByTestId("flow-dashboard");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.getByTestId("flow-idle-run").click();
  await byTestId(page, "flowLaunchRun").click();
  await expect(page.getByTestId("flow-summary-scrollbox")).toBeVisible({ timeout: 120_000 });
  return page.getByTestId("flow-summary-scrollbox");
}

test.describe("flow card grid geometry (L3)", () => {
  test("#F1: row-mates share one height, control rows bottom-aligned, single-card row >= 124px", async ({ page }) => {
    const { panel } = await openIdleGrid(page);
    await expect(gridCards(panel).first()).toBeVisible();

    const measured = await rows(panel);
    expect(measured.length, "grid renders 3 rows of 2 at desktop width").toBeGreaterThanOrEqual(2);

    for (const row of measured) {
      if (row.length < 2) continue;
      const [a, b] = row;
      // Equal height within 1px — the `[&>*]:h-full` coupling.
      expect(Math.abs(a.height - b.height), `row heights ${a.height} vs ${b.height}`).toBeLessThanOrEqual(1);
      // No card shorter than its row: they share the row box.
      expect(a.y).toBeCloseTo(b.y, 0);
    }

    // A single-card row keeps the 124px floor.
    const single = measured.find((r) => r.length === 1);
    if (single) expect(single[0].height).toBeGreaterThanOrEqual(124);

    // Each control row sits at the card bottom (inside the shell's p-2.5).
    for (const c of await gridCards(panel).all()) await expectControlRowAtCardBottom(c);
  });

  test("#F2: frozen summary grid keeps row-mates equal and bottom-aligned", async ({ page }) => {
    const scrollbox = await runSyntheticToSummary(page);
    const grid = scrollbox.locator("[data-step]").first().locator("xpath=..");
    const frozen = grid.locator("[data-step]");
    await expect(frozen.first()).toBeVisible();

    const first = await frozen.nth(0).boundingBox();
    const second = await frozen.nth(1).boundingBox();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(Math.abs(first!.height - second!.height)).toBeLessThanOrEqual(1);
  });

  test.fixme(
    "#F3: a code card with 6 log lines grows the row without breaking row equality — needs a live code-step fixture emitting 6 flow_assistant_text lines (see the change report)",
    async () => {},
  );

  test.fixme(
    "#F4: a card with typed outputs + a soft-failure banner grows the row while the row stays equal — needs a live flow fixture with typedOutputs and outcome=soft (see the change report)",
    async () => {},
  );

  test("#F5: below 480px of PANE width the grid is one compact column with basename/body gone", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { panel } = await openIdleGrid(page);
    // Open the split editor, then drag the divider until the grid wrapper is
    // ~243px wide (the reported failure case).
    await page.getByTestId("layout-mode-split").click();
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 15_000 });

    await dragChatPaneTo(page, 243);

    const wrapper = gridContainerOf(panel);
    const w = await wrapper.evaluate((el) => el.clientWidth);
    expect(w, "grid wrapper is below the 480px container-query threshold").toBeLessThan(480);

    expect(await gridCards(panel).count()).toBe(6);

    // One column (test-plan #F5): six rows of exactly one card each, and each
    // card fills the grid's own content width — the compact `grid-cols-1`
    // treatment, not a re-flowed multi-column grid.
    const measured = await rows(panel);
    expect(measured.length, "one row per card in a single column").toBe(6);
    for (const row of measured) expect(row.length, "one card per row").toBe(1);
    const gridWidth = await gridOf(panel).evaluate((el) => el.clientWidth);
    for (const card of await gridCards(panel).all()) {
      const box = await card.boundingBox();
      expect(box, "card box").not.toBeNull();
      expect(Math.abs(box!.width - gridWidth), "card fills the single column").toBeLessThanOrEqual(1);
    }

    // Basename and body lines are not rendered on compact tiles.
    await expect(panel.getByTestId("flow-card-basename").first()).toBeHidden();
    await expect(panel.getByTestId("flow-card-body").first()).toBeHidden();
  });

  test("#F6: the threshold keys off pane width, not the viewport (wide pane keeps full cards)", async ({ page }) => {
    // Open the panel from the desktop shell (the session list is desktop-only),
    // THEN drop to the 700px viewport the threshold claim is measured at: the
    // container query must answer to this pane, not to the viewport it is
    // reached through.
    await page.setViewportSize({ width: 1440, height: 900 });
    const { panel } = await openIdleGrid(page);
    await page.setViewportSize({ width: 700, height: 900 });
    // At a sub-md viewport the shell collapses the flow slot to its mobile bar;
    // the user's tap expands it, and the grid under test is the expanded
    // panel's — the viewport is still the 700px one.
    await page.getByText("tap to expand").click();
    await expect(panel).toHaveAttribute("data-flow-mode", "idle", { timeout: 15_000 });
    const w = await gridContainerOf(panel).evaluate((el) => el.clientWidth);
    expect(w).toBeGreaterThanOrEqual(480);
    // Full cards: basename + body present.
    await expect(panel.getByTestId("flow-card-basename").first()).toBeVisible();
    await expect(panel.getByTestId("flow-card-body").first()).toBeVisible();
  });

  test("#F12: a compact code tile keeps status, name, stats and controls", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { panel } = await openIdleGrid(page);
    await dragChatPaneTo(page, 243);

    const bare = panel.locator("[data-step='bare']");
    await expect(bare).toBeVisible();
    // The `bare` code card has neither codeTarget nor sourcePath and no logs.
    await expect(bare.getByTestId("flow-card-basename")).toBeHidden();
    await expect(bare.getByTestId("flow-card-body")).toBeHidden();
    const box = await bare.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(76);
    // Status icon / name / stats / control row survive.
    await expect(bare.getByText("bare")).toBeVisible();
    await expect(bare.getByRole("button", { name: /details/i })).toBeVisible();
  });

  test("#F10 / #X1: a real click on a card handler opens the host editor; an unreadable path fails there", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { panel, card, sid } = await openIdleGrid(page);
    await page.getByTestId("layout-mode-split").click();
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 15_000 });

    const handlerA = panel.locator("[data-step='load-ticket']").getByTitle("Open handler in editor");
    await expect(handlerA).toBeVisible();
    // Real pointer at the control's centre (never element.click()).
    const aBox = await handlerA.boundingBox();
    await page.mouse.click(aBox!.x + aBox!.width / 2, aBox!.y + aBox!.height / 2);
    await expect(page).toHaveURL(new RegExp(`/session/${sid}/editor\\?file=`));

    // A second card's handler still receives a real click (the reported bug:
    // the first open made the second card's control dead).
    const handlerB = panel.locator("[data-step='check-form']").getByTitle("Open handler in editor");
    await expect(handlerB).toBeVisible();
    const bBox = await handlerB.boundingBox();
    await page.mouse.click(bBox!.x + bBox!.width / 2, bBox!.y + bBox!.height / 2);
    await expect(page).toHaveURL(/check-form\.ts/);
    // Both editor tabs are open; the active one is B's basename.
    await expect(page.getByTestId("editor-tab").filter({ hasText: "check-form.ts" })).toBeVisible();

    // #X1: an unreadable handler path is the editor pane's failure, not the card's.
    const handlerBad = panel.locator("[data-step='transcribe']").getByTitle("Open handler in editor");
    const badBox = await handlerBad.boundingBox();
    await page.mouse.click(badBox!.x + badBox!.width / 2, badBox!.y + badBox!.height / 2);
    await expect(page).toHaveURL(/transcribe\.ts/);
    await expect(card.getByText(/error|failed|not found/i)).toHaveCount(0);
  });

  test("#F14: closing the pane with its X does not block the same card button re-opening the file", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { panel, sid } = await openIdleGrid(page);

    const openHandler = async () => {
      const button = panel.locator("[data-step='load-ticket']").getByTitle("Open handler in editor");
      await expect(button).toBeVisible();
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    };

    await openHandler();
    await expect(page).toHaveURL(new RegExp(`/session/${sid}/editor\\?file=`));
    const pane = page.getByTestId("split-editor-pane");
    await expect(pane).toBeVisible({ timeout: 15_000 });
    await expect(pane.getByTestId("editor-tab").filter({ hasText: "load-ticket.ts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Close with the pane's own X. The route keeps naming the file — the bug's
    // premise — so the second click navigates to an IDENTICAL URL; the fresh
    // open intent (design D8) is what brings the target back.
    await pane.getByTitle("Close editor").click();
    await expect(page.getByTestId("split-editor-pane")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/session/${sid}/editor\\?file=`));

    await openHandler();
    const reopened = page.getByTestId("split-editor-pane");
    await expect(reopened).toBeVisible({ timeout: 15_000 });
    await expect(reopened.getByTestId("editor-tab").filter({ hasText: "load-ticket.ts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
