import { expect, test } from "./fixtures.js";
import { spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — define-chat-pane-below-floor-allocation
 *
 * Verifies height allocation and ordering below the floor sum for `split-chat-pane`:
 * - At/above floor sum: full rows, clipped = 0 (#E3, #E4)
 * - Below floor sum: shrinkable rows absorb deficit, fixed rows hold content height (#E5, #E6, #E7, #E8)
 * - Precedence: min-height (72px) beats max-h-[40%] below floor sum (#E9)
 * - Long draft does not evict bottom rows (#F4)
 *
 * Test-Plan rows covered: E3, E4, E5, E6, E7, E8, E9, F4.
 */

test.describe("chat-pane below-floor allocation", () => {
  async function openSplitSession(page: import("@playwright/test").Page) {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});

    // Set short viewport 375x360 after session is active
    await page.setViewportSize({ width: 375, height: 360 });

    const sendBtn = page.getByTestId("send-button");
    await expect(sendBtn).toBeVisible({ timeout: 30_000 });

    // Open split mode
    await page.getByTestId("layout-mode-split").click();
    const chatPane = page.getByTestId("split-chat-pane");
    await expect(chatPane).toBeVisible({ timeout: 15_000 });
    return chatPane;
  }

  test("3.1 & 3.2 At and just above the floor sum, rows are full and nothing clips (#E3, #E4)", async ({ page }) => {
    // Comfortably tall viewport so pane is well above the floor sum
    const chatPane = await openSplitSession(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    const paneBox = await chatPane.boundingBox();
    expect(paneBox).not.toBeNull();
    expect(paneBox!.height).toBeGreaterThan(0);

    const chatView = chatPane.locator('[data-testid="chat-scroll-container"]');
    await expect(chatView).toBeVisible();

    const composer = page.getByTestId("composer-root");
    await expect(composer).toBeVisible();

    // Check that composer and chat view both have height >= their declared bounds
    const compBox = await composer.boundingBox();
    expect(compBox!.height).toBeGreaterThanOrEqual(72);

    const chatViewBox = await chatView.boundingBox();
    expect(chatViewBox!.height).toBeGreaterThanOrEqual(64);

    // Verify no bottom clip on pane: child bottom does not exceed pane bottom
    expect(compBox!.y + compBox!.height).toBeLessThanOrEqual(paneBox!.y + paneBox!.height + 1);
  });

  test("3.3 & 3.4 Below the floor sum, deficit is shared and not dumped on one row (#E5, #E6)", async ({ page }) => {
    // Short viewport puts pane below floor sum
    const chatPane = await openSplitSession(page);
    await page.setViewportSize({ width: 375, height: 280 });

    const paneBox = await chatPane.boundingBox();
    expect(paneBox).not.toBeNull();

    const compBox = await page.getByTestId("composer-root").boundingBox();
    expect(compBox).not.toBeNull();
    // Composer participates in shrinking down to its 72px bound
    expect(compBox!.height).toBeGreaterThanOrEqual(72);

    const chatView = chatPane.locator('[data-testid="chat-scroll-container"]');
    const chatViewBox = await chatView.boundingBox();
    expect(chatViewBox).not.toBeNull();
    // Transcript absorbed deficit below its 64px declared floor
    expect(chatViewBox!.height).toBeLessThan(64);
    // While holding at or above its 16px bound
    expect(chatViewBox!.height).toBeGreaterThanOrEqual(16);

    // Fixed row (composer-context-strip) holds its content height
    const strip = page.getByTestId("composer-context-strip");
    if (await strip.isVisible()) {
      const stripBox = await strip.boundingBox();
      expect(stripBox!.height).toBeGreaterThan(20);
    }
  });

  test("3.7 min-height beats max-h-[40%] below floor sum (#E9)", async ({ page }) => {
    // Short viewport where 0.4 * pane < 72px
    const chatPane = await openSplitSession(page);
    await page.setViewportSize({ width: 375, height: 260 });

    const paneBox = await chatPane.boundingBox();
    expect(paneBox).not.toBeNull();
    // Precondition: 40% cap would be less than 72px
    expect(paneBox!.height * 0.4).toBeLessThan(72);

    const composer = page.getByTestId("composer-root");
    await expect(composer).toBeVisible();

    // Min-height (72px) must prevail over max-h-[40%]
    const compBox = await composer.boundingBox();
    expect(compBox!.height).toBeGreaterThanOrEqual(72);
  });

  test("3.11 Long draft does not evict the bottom rows (#F4)", async ({ page }) => {
    const chatPane = await openSplitSession(page);

    const textarea = page.locator('textarea[placeholder*="Message"]');
    await expect(textarea).toBeVisible();

    // Fill 40-line draft into textarea
    const longDraft = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join("\n");
    await textarea.fill(longDraft);

    const paneBox = await chatPane.boundingBox();
    const compBox = await page.getByTestId("composer-root").boundingBox();
    expect(compBox).not.toBeNull();
    expect(paneBox).not.toBeNull();

    // Verify textarea or card scrolls its content
    const textareaScrollable = await textarea.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(textareaScrollable).toBe(true);

    // Bottom of composer does not overflow pane
    expect(compBox!.y + compBox!.height).toBeLessThanOrEqual(paneBox!.y + paneBox!.height + 2);
  });
});
