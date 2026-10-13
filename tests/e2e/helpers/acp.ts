import type { Locator, Page } from "@playwright/test";
import { ensureFixtureGitGroup, gotoDashboard } from "./index.js";

/**
 * ACP spec helpers. The harness seeds four scripted fake agents
 * (docker/test-entrypoint.sh): `qmt`, `qmt-slow`, `qmt-perm`, `qmt-durable`.
 * See change: add-acp-session-driver.
 */

/** Final assistant text the fake agent streams for a plain turn. */
export const ACP_REPLY = "The file exports a constant.";

const CARD = '[data-testid="session-card-desktop"]';

/**
 * Pick `agentId` in the FIXTURE_GIT folder's spawn picker (chevron → menu item)
 * and press the main button. Returns the new session's card.
 */
export async function spawnAcpSession(page: Page, agentId: string): Promise<Locator> {
  await gotoDashboard(page);
  const existing = new Set(
    await page.locator(CARD).evaluateAll((els) => els.map((e) => e.getAttribute("data-session-id") ?? "")),
  );
  const body = await ensureFixtureGitGroup(page);
  await body.getByTestId("folder-spawn-session-btn-chevron").click();
  await page.getByTestId("folder-spawn-session-btn-menu").locator(`[data-agent="${agentId}"]`).click();
  await body.getByTestId("folder-spawn-session-btn").click();

  let id = "";
  const deadline = Date.now() + 60_000;
  while (!id && Date.now() < deadline) {
    const ids = await page.locator(CARD).evaluateAll((els) => els.map((e) => e.getAttribute("data-session-id") ?? ""));
    id = ids.find((i) => i && !existing.has(i)) ?? "";
    if (!id) await page.waitForTimeout(250);
  }
  if (!id) throw new Error(`no new session card appeared after spawning ACP agent ${agentId}`);
  const card = page.locator(`${CARD}[data-session-id="${id}"]`);
  await card.click();
  return card;
}
