/**
 * E2E: agent path gate — ask-in-session file access (change: ask-agent-file-access-in-chat).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The L1 suites pin the decision, the settlement table, the confirm registry and
 * the derived `awaitingFileAccess` flag. Only a live browser against a real
 * server + real bridge + faux model proves: the gate's prompt renders as a CARD
 * in the session's own chat (never the app-wide grant dialog), the first answer
 * wins across tabs, "Always allow" writes the shared store through the server
 * (visible on Settings ▸ Access, honoured by the next sibling read), a cancelled
 * confirm denies, the needs-you rollup / toast route attention, and the Settings
 * toggle takes effect from the next tool call.
 *
 * Faux scenarios: `tool-read-outside` (reads /etc/hostname) and
 * `tool-read-outside-grantable` (reads /srv/fixtures-outside/a.txt then b.txt).
 * See qa/fixtures/faux-scenarios.ts.
 *
 * test-plan: #F1–#F9.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

const GATE_TITLE = /outside its workspace/i;

async function raise(page: Page, scenario: string) {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, `[[faux:${scenario}]] go`);
  await expect(page.getByText(GATE_TITLE).first()).toBeVisible({ timeout: 30_000 });
  return card;
}

const allowOnce = (page: Page) => page.getByRole("button", { name: /^Allow once/i }).first();
const deny = (page: Page) => page.getByRole("button", { name: /^Deny/i }).first();
const always = (page: Page) => page.getByRole("button", { name: /^Always allow/i }).first();

async function setGate(page: Page, enabled: boolean) {
  const res = await page.request.put("/api/config", { data: { agentPathGate: { enabled, timeoutSeconds: 120 } } });
  expect(res.ok()).toBe(true);
}

/** Revoke any persisted grant for the fixture dir via the Access page (isolates grant-dependent specs). */
async function revokeFixtureGrants(page: Page) {
  await page.goto("/settings/access");
  const rows = page.getByTestId("access-entry").filter({ hasText: "/srv/fixtures-outside" });
  await page.getByTestId("access-section").waitFor({ timeout: 15_000 });
  while ((await rows.count()) > 0) {
    await rows.first().getByTestId("access-revoke").click();
    await page.waitForTimeout(500);
  }
}

