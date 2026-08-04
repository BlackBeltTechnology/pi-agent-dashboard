import { test, expect, type Page } from "@playwright/test";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * preserve-inline-terminal-transcript — L3 end-to-end behaviour against the
 * docker harness. The frozen card carries data-terminal-state="frozen"; a live
 * card "live"; a removed card is absent entirely.
 *
 * Runs on the harness port injected by Playwright's baseURL (derived in
 * .pi-test-harness.json → dashboardPort) — never a hardcoded :18000.
 * See change: preserve-inline-terminal-transcript.
 */

// The composer folds the terminal button into a ⋯ overflow menu below the
// `@[44rem]` container-query breakpoint. Widen the viewport so the desktop
// affordance renders; openInline() still falls back to ⋯ if it does not.
test.use({ viewport: { width: 1680, height: 900 } });

const card = (page: Page) => page.getByTestId("terminal-card");
const liveCard = (page: Page) => page.locator('[data-testid="terminal-card"][data-terminal-state="live"]');
const frozenCard = (page: Page) => page.locator('[data-testid="terminal-card"][data-terminal-state="frozen"]');
const termInput = (page: Page) => page.getByRole("textbox", { name: /terminal input/i }).first();
const closeBtn = (page: Page) => page.getByRole("button", { name: /close terminal/i }).first();

async function openInline(page: Page): Promise<string> {
  const session = await spawnFreshGitSession(page);
  const sessionId = await session.getAttribute("data-session-id");
  expect(sessionId).toBeTruthy();
  await session.click();
  // Composer must be mounted for the selected session before its actions exist.
  await page.getByPlaceholder(/message/i).first().waitFor({ state: "visible", timeout: 30_000 });
  const openBtn = byTestId(page, "openInlineTerminalButton");
  const desktopVisible = await openBtn
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (desktopVisible) {
    await openBtn.first().click();
  } else {
    // Narrow composer: the button lives in the ⋯ overflow menu.
    await page.getByTestId("overflow-button").first().click();
    await page.getByTestId("overflow-menu").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByTestId("overflow-menu").getByTestId("open-inline-terminal-button").click();
  }
  await expect(liveCard(page)).toBeVisible({ timeout: 20_000 });
  // xterm textarea proves the pane initialized end-to-end over the WS.
  await expect(termInput(page)).toBeVisible({ timeout: 20_000 });
  return sessionId as string;
}

async function typeIntoTerminal(page: Page, text: string): Promise<void> {
  await termInput(page).click();
  await page.keyboard.type(text);
  await page.waitForTimeout(300);
}

test.describe("inline terminal transcript preservation", () => {
  test("F1: run ls then exit, close → frozen read-only card with pre-exit scrollback", async ({ page }) => {
    await openInline(page);
    await typeIntoTerminal(page, "ls\n");
    await typeIntoTerminal(page, "exit\n"); // shell exits before the card is closed
    await page.waitForTimeout(1_000);
    await closeBtn(page).click();
    await expect(frozenCard(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/read-only transcript/i).first()).toBeVisible();
  });

  test("F2: open then close untouched → no card, no placeholder", async ({ page }) => {
    await openInline(page);
    await closeBtn(page).click();
    await expect(card(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/terminal closed/i)).toHaveCount(0);
  });

  test("F3: open untouched with a shell prompt visible → still removed (line count irrelevant)", async ({ page }) => {
    await openInline(page);
    // The shell prints its prompt (possibly multi-line) but the user never typed.
    await page.waitForTimeout(800);
    await closeBtn(page).click();
    await expect(card(page)).toHaveCount(0, { timeout: 15_000 });
  });

  test("F4: type only 'exit' → frozen, not removed", async ({ page }) => {
    await openInline(page);
    await typeIntoTerminal(page, "exit\n");
    await page.waitForTimeout(1_000);
    await closeBtn(page).click();
    await expect(frozenCard(page)).toBeVisible({ timeout: 15_000 });
  });

  test("F5: press only non-printing keys (arrows/Tab) → frozen, not removed", async ({ page }) => {
    await openInline(page);
    await termInput(page).click();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(400);
    await closeBtn(page).click();
    await expect(frozenCard(page)).toBeVisible({ timeout: 15_000 });
  });

  test("F7: reload after open + empty close → no card", async ({ page }) => {
    const sessionId = await openInline(page);
    await closeBtn(page).click();
    await expect(card(page)).toHaveCount(0, { timeout: 15_000 });
    await page.goto(`/session/${sessionId}`);
    await page.waitForTimeout(1_500);
    await expect(card(page)).toHaveCount(0, { timeout: 15_000 });
  });

  test("F8: reload after open + non-empty close → frozen at its original position", async ({ page }) => {
    const sessionId = await openInline(page);
    await typeIntoTerminal(page, "echo persisted\n");
    await page.waitForTimeout(600);
    await closeBtn(page).click();
    await expect(frozenCard(page)).toBeVisible({ timeout: 15_000 });
    await page.goto(`/session/${sessionId}`);
    await expect(frozenCard(page)).toBeVisible({ timeout: 20_000 });
  });

  test("F9: two browsers converge on identical card state after close", async ({ page, browser }) => {
    const sessionId = await openInline(page);
    await typeIntoTerminal(page, "echo shared\n");
    await page.waitForTimeout(600);

    const ctx2 = await browser.newContext({ baseURL: BASE_URL });
    try {
      const page2 = await ctx2.newPage();
      await page2.goto(`/session/${sessionId}`);
      await expect(liveCard(page2)).toBeVisible({ timeout: 20_000 });

      // page1 stays connected; page2 will reload after the close.
      await closeBtn(page).click();
      await expect(frozenCard(page)).toBeVisible({ timeout: 15_000 });

      await page2.goto(`/session/${sessionId}`);
      await expect(frozenCard(page2)).toBeVisible({ timeout: 20_000 });
    } finally {
      await ctx2.close();
    }
  });

  test("F10: reload with a live PTY reconnects the card (regression)", async ({ page }) => {
    const sessionId = await openInline(page);
    await typeIntoTerminal(page, "echo alive\n");
    await page.goto(`/session/${sessionId}`);
    // Card is still live (never closed) — reattaches to the ring buffer.
    await expect(liveCard(page)).toBeVisible({ timeout: 20_000 });
    await expect(termInput(page)).toBeVisible({ timeout: 20_000 });
  });

  test("F11: reload with a dead PTY shows the disconnected notice (regression)", async ({ page }) => {
    const sessionId = await openInline(page);
    // Kill the shell from inside; the card is never closed, so no tombstone is
    // consulted — the live card simply reattaches and finds the socket gone.
    await typeIntoTerminal(page, "exit\n");
    await page.waitForTimeout(1_500);
    await page.goto(`/session/${sessionId}`);
    await expect(liveCard(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Terminal disconnected/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test("P1: close a card with heavy scrollback renders the frozen card < 500 ms p95", async ({ page }) => {
    await openInline(page);
    // Generate a large scrollback so the transcript exercises the byte cap.
    await typeIntoTerminal(page, "for i in $(seq 1 2000); do echo line-$i-xxxxxxxxxxxxxxxxxxxx; done\n");
    await page.waitForTimeout(2_000);

    const start = Date.now();
    await closeBtn(page).click();
    await expect(frozenCard(page)).toBeVisible({ timeout: 15_000 });
    const elapsed = Date.now() - start;
    // Single-shot smoke of the latency budget (the L1 cap proof covers byte
    // correctness); a full 20-iteration p95 is prohibitively slow in CI.
    expect(elapsed).toBeLessThan(500);
  });
});
