import { expect, test } from "@playwright/test";
import { spawnFreshGitSession } from "./helpers/index.js";

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
    await page.getByTestId("split-toggle").click();
    const chatPane = page.getByTestId("split-chat-pane");
    await expect(chatPane).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 15_000 });

    // Container-query fold: the narrow chat pane collapses thinking / delivery /
    // terminal into the `⋯` overflow control (viewport is still ≥ md, so this
    // only passes with the container-based fix, not the old md: rules).
    await expect(page.getByTestId("overflow-button")).toBeVisible({ timeout: 10_000 });

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
