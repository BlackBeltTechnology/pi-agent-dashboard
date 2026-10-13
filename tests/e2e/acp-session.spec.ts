import { expect, test } from "./fixtures.js";
import { ACP_REPLY, spawnAcpSession } from "./helpers/acp.js";
import { sendPrompt } from "./helpers/index.js";

/**
 * ACP agent session end-to-end against the docker harness (fake ACP agent,
 * non-durable in-process host A). Covers test-plan #F1 (spawn + chat), #F6/#F8
 * (pi-only controls hidden) and the non-durable host end-to-end row.
 *
 * Only the agent is scripted; the adapter, gateway registration, protocol,
 * reducer and rendering are all real.
 *
 * See change: add-acp-session-driver (tasks 7.51, 7.56, 7.71).
 */
test.describe("ACP session (non-durable host)", () => {
  test("spawns via the picker, shows the driver chip and streams a turn", async ({ page }) => {
    const card = await spawnAcpSession(page, "qmt");

    await expect(card.getByTestId("session-driver-chip")).toContainText("ACP");
    await expect(card.getByTestId("session-driver-chip")).toContainText("QueryMT");

    await sendPrompt(page, "what does a.ts export?");
    await expect(page.getByText(ACP_REPLY).first()).toBeVisible({ timeout: 30_000 });
    // The tool card carries the ACP title (no pi renderer name exists for it).
    await expect(page.getByText("Read src/a.ts").first()).toBeVisible();
    // The turn settled: the user can send again.
    await expect(page.getByTestId("send-button").first()).toBeVisible();
  });

  test("pi-only controls are not offered on an ACP session", async ({ page }) => {
    const card = await spawnAcpSession(page, "qmt");
    await expect(card.getByTestId("session-driver-chip")).toBeVisible();
    await expect(card.getByRole("button", { name: /^fork/i })).toHaveCount(0);
    await expect(card.getByRole("button", { name: /^resume/i })).toHaveCount(0);
  });

  test("an ended ACP session offers a new session, never Resume/Fork/Retry, and refuses prompts", async ({ page }) => {
    const card = await spawnAcpSession(page, "qmt");
    const id = (await card.getAttribute("data-session-id")) as string;
    await sendPrompt(page, "hello");
    await expect(page.getByText(ACP_REPLY).first()).toBeVisible({ timeout: 30_000 });

    // End it through the dashboard's own shutdown route (stops the in-process host).
    const res = await page.request.post(`/api/session/${id}/shutdown`);
    expect(res.ok(), `shutdown failed: ${res.status()}`).toBe(true);

    const callout = page.getByTestId("acp-ended-callout");
    await expect(callout).toBeVisible({ timeout: 30_000 });
    await expect(callout).toContainText("ACP sessions can't be resumed");
    await expect(page.getByTestId("acp-ended-new-session")).toContainText("QueryMT");
    for (const name of [/^resume/i, /^fork/i, /^reload/i, /^retry/i]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }

    // A prompt is refused with the hint; no new session appears.
    const before = await page.locator('[data-testid="session-card-desktop"]').count();
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.fill("are you there?");
    await composer.press("Enter");
    await expect(page.getByText(/start a new session/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="session-card-desktop"]')).toHaveCount(before);
  });
});

