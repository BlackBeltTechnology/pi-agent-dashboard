import type { Locator, Page } from "@playwright/test";
import {
  NOTIFY_PROBE_MESSAGE,
  NOTIFY_REPEAT_DONE,
  NOTIFY_REPEAT_MESSAGE,
} from "../../qa/fixtures/faux-scenarios.js";
import { expect, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/**
 * Rendered-UI behaviour of notify-row collapse + chronological replay.
 *
 * Driver: the `e2e_notify` fixture tool (qa/fixtures/e2e-notify.ext.ts) with
 * `count` — N identical `ctx.ui.notify` calls inside ONE tool call, so no tool
 * card separates them. That runs the REAL path: bridge notify proxy (stamps
 * `ts`) → server notify log → client `addNotify` → `displayRows` collapse →
 * NotifyRenderer `×N` badge.
 *
 * Covers test-plan #F1, #F2, #F3.
 * See change: collapse-and-order-notify-rows.
 */

const PLAIN_TEXT_MARKER = "The quick brown faux jumps over the lazy dog.";

/** Rendered notify rows (InlineMessage) carrying `text`. */
function notifyRows(page: Page, text: string): Locator {
  return page.locator('[data-testid="inline-message"]').filter({ hasText: text });
}

async function reloadAndWait(page: Page): Promise<void> {
  await page.reload();
  await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
}

/**
 * POST /api/restart and wait for a STABLE process — healthy AND the same pid
 * across two probes 3 s apart. A single healthy probe can land between two
 * restart waves (the re-exec hand-off), and the NEXT spec then races the
 * second bounce (observed: its first prompt is lost). Pattern:
 * `pending-prompt-recovery.spec.ts` `restartDashboardStable`.
 */
async function restartDashboardStable(): Promise<void> {
  const base = `http://localhost:${DASHBOARD_PORT}`;
  await fetch(`${base}/api/restart`, { method: "POST" }).catch(
    () => undefined, // the connection dies with the daemon; that is the point
  );
  await new Promise((r) => setTimeout(r, 2_000));
  const pid = async (): Promise<number | null> => {
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return null;
      return ((await res.json()) as { pid?: number }).pid ?? null;
    } catch {
      return null; // still down
    }
  };
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const first = await pid();
    if (first !== null) {
      await new Promise((r) => setTimeout(r, 3_000));
      if ((await pid()) === first) return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back (stably) after POST /api/restart");
}

test.describe("notify collapse — adjacent identical notifies render once", () => {
  test("#F1 five identical warnings render as one ×5 row, before and after reload", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:notify-repeat]] go");
    await expect(page.getByText(NOTIFY_REPEAT_DONE).first()).toBeVisible({ timeout: 60_000 });

    const rows = notifyRows(page, NOTIFY_REPEAT_MESSAGE);
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId("notify-repeat-count")).toHaveText("×5");

    // Let the debounced replay cursor flush so the reload is a real replay.
    await page.waitForTimeout(1_800);
    await reloadAndWait(page);

    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId("notify-repeat-count")).toHaveText("×5");
  });

  test("#F3 a run growing live keeps the same row and its count climbs", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:notify-repeat-slow]] go");
    const rows = notifyRows(page, NOTIFY_REPEAT_MESSAGE);
    const badge = rows.first().getByTestId("notify-repeat-count");
    // Catch the run mid-growth (the fixture spaces 10 notifies 800 ms apart).
    await expect(badge).toBeVisible({ timeout: 60_000 });
    const earlyCount = Number((await badge.textContent())?.replace(/\D/g, ""));
    expect(earlyCount).toBeLessThan(10);

    // Tag the virtual-row wrapper: a remount (key change) would drop the tag.
    const wrapper = rows.first().locator("xpath=ancestor::*[@data-index][1]");
    const index = await wrapper.getAttribute("data-index");
    await wrapper.evaluate((el) => el.setAttribute("data-e2e-probe", "tagged"));

    await expect(badge).toHaveText("×10", { timeout: 30_000 });
    await expect(rows).toHaveCount(1);
    const after = rows.first().locator("xpath=ancestor::*[@data-index][1]");
    await expect(after).toHaveAttribute("data-e2e-probe", "tagged");
    await expect(after).toHaveAttribute("data-index", index!);
  });
});

test.describe("notify replay — keeps its chronological position", () => {
  test("#F2 a replayed notify stays above later turns across reload and restart", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:notify-probe]] go");
    const probe = notifyRows(page, NOTIFY_PROBE_MESSAGE);
    await expect(probe.first()).toBeVisible({ timeout: 30_000 });
    await sendPrompt(page, "[[faux:plain-text]] later");
    const marker = page.getByText(PLAIN_TEXT_MARKER).first();
    await expect(marker).toBeVisible({ timeout: 30_000 });

    const assertNotifyAboveMarker = async () => {
      await expect(probe.first()).toBeVisible({ timeout: 60_000 });
      await expect(marker).toBeVisible({ timeout: 60_000 });
      await expect(probe).toHaveCount(1);
      const notifyY = (await probe.first().boundingBox())!.y;
      const markerY = (await marker.boundingBox())!.y;
      expect(notifyY).toBeLessThan(markerY);
    };

    await assertNotifyAboveMarker();

    await page.waitForTimeout(1_800);
    await reloadAndWait(page);
    await assertNotifyAboveMarker();

    // Cold path: the notify log is re-read from the persisted session meta.
    await restartDashboardStable();
    await reloadAndWait(page);
    await assertNotifyAboveMarker();
  });
});
