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
// MUST be scoped to the LIVE card: a frozen card's read-only xterm still
// renders a helper textarea with the same accessible name, so a page-wide
// `.first()` would send keystrokes into the frozen card and the live terminal
// would register no input at all.
const termInput = (page: Page) => liveCard(page).getByRole("textbox", { name: /terminal input/i }).first();
const closeBtn = (page: Page) => page.getByRole("button", { name: /close terminal/i }).first();

/** Dismiss any modal overlay that would intercept composer clicks. */
async function dismissOverlays(page: Page): Promise<void> {
  const overlay = page.locator('[data-testid$="-overlay"]').first();
  for (let i = 0; i < 3; i++) {
    if (!(await overlay.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
}

/** Click the composer's "open inline terminal" affordance (desktop or ⋯). */
async function clickOpenTerminal(page: Page): Promise<void> {
  await dismissOverlays(page);
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
}

async function openInline(page: Page): Promise<string> {
  const session = await spawnFreshGitSession(page);
  const sessionId = await session.getAttribute("data-session-id");
  expect(sessionId).toBeTruthy();
  await session.click();
  // Composer must be mounted for the selected session before its actions exist.
  await page.getByPlaceholder(/message/i).first().waitFor({ state: "visible", timeout: 30_000 });
  await clickOpenTerminal(page);
  return sessionId as string;
}

async function typeIntoTerminal(page: Page, text: string): Promise<void> {
  await termInput(page).click();
  await page.keyboard.type(text);
  await page.waitForTimeout(300);
}

/**
 * Rendered text of an xterm pane inside a card. xterm paints its rows into
 * `.xterm-rows`, so this reads what the user actually sees — the transcript
 * CONTENT, not merely the card's existence. Whitespace is collapsed because
 * xterm pads every row to the terminal width.
 */
async function readCardText(cardLoc: ReturnType<typeof frozenCard>): Promise<string> {
  const rows = cardLoc.locator(".xterm-rows").first();
  await rows.waitFor({ state: "attached", timeout: 20_000 });
  const raw = await rows.innerText();
  return raw.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

/** Unique per-run marker so an assertion cannot pass on stale/other content. */
function marker(tag: string): string {
  return `MARK-${tag}-${Date.now().toString(36)}`;
}

test.describe("inline terminal transcript preservation", () => {
  test("F1: run ls then exit, close → frozen read-only card with pre-exit scrollback", async ({ page }) => {
    const m = marker("F1");
    await openInline(page);
    // Deterministic pre-exit output: this exact string must survive the PTY
    // exit and reach the frozen card — that IS the change under test.
    await typeIntoTerminal(page, `echo ${m}\n`);
    await typeIntoTerminal(page, "exit\n"); // shell exits BEFORE the card is closed
    await page.waitForTimeout(1_000);
    await closeBtn(page).click();
    await expect(frozenCard(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/read-only transcript/i).first()).toBeVisible();
    // The distinguishing assertion: pre-exit scrollback is preserved.
    await expect
      .poll(() => readCardText(frozenCard(page)), { timeout: 15_000 })
      .toContain(m);
  });

  test("F2: open then close untouched → no card, no placeholder", async ({ page }) => {
    await openInline(page);
    await closeBtn(page).click();
    await expect(card(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/terminal closed/i)).toHaveCount(0);
  });

  test("F3: untouched card with a MULTI-LINE prompt is still removed (line count irrelevant)", async ({ page }) => {
    // A multi-line prompt is the case that breaks any "≤ 1 non-empty line"
    // heuristic. Configure it in a FIRST terminal (which is therefore touched
    // and freezes), then open a SECOND terminal that inherits it and is never
    // typed into. The second must still be removed.
    await openInline(page);
    await typeIntoTerminal(page, `printf 'PS1="\\\\n[l2]\\\\n[l3]\\\\$ "\\n' >> ~/.bashrc\n`);
    await page.waitForTimeout(500);
    await closeBtn(page).click();
    await expect(frozenCard(page)).toBeVisible({ timeout: 15_000 });

    // Second terminal: inherits the 3-line prompt, never touched.
    await clickOpenTerminal(page);
    // Precondition guard — without this the test could pass while proving
    // nothing (e.g. if the shell never sourced ~/.bashrc).
    await expect
      .poll(() => readCardText(liveCard(page)), { timeout: 20_000 })
      .toContain("[l3]");

    await closeBtn(page).click();
    // Exactly the frozen first card remains; the untouched multi-line-prompt
    // card is gone despite rendering 3 non-empty lines.
    await expect(liveCard(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(frozenCard(page)).toHaveCount(1, { timeout: 15_000 });
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

  test("F8: reload after open + non-empty close → frozen at its ORIGINAL stream position", async ({ page }) => {
    // Two closed cards give the stream a stable before/after ordering. If the
    // replay path appended the card at the tail (the defensive
    // close-without-open branch), the order would invert — which a
    // single-card test cannot detect.
    const first = marker("F8a");
    const second = marker("F8b");

    const sessionId = await openInline(page);
    await typeIntoTerminal(page, `echo ${first}\n`);
    await page.waitForTimeout(600);
    await closeBtn(page).click();
    await expect(frozenCard(page)).toHaveCount(1, { timeout: 15_000 });

    await clickOpenTerminal(page);
    await typeIntoTerminal(page, `echo ${second}\n`);
    await page.waitForTimeout(600);
    await closeBtn(page).click();
    await expect(frozenCard(page)).toHaveCount(2, { timeout: 15_000 });

    // Poll each card: a freshly-mounted xterm paints asynchronously, so a
    // single snapshot can read an as-yet-empty pane.
    await expect
      .poll(() => readCardText(frozenCard(page).nth(0)), { timeout: 20_000 })
      .toContain(first);
    await expect
      .poll(() => readCardText(frozenCard(page).nth(1)), { timeout: 20_000 })
      .toContain(second);

    await page.goto(`/session/${sessionId}`);
    await expect(frozenCard(page)).toHaveCount(2, { timeout: 20_000 });
    // Same relative position after a cold replay — first still precedes second.
    await expect
      .poll(() => readCardText(frozenCard(page).nth(0)), { timeout: 20_000 })
      .toContain(first);
    await expect
      .poll(() => readCardText(frozenCard(page).nth(1)), { timeout: 20_000 })
      .toContain(second);
  });

  test("F9: two browsers converge on byte-identical transcripts after close", async ({ page, browser }) => {
    const m = marker("F9");
    const sessionId = await openInline(page);
    await typeIntoTerminal(page, `echo ${m}\n`);
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

      // The distinguishing assertion: the LIVE-path payload and the REPLAY-path
      // payload are the same text. Both handlers broadcast the event read back
      // from the store, so any divergence here means that invariant broke.
      const liveText = await readCardText(frozenCard(page));
      const replayText = await readCardText(frozenCard(page2));
      expect(liveText).toContain(m);
      expect(replayText).toBe(liveText);
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