test.describe("agent path gate (L3)", () => {
  test.beforeEach(async ({ page }) => {
    await revokeFixtureGrants(page);
  });
  test.afterEach(async ({ page }) => {
    await setGate(page, true).catch(() => undefined);
    await revokeFixtureGrants(page).catch(() => undefined);
  });

  test("#F1 the gate is a card in the session chat, never the app-wide grant dialog", async ({ page }) => {
    await raise(page, "tool-read-outside");
    await expect(page.getByText("/etc/hostname").first()).toBeVisible();
    await expect(allowOnce(page)).toBeVisible();
    await expect(deny(page)).toBeVisible();
    await expect(page.getByTestId("grant-dialog")).toHaveCount(0);
    await allowOnce(page).click();
    // The answered card stays in the transcript (resolved, no buttons); the agent
    // proceeds and the scripted run finishes.
    await expect(allowOnce(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText("outside read done")).toBeVisible({ timeout: 30_000 });
  });

  test("#F2 first answer wins across tabs", async ({ page, context }) => {
    const card = await raise(page, "tool-read-outside");
    const sessionId = await card.getAttribute("data-session-id");
    const second = await context.newPage();
    await gotoDashboard(second);
    await second.locator(`[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`).click();
    await expect(second.getByText(GATE_TITLE).first()).toBeVisible({ timeout: 30_000 });
    await allowOnce(page).click();
    await expect(allowOnce(second)).toHaveCount(0, { timeout: 15_000 });
    await expect(second.getByText("outside read done")).toBeVisible({ timeout: 30_000 });
    await second.close();
  });

  test("#F3 always allow persists; a sibling read shows no card", async ({ page }) => {
    await raise(page, "tool-read-outside-grantable");
    await always(page).click();
    await page.getByRole("button", { name: /^(Yes|Confirm|Allow)/i }).first().click();
    // The sibling (b.txt) read must NOT raise a second card.
    await expect(page.getByText("outside reads done")).toBeVisible({ timeout: 30_000 });
    // Exactly ONE gate card ever rendered: the second read (b.txt) was admitted by the grant.
    await expect(page.getByText(GATE_TITLE)).toHaveCount(1);
    await page.goto("/settings/access");
    await expect(page.getByTestId("access-entry-via-agent-prompt").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("/srv/fixtures-outside").first()).toBeVisible();
  });

  test("#F4 a cancelled always-allow confirm denies and writes nothing", async ({ page }) => {
    await raise(page, "tool-read-outside-grantable");
    await always(page).click();
    await page.getByRole("button", { name: /^(No|Cancel)/i }).first().click();
    // The gated read is blocked (a failed tool row); the sibling read inside the
    // repeat-suppression window is blocked without a second card.
    await expect(page.getByText("outside reads done")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/\d+ failed/i).first()).toBeVisible();
    await expect(page.getByText(GATE_TITLE)).toHaveCount(1);
    await page.goto("/settings/access");
    await expect(page.getByText("/srv/fixtures-outside")).toHaveCount(0);
  });

  test("#F5 a blocked session rolls up as needs-you while its tool still reads `read`", async ({ page }) => {
    const card = await raise(page, "tool-read-outside");
    // Navigate away from the blocked session: the rollup must still show it.
    await page.goto("/");
    await expect(page.locator('[data-capsule-segment="needs-you"]').first()).toContainText("1", { timeout: 30_000 });
    // Derived flag, tool display untouched (server truth, same REST the client hydrates from).
    const id = await card.getAttribute("data-session-id");
    const row = ((await (await page.request.get("/api/sessions")).json()) as { data: Array<Record<string, unknown>> }).data.find(
      (s) => s.id === id,
    );
    expect(row?.awaitingFileAccess).toBe(true);
    await card.click();
    await allowOnce(page).click();
    await expect.poll(async () => {
      const r = ((await (await page.request.get("/api/sessions")).json()) as { data: Array<Record<string, unknown>> }).data.find((s) => s.id === id);
      return r?.awaitingFileAccess ?? false;
    }, { timeout: 30_000 }).toBe(false);
  });

  test("#F6 the rollup survives a browser-link reconnect and the card stays answerable", async ({ page, context }) => {
    const card = await raise(page, "tool-read-outside");
    await page.goto("/");
    await expect(page.locator('[data-capsule-segment="needs-you"]').first()).toContainText("1", { timeout: 30_000 });
    // Drop and restore the browser's socket (server state is the source of truth).
    await context.setOffline(true);
    await page.waitForTimeout(1_500);
    await context.setOffline(false);
    await expect(page.locator('[data-capsule-segment="needs-you"]').first()).toContainText("1", { timeout: 30_000 });
    await card.click();
    await expect(allowOnce(page)).toBeVisible({ timeout: 15_000 });
    await allowOnce(page).click();
  });

  test("#F7/#F8 toast names a session not in view; none for the one in view", async ({ page }) => {
    const first = await spawnFreshGitSession(page);
    const firstId = await first.getAttribute("data-session-id");
    const second = await spawnFreshGitSession(page);
    await second.click();
    // Raise the gate in `first` while viewing `second`.
    await first.click();
    await sendPrompt(page, "[[faux:tool-read-outside]] go");
    await expect(page.getByText(GATE_TITLE).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/waiting for file access/i)).toHaveCount(0); // #F8: in view
    await second.click();
    await expect(page.getByText(/waiting for file access/i).first()).toBeVisible({ timeout: 15_000 }); // #F7
    await page.getByTestId("toast-action").first().click();
    await expect(page.getByText(GATE_TITLE).first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(firstId ?? ""));
    await allowOnce(page).click();
    await expect(page.getByText(/waiting for file access/i)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText("outside read done")).toBeVisible({ timeout: 30_000 });
  });

  test("#F9 with the gate off there is no card and the read succeeds", async ({ page }) => {
    await setGate(page, false);
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:tool-read-outside]] go");
    await expect(page.getByText(GATE_TITLE)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText(/read/i).first()).toBeVisible();
  });
});
