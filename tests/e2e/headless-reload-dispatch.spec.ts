/**
 * `/reload` on a dashboard-spawned headless session, end to end.
 *
 * The L1 suites prove the ladder picks the respawn path; only the harness
 * proves the respawn actually completes — the session comes back, keeps its
 * accumulated state, and answers prompts again — and that the operator sees
 * exactly one honest terminal pill instead of the old unconditional
 * `completed`.
 *
 * Covers test-plan #F1 (feedback is truthful and singular), #F2 (the process
 * is replaced, not orphaned), #F3 (the session-record flap converges and
 * accumulated state survives).
 *
 * See change: fix-out-of-band-reload.
 */
import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

const PLAIN_TEXT_MARKER = "The quick brown faux jumps over the lazy dog.";

interface SessionShape {
  id: string;
  status?: string;
  pid?: number;
  tokensIn?: number;
  tokensOut?: number;
}

/**
 * Flip the server's spawn strategy and report the previous value.
 *
 * The harness defaults to `tmux`, which has no registered PID and therefore
 * never exercises the respawn path this change is about. Sessions spawned
 * after this write are headless.
 */
async function setSpawnStrategy(page: Page, strategy: string): Promise<string> {
  return page.evaluate(async (next: string) => {
    const cur = await (await fetch("/api/config")).json();
    const prev = cur?.data?.spawnStrategy ?? "tmux";
    await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spawnStrategy: next }),
    });
    return prev as string;
  }, strategy);
}

/** Read the server's session record via the dashboard's own same-origin REST. */
async function readSession(page: Page, sessionId: string): Promise<SessionShape | undefined> {
  return page.evaluate(async (sid: string) => {
    const res = await fetch("/api/sessions");
    if (!res.ok) return undefined;
    const body = (await res.json()) as { data?: SessionShape[] };
    const list = Array.isArray(body?.data) ? body.data : [];
    return list.find((s) => s.id === sid);
  }, sessionId);
}

/**
 * A spawn can leave the OpenSpec propose dialog open; its overlay intercepts
 * pointer events on the composer. Escape it before driving the UI.
 */
async function dismissOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const overlay = page.getByTestId("propose-dialog-overlay");
    if (!(await overlay.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
}

/** Every rendered `/reload` command-feedback pill, with its status label. */
async function reloadPills(page: Page): Promise<Array<{ label: string }>> {
  return page.evaluate(() => {
    const out: Array<{ label: string }> = [];
    for (const code of Array.from(document.querySelectorAll("code"))) {
      if (code.textContent?.trim() !== "/reload") continue;
      out.push({ label: code.nextElementSibling?.textContent?.trim() ?? "" });
    }
    return out;
  });
}

test.describe("headless /reload", () => {
  test("#F1/#F2/#F3 respawns: one terminal pill, session converges, state survives", async ({
    page,
  }) => {
    await gotoDashboard(page);
    const previousStrategy = await setSpawnStrategy(page, "headless");

    try {
      const card = await spawnFreshGitSession(page);
      const sessionId = await card.getAttribute("data-session-id");
      expect(sessionId).toBeTruthy();
      await card.click();
      await dismissOverlays(page);
      await runReloadAssertions(page, sessionId as string);
    } finally {
      // Restore the harness default — specs share one container.
      await setSpawnStrategy(page, previousStrategy).catch(() => {});
    }
  });
});

async function runReloadAssertions(page: Page, sessionId: string): Promise<void> {
  // Accrue state so #F3's "accumulated fields survive the re-register" is a
  // real assertion rather than 0 === 0.
  await sendPrompt(page, "[[faux:plain-text]] go");
  await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 60_000 });

  const before = await readSession(page, sessionId);
  expect(before, "session record present before reload").toBeTruthy();
  const pidBefore = before?.pid;
  const tokensBefore = (before?.tokensIn ?? 0) + (before?.tokensOut ?? 0);
  expect(pidBefore, "harness session must be dashboard-spawned (has a PID)").toBeTruthy();
  expect(tokensBefore, "faux round-trip must have accrued tokens").toBeGreaterThan(0);

  await sendPrompt(page, "/reload");

  // ── #F1: exactly ONE `/reload` pill, and it TERMINATES ──────────────────
  // The old bug shape was an unconditional `completed` for a reload that never
  // ran. The count-and-settle assertion is what fails on a revert.
  await expect
    .poll(
      async () => {
        const pills = await reloadPills(page);
        if (pills.length !== 1) return `pills=${pills.length}`;
        return pills[0].label;
      },
      { timeout: 60_000, message: "exactly one terminal /reload pill" },
    )
    .toMatch(/^(completed|failed)$/);

  const pills = await reloadPills(page);
  expect(pills, "no duplicate /reload pill").toHaveLength(1);
  expect(pills[0].label, "reload must not report failure on a headless session").toBe(
    "completed",
  );

  // ── #F3: the record flaps (session_shutdown → re-register) but converges ─
  await expect
    .poll(async () => (await readSession(page, sessionId))?.status ?? "missing", {
      timeout: 120_000,
      message: "session converges to a live status after the respawn",
    })
    .not.toBe("ended");

  const after = await readSession(page, sessionId);
  expect((after?.tokensIn ?? 0) + (after?.tokensOut ?? 0)).toBeGreaterThanOrEqual(tokensBefore);

  // ── #F2: the process was REPLACED, not left orphaned ────────────────────
  // A respawn mints a new pi and re-registers under a new PID. An unchanged
  // PID here would mean the kill or the respawn silently did nothing.
  expect(after?.pid, "respawn must register a new pi process").not.toBe(pidBefore);

  // …and the reloaded session is reachable, which a half-dead respawn is not.
  await sendPrompt(page, "[[faux:plain-text]] again");
  await expect(page.getByText(PLAIN_TEXT_MARKER).nth(1)).toBeVisible({ timeout: 60_000 });
}
