import { expect, test } from "./fixtures.js";
import {
  COMPOSER_MODELS,
  connectComposerBridge,
  ensureFixturePinned,
  fitsHorizontally,
  isVisuallyHiddenButExposed,
  LONGEST_MODEL,
  openComposerSession,
  setComposerContentWidth,
} from "./helpers/composer-bridge.js";
import { gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — the composer toolbar must not overflow a narrow pane, and its
// folds fire on the composer CONTAINER width in rem.
// Changes: fix-split-composer-overflow (container, not viewport), add-composer-dock
// (one toolbar row, `＋` as the only fold host, no `⋯`).
//
// Bug history: the composer folded controls using VIEWPORT `md:` breakpoints. In
// split view the chat pane is narrow but the viewport is wide, so nothing folded
// and the pane's `overflow-hidden` CLIPPED the send/stop action button.
//
// This spec is the ONLY layer that reproduces the real-DOM geometry. Thresholds
// (rem container queries on the composer card, default 16 px root):
//   55rem (880 px)   after-turn label → icon
//   40rem (640 px)   working-status word → sr-only; delivery chip drops its label
//   26.25rem (420 px) delivery chip → `＋` menu; model chip drops `· level`

test.describe("split composer overflow", () => {
  test("action button stays inside the split chat pane; Steer/Queue fold into ＋; no ⋯", async ({ page }) => {
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

    // The one fold host is ＋; there is no ⋯ overflow control at any width.
    await expect(page.getByTestId("overflow-button")).toHaveCount(0);
    // The action button ends the toolbar row (add-composer-dock D7), not the input row.
    await expect(page.getByTestId("composer-settings-row").getByTestId("send-button")).toBeVisible();
    await expect(page.getByTestId("composer-input-row").getByTestId("send-button")).toHaveCount(0);

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

test.describe("composer toolbar folds (rem container queries)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
  });

  /** Register a streaming synthetic session and open its composer. */
  async function openStreamingComposer(page: import("./fixtures.js").Page) {
    await gotoDashboard(page);
    await ensureFixturePinned(page);
    const bridge = await connectComposerBridge(page, "fold");
    await openComposerSession(page, bridge.sessionId);
    bridge.startStreaming();
    await expect(page.getByTestId("stop-button")).toBeVisible({ timeout: 20_000 });
    return bridge;
  }

  // #E7 — every fold flips exactly at its threshold (±1 px around 880 / 640 / 420).
  test("E7: after-turn label, status word and delivery chip flip at 880 / 640 / 420 px", async ({ page }) => {
    const bridge = await openStreamingComposer(page);
    try {
      const afterTurnLabel = page.getByTestId("stop-after-turn-button").locator("span");
      const statusWord = page.getByTestId("working-status").getByText(/thinking|generating|running/i);
      const delivery = page.getByTestId("delivery-control");

      await setComposerContentWidth(page, 881);
      await expect(afterTurnLabel).toBeVisible();
      await setComposerContentWidth(page, 879);
      await expect(afterTurnLabel).toBeHidden();
      await expect(page.getByTestId("stop-after-turn-button")).toHaveAccessibleName("Stop after turn");

      await setComposerContentWidth(page, 641);
      expect(await isVisuallyHiddenButExposed(statusWord)).toBe(false);
      await expect(statusWord).toBeVisible();
      await setComposerContentWidth(page, 639);
      expect(await isVisuallyHiddenButExposed(statusWord)).toBe(true);

      await setComposerContentWidth(page, 421);
      await expect(delivery).toBeVisible();
      await setComposerContentWidth(page, 419);
      await expect(delivery).toBeHidden();
      await page.getByTestId("attach-button").click();
      const menu = page.getByTestId("attach-menu");
      await expect(menu.getByTestId("delivery-steer")).toBeVisible();
      await expect(menu.getByTestId("delivery-queue")).toBeVisible();
    } finally {
      bridge.close();
    }
  });

  // #E21 — the model id truncates with an ellipsis before anything else folds.
  test("E21: the longest model id truncates with an ellipsis and the toolbar never overflows", async ({ page }) => {
    await gotoDashboard(page);
    await ensureFixturePinned(page);
    const bridge = await connectComposerBridge(page, "longest");
    try {
      await openComposerSession(page, bridge.sessionId);
      const longest = `${LONGEST_MODEL.provider}/${LONGEST_MODEL.id}`;
      expect(COMPOSER_MODELS.every((m) => `${m.provider}/${m.id}`.length <= longest.length)).toBe(true);
      const chip = page.getByTestId("model-selector-button");
      await expect(chip).toContainText(longest.slice(0, 12));
      for (const width of [881, 421]) {
        await setComposerContentWidth(page, width);
        const face = chip.locator(".truncate").first();
        const { textOverflow, clipped } = await face.evaluate((el) => ({
          textOverflow: getComputedStyle(el).textOverflow,
          clipped: el.scrollWidth > el.clientWidth,
        }));
        expect(textOverflow, `ellipsis at ${width}px`).toBe("ellipsis");
        expect(clipped, `the id is clipped (not wrapped) at ${width}px`).toBe(true);
        const fit = await fitsHorizontally(page.getByTestId("composer-settings-row"));
        expect(fit.scrollWidth, `toolbar overflows at ${width}px`).toBeLessThanOrEqual(fit.clientWidth);
      }
    } finally {
      bridge.close();
    }
  });

  // #F21 — at 375 px the working-status word is visually hidden but exposed; the shape stays.
  test("F21: working-status word is clipped but in the accessibility tree at 375 px; the shape is visible", async ({ page }) => {
    const bridge = await openStreamingComposer(page);
    try {
      await setComposerContentWidth(page, 375);
      const status = page.getByTestId("working-status");
      const word = status.getByText(/thinking|generating|running/i);
      expect(await isVisuallyHiddenButExposed(word)).toBe(true);
      await expect(status.locator("svg")).toBeVisible();
      await expect(status.locator("svg")).toHaveAttribute("aria-hidden", "true");
    } finally {
      bridge.close();
    }
  });

  // #X10 — a 44 px `composer-toolbar-action` claim must not overflow the toolbar at 375 px.
  // The slot itself belongs to add-voice-assistant-dashboard-plugin; here a 44 px
  // button is injected directly before the action cluster to prove the row's budget.
  test("X10: a 44 px toolbar action next to Stop at 375 px neither overflows nor gets clipped", async ({ page }) => {
    const bridge = await openStreamingComposer(page);
    try {
      await setComposerContentWidth(page, 375);
      await page.getByTestId("composer-settings-row").evaluate((row) => {
        const fake = document.createElement("button");
        fake.type = "button";
        fake.setAttribute("data-testid", "fake-toolbar-action");
        fake.setAttribute("aria-label", "Fake toolbar action");
        fake.style.cssText = "min-width:44px;min-height:44px;flex:none";
        const cluster = row.querySelector('[data-testid="stop-split"], [data-testid="stop-button"]');
        row.insertBefore(fake, cluster);
      });
      const row = page.getByTestId("composer-settings-row");
      const fit = await fitsHorizontally(row);
      expect(fit.scrollWidth, "toolbar overflows with a 44 px action").toBeLessThanOrEqual(fit.clientWidth);
      const action = await page.getByTestId("fake-toolbar-action").boundingBox();
      const rowBox = await row.boundingBox();
      expect(action).not.toBeNull();
      expect(rowBox).not.toBeNull();
      expect(action!.x).toBeGreaterThanOrEqual(rowBox!.x - 1);
      expect(action!.x + action!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);
      await expect(page.getByTestId("stop-button")).toBeVisible();
      const stop = await page.getByTestId("stop-button").boundingBox();
      expect(stop!.x + stop!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);
    } finally {
      bridge.close();
    }
  });

  // #X11 — container thresholds are rem: a 32 px root folds earlier at the same pixel width.
  test("X11: at a 32 px root font the toolbar still fits and the after-turn label folds at 880 px", async ({ page }) => {
    const bridge = await openStreamingComposer(page);
    try {
      const afterTurnLabel = page.getByTestId("stop-after-turn-button").locator("span");
      await setComposerContentWidth(page, 880);
      await expect(afterTurnLabel).toBeVisible(); // 880 px = 55rem at the default root
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
      try {
        await setComposerContentWidth(page, 880);
        await expect(afterTurnLabel).toBeHidden(); // 880 px = 27.5rem now: below 55rem
        const fit = await fitsHorizontally(page.getByTestId("composer-settings-row"));
        expect(fit.scrollWidth, "toolbar overflows at a 32 px root").toBeLessThanOrEqual(fit.clientWidth);
      } finally {
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "";
        });
      }
    } finally {
      bridge.close();
    }
  });
});
