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
});
