import { expect, test } from "./fixtures.js";
import { renameSessionViaTitleMenu, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — composer toolbar must not overflow the split chat pane
// (change: fix-split-composer-overflow).
//
// Bug: the composer folded its secondary controls (thinking / Steer|Queue /
// terminal) into the `⋯` overflow menu using VIEWPORT-based `md:` breakpoints.
// In split view the chat pane is narrow but the viewport is wide (≥ md), so
// nothing folded, the ~689px inline toolbar exceeded the pane, and the pane's
// `overflow-hidden` CLIPPED the send/stop action button.
//
// Fix: fold on the composer CONTAINER width (`@container` + `@[44rem]:`), so a
// narrow split pane folds regardless of viewport.
//
// This spec is the ONLY layer that reproduces the real-DOM geometry: it opens
// the split at the default Desktop-Chrome viewport (1280px, ≥ md), where the
// chat pane resolves to well under 44rem. The old viewport-based code would
// leave the action button overflowing the pane; the container-query fix folds
// the toolbar and keeps the button inside the pane bounds.

test.describe("split composer overflow", () => {
  test("action button stays inside the split chat pane and controls fold to ⋯", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    // Composer renders for the selected session (idle → send-button).
    const sendBtn = page.getByTestId("send-button");
    await expect(sendBtn).toBeVisible({ timeout: 30_000 });

    // Open the editor split from the session header.
    await page.getByTestId("layout-mode-split").click();
    const chatPane = page.getByTestId("split-chat-pane");
    await expect(chatPane).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 15_000 });

    // Container-query fold: the narrow chat pane collapses thinking / delivery /
    // terminal into the `⋯` overflow control (viewport is still ≥ md, so this
    // only passes with the container-based fix, not the old md: rules).
    await expect(page.getByTestId("overflow-button")).toBeVisible({ timeout: 10_000 });
    // The action button lives in the input row beside the text field, not in
    // the settings row. See change: redesign-composer-session-strip (D7).
    await expect(page.getByTestId("composer-input-row").getByTestId("send-button")).toBeVisible();
    await expect(page.getByTestId("composer-settings-row").getByTestId("send-button")).toHaveCount(0);

    // The send/stop action button must be fully within the pane — the exact bug
    // symptom was its right edge overflowing past the `overflow-hidden` pane.
    const paneBox = await chatPane.boundingBox();
    const btnBox = await sendBtn.boundingBox();
    expect(paneBox).not.toBeNull();
    expect(btnBox).not.toBeNull();
    // Right edge of the button ≤ right edge of the pane (1px rounding slack).
    expect(btnBox!.x + btnBox!.width).toBeLessThanOrEqual(paneBox!.x + paneBox!.width + 1);
    // And the button starts inside the pane (not pushed off the left either).
    expect(btnBox!.x).toBeGreaterThanOrEqual(paneBox!.x - 1);
  });
});

// ── Session header: narrow content collapses by priority ──────────────────
// Real-DOM geometry only: the header is a CSS container (below 760 px the meta
// line drops under the title and labels collapse to icons). jsdom has no layout.
// Covers test-plan F1, F2. See change: reorganize-session-header.
const LONG_NAME = "Reorganize the session header so the layout switch stays whole and usable";

test.describe("session header narrow content", () => {
  test("F1: a 66-character title truncates on one line; controls keep their size and stay inside the header", async ({ page }) => {
    test.setTimeout(180_000);
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.setViewportSize({ width: 1100, height: 800 });
    const header = page.getByTestId("session-header");
    await expect(header).toBeVisible({ timeout: 30_000 });
    await renameSessionViaTitleMenu(page, LONG_NAME);

    const headerBox = (await header.boundingBox())!;
    expect(headerBox.height, "header stays one compact block").toBeLessThanOrEqual(96);

    const title = page.getByTestId("session-title-text");
    const t = await title.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        overflowing: el.scrollWidth > el.clientWidth,
        height: el.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(cs.lineHeight) || Number.parseFloat(cs.fontSize) * 1.5,
      };
    });
    expect(t.overflowing, "title ellipsizes").toBe(true);
    expect(t.height, "title is one line").toBeLessThanOrEqual(t.lineHeight * 1.5);

    for (const mode of ["closed", "split", "full"]) {
      const box = (await page.getByTestId(`layout-mode-${mode}`).boundingBox())!;
      expect(box.width, `${mode} segment width`).toBeGreaterThanOrEqual(32);
      expect(box.height, `${mode} segment height`).toBeGreaterThanOrEqual(32);
      expect(box.x, `${mode} inside header (left)`).toBeGreaterThanOrEqual(headerBox.x - 1);
      expect(box.x + box.width, `${mode} inside header (right)`).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);
    }

    // Below the 760 px container the `pi <version>` text hides; `+ tag` stays.
    const container = await header.evaluate((el) => el.getBoundingClientRect().width);
    if (container < 760) {
      await expect(page.getByTestId("session-header-pi-version")).toBeHidden();
    }
    await expect(header.getByText("+ tag")).toBeVisible();
  });

  test("F2: trailing controls stay whole when the title is long and the content is narrow", async ({ page }) => {
    test.setTimeout(180_000);
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.setViewportSize({ width: 1000, height: 800 });
    const header = page.getByTestId("session-header");
    await expect(header).toBeVisible({ timeout: 30_000 });
    await renameSessionViaTitleMenu(page, LONG_NAME);
    await page.getByTestId("layout-mode-split").click();
    await expect(page.getByTestId("split-chat-pane")).toBeVisible({ timeout: 15_000 });

    const headerBox = (await header.boundingBox())!;
    // Every control that is present (Modules, Changed Files, Resume, Fork when
    // they apply to the session) plus the switch and View sits inside the header.
    const trailing = page.getByTestId("session-header-trailing");
    const controls = trailing.locator("button");
    const n = await controls.count();
    expect(n).toBeGreaterThanOrEqual(4); // 3 layout segments + View
    for (let i = 0; i < n; i++) {
      const box = await controls.nth(i).boundingBox();
      if (!box) continue;
      expect(box.x, `control ${i} left`).toBeGreaterThanOrEqual(headerBox.x - 1);
      expect(box.x + box.width, `control ${i} right`).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);
    }
    const ellipsized = await page.getByTestId("session-title-text").evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(ellipsized, "the title ends in an ellipsis").toBe(true);
  });
});
