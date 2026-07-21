import { expect, type Locator, type Page, test } from "@playwright/test";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — popovers nested in an offset `overflow` pane must not clip
 * against the pane edge (change: fix-popover-container-clip).
 *
 * The chat lives in the `split-chat-pane` (`flex min-h-0 min-w-0 flex-col
 * overflow-hidden`), horizontally OFFSET from the viewport by the sidebar and,
 * when the editor split is open, NARROW. `usePopoverFlip` now measures against
 * that pane (via `PopoverBoundaryContext`) instead of the viewport, so a
 * `right-0` popover (ChatViewMenu) no longer has its label column guillotined
 * on the left, and a `left-0` dropdown (ModelSelector / ThinkingLevelSelector)
 * no longer overflows the pane's right edge.
 *
 * These are the ONLY layers that reproduce the real-DOM geometry: the flip
 * decision depends on the live pane rect, unavailable in jsdom.
 *
 * Invariant asserted per scenario: the open popover's horizontal bounds fall
 * within the chat pane's horizontal bounds (1px rounding slack) — i.e. no
 * container clip on either edge.
 */

const SLACK = 1;

/** Assert `popover`'s horizontal bounds ⊆ `pane`'s horizontal bounds. */
async function expectWithinPaneX(popover: Locator, pane: Locator): Promise<void> {
  const p = await popover.boundingBox();
  const c = await pane.boundingBox();
  expect(p, "popover has a box").not.toBeNull();
  expect(c, "pane has a box").not.toBeNull();
  expect(p!.x, "popover.left ≥ pane.left").toBeGreaterThanOrEqual(c!.x - SLACK);
  expect(
    p!.x + p!.width,
    "popover.right ≤ pane.right",
  ).toBeLessThanOrEqual(c!.x + c!.width + SLACK);
}

/**
 * Dismiss any leaked modal overlay (specs share one container; a prior spec can
 * leave e.g. a `propose-dialog-overlay` that intercepts pointer events). Press
 * Escape until no known overlay is visible.
 */
async function dismissOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const overlay = page.getByTestId("propose-dialog-overlay");
    if (!(await overlay.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
}

/** Open the editor split from the desktop restore tab → narrows the chat pane. */
async function openSplit(page: Page): Promise<void> {
  const peek = page.getByTestId("editor-peek");
  if (await peek.isVisible().catch(() => false)) {
    await peek.click();
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 15_000 });
  }
}

