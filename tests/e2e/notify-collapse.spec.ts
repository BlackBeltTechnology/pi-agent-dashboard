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
 * POST /api/restart and wait for a NEW, STABLE server generation. The
 * generation is `/api/health` `pid` + `startedAt`: the first healthy probe
 * must report a DIFFERENT generation than before the POST (a refused restart —
 * e.g. `409` on an ephemeral server — would otherwise pass without the cold
 * replay F2 is about), and a second probe 3 s later the SAME one (a single
 * healthy probe can land between two restart waves; the NEXT spec then races
 * the second bounce). Pattern: `pending-prompt-recovery.spec.ts`
 * `restartDashboardStable` + `faux-ask.spec.ts` `serverIdentity`.
 */
async function restartDashboardStable(): Promise<void> {
  const base = `http://localhost:${DASHBOARD_PORT}`;
  const generation = async (): Promise<string | null> => {
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { pid?: number; startedAt?: string | number };
      return body.pid == null ? null : `${body.pid}@${body.startedAt ?? ""}`;
    } catch {
      return null; // still down
    }
  };
  const before = await generation();
  expect(before, "server generation must be readable before restart").not.toBeNull();

  const res = await fetch(`${base}/api/restart`, { method: "POST" }).catch(
    () => undefined, // the connection dies with the daemon; that is the point
  );
  if (res) expect(res.ok, `POST /api/restart answered ${res.status}`).toBe(true);

  await new Promise((r) => setTimeout(r, 2_000));
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const first = await generation();
    if (first !== null && first !== before) {
      await new Promise((r) => setTimeout(r, 3_000));
      if ((await generation()) === first) return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back as a new stable generation after POST /api/restart");
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
