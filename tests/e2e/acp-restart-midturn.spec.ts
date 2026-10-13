import { expect, test } from "./fixtures.js";
import { ACP_REPLY, spawnAcpSession } from "./helpers/acp.js";
import { sendPrompt } from "./helpers/index.js";

/**
 * A durable ACP session (host B under the rpc-keeper) survives a dashboard
 * restart mid-turn: the adapter reattaches and the log replay finishes the
 * turn (test-plan #F4). `qmt-durable` paces each scripted step by 400 ms.
 *
 * See change: add-acp-session-driver (task 7.55).
 */
async function serverPid(page: import("@playwright/test").Page): Promise<number | null> {
  try {
    const res = await page.request.get("/api/health", { timeout: 5_000 });
    if (!res.ok()) return null;
    return ((await res.json()) as { pid?: number }).pid ?? null;
  } catch {
    return null;
  }
}

test("a durable ACP session finishes its turn across a server restart", async ({ page }) => {
  test.setTimeout(180_000);
  const card = await spawnAcpSession(page, "qmt-durable");
  const sessionId = await card.getAttribute("data-session-id");
  await sendPrompt(page, "restart probe");
  await expect(page.getByText("restart probe").first()).toBeVisible({ timeout: 30_000 });

  const before = await serverPid(page);
  expect(before).not.toBeNull();
  await page.request.post("/api/restart", { timeout: 10_000 }).catch(() => {});
  await expect.poll(async () => {
    const p = await serverPid(page);
    return p !== null && p !== before;
  }, { timeout: 90_000, intervals: [1_000] }).toBe(true);

  await page.reload();
  const same = page.locator(`[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`);
  await expect(same).toBeVisible({ timeout: 60_000 });
  await same.click();
  await expect(same.getByTestId("session-driver-chip")).toContainText("ACP");
  await expect(page.getByText(ACP_REPLY).first()).toBeVisible({ timeout: 60_000 });
});