/** Drag the split divider hard-left so the chat pane is as narrow as allowed. */
async function narrowChatPane(page: Page): Promise<void> {
  const divider = page.getByTestId("split-divider");
  if (!(await divider.isVisible().catch(() => false))) return;
  const box = await divider.boundingBox();
  const pane = await page.getByTestId("split-chat-pane").boundingBox();
  if (!box || !pane) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Drag toward the pane's left edge (leave a small min width).
  await page.mouse.move(pane.x + 220, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

test.describe("popover container clip", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("F5 ChatViewMenu — no left-clip in the offset chat pane", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 30_000 });
    await dismissOverlays(page);
    const pane = page.getByTestId("split-chat-pane");
    await expect(pane).toBeVisible({ timeout: 15_000 });

    await page.getByTitle("View options").first().click();
    const popover = page.getByTestId("chat-view-popover");
    await expect(popover).toBeVisible();
    // The proven bug: labels sliced off the LEFT by the pane's overflow-hidden.
    await expectWithinPaneX(popover, pane);
    // A representative row label is fully rendered (proves no left truncation).
    await expect(popover.getByText("Turn metadata", { exact: false })).toBeVisible();
  });

  test("F6 ModelSelector — left-preserved when it fits, flips within pane when narrow", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 30_000 });
    await dismissOverlays(page);
    const pane = page.getByTestId("split-chat-pane");

    const modelBtn = page.getByTestId("model-selector-button");
    // (a) Fits: wide/closed pane → stays left-0, within the pane.
    if (await modelBtn.isEnabled().catch(() => false)) {
      await modelBtn.click();
      const dd = page.getByTestId("model-dropdown");
      await expect(dd).toBeVisible();
      await expectWithinPaneX(dd, pane);
      await modelBtn.click(); // close

      // (b) Narrow: open the split + drag the divider left so the left-anchor
      // cannot fit; the dropdown must flip/clamp and stay within the pane.
      await openSplit(page);
      await narrowChatPane(page);
      await modelBtn.click();
      await expect(dd).toBeVisible();
      await expectWithinPaneX(dd, pane);
    }
  });

  test("F7 no behaviour change when it fits (regression)", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 30_000 });
    await dismissOverlays(page);
    const pane = page.getByTestId("split-chat-pane");

    // Full-width single-column (closed): both popovers sit within the pane and
    // the model dropdown keeps its natural ~320px width (left-anchored).
    await page.getByTitle("View options").first().click();
    const view = page.getByTestId("chat-view-popover");
    await expect(view).toBeVisible();
    await expectWithinPaneX(view, pane);
    await page.getByTitle("View options").first().click();

    const modelBtn = page.getByTestId("model-selector-button");
    if (await modelBtn.isEnabled().catch(() => false)) {
      await modelBtn.click();
      const dd = page.getByTestId("model-dropdown");
      await expect(dd).toBeVisible();
      await expectWithinPaneX(dd, pane);
      const box = await dd.boundingBox();
      // Natural width preserved when it fits (≈320px, allow rounding).
      expect(box!.width).toBeGreaterThanOrEqual(300);
    }
  });

  test("F8 ThinkingLevelSelector — no clip in the (narrow) pane", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 30_000 });
    await dismissOverlays(page);
    const pane = page.getByTestId("split-chat-pane");
    await openSplit(page);
    await narrowChatPane(page);

    // Thinking chip folds into the ⋯ overflow when the composer is narrow.
    const overflow = page.getByTestId("overflow-button");
    if (await overflow.isVisible().catch(() => false)) {
      await overflow.click();
      await expect(page.getByTestId("overflow-menu")).toBeVisible();
    }
    const thinkBtn = page.getByTestId("thinking-level-selector").getByRole("button").first();
    if (await thinkBtn.isVisible().catch(() => false)) {
      await thinkBtn.click();
      const dd = page.getByTestId("thinking-level-dropdown");
      await expect(dd).toBeVisible();
      await expectWithinPaneX(dd, pane);
    }
  });

  test("F11 CommandInput attach + overflow menus stay within the composer pane", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 30_000 });
    await dismissOverlays(page);
    const pane = page.getByTestId("split-chat-pane");
    await openSplit(page);
    await narrowChatPane(page);

    const attachBtn = page.getByTestId("attach-button");
    await attachBtn.click();
    const attachMenu = page.getByTestId("attach-menu");
    await expect(attachMenu).toBeVisible();
    await expectWithinPaneX(attachMenu, pane);
    await attachBtn.click();

    const overflow = page.getByTestId("overflow-button");
    if (await overflow.isVisible().catch(() => false)) {
      await overflow.click();
      const menu = page.getByTestId("overflow-menu");
      await expect(menu).toBeVisible();
      await expectWithinPaneX(menu, pane);
    }
  });

  test("F12 CommandInput slash dropdown — dual-edge immunity within the composer", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    const composer = page.getByPlaceholder(/message/i).first();
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await dismissOverlays(page);
    const pane = page.getByTestId("split-chat-pane");
    await openSplit(page);
    await narrowChatPane(page);

    await composer.click();
    await composer.fill("/");
    const dd = page.getByTestId("command-dropdown");
    await expect(dd).toBeVisible({ timeout: 10_000 });
    // `left-3 right-3` pins both composer edges → always within the pane.
    await expectWithinPaneX(dd, pane);
    await composer.fill("");
  });
});
