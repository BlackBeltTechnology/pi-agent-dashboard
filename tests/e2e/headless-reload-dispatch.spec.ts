/**
 * `/reload` on a dashboard-spawned headless session, end to end.
 *
 * This is the browser half of the fix: the L1 suites prove the ladder picks
 * the keeper path, but only the harness proves that what the ladder writes is
 * a reload the running pi actually performs — without terminating it, and
 * with one honest terminal pill instead of the old unconditional `completed`.
 *
 * Covers test-plan #F1 (feedback is truthful and singular), #F2 (no
 * termination), #F3 (the session-record flap converges and keeps accumulated
 * state).
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
  cost?: number;
}

/**
 * Read the server's session record through the dashboard's OWN same-origin
 * REST from the page context (localhost-gated, so a page `fetch`
 * authenticates exactly like the app's own calls).
 *
 * `pid` is the observable for "the process was not replaced": a respawn mints
 * a new pi process and re-registers under a different PID, so an unchanged
 * PID across a reload is proof the in-process path ran.
 */
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
 * Flip the server's spawn strategy and report the previous value.
 *
 * The harness defaults to `tmux`, which has no RPC keeper — the very path this
 * change is about. Sessions spawned after this write are headless and
 * keeper-backed, so the ladder's step 1 is genuinely exercised instead of
 * silently falling through to the bridge.
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
      const label = code.nextElementSibling?.textContent?.trim() ?? "";
      out.push({ label });
    }
    return out;
  });
}

test.describe("headless /reload dispatch", () => {
  test("#F1/#F2/#F3 reloads in-process: one terminal pill, same PID, card converges", async ({
    page,
  }) => {
    // Land on the dashboard first so the same-origin config write is possible,
    // then spawn AFTER the strategy flip so the new session is keeper-backed.
    await gotoDashboard(page);
    const previousStrategy = await setSpawnStrategy(page, "headless");

    let sessionId: string | null = null;
    try {
      const card = await spawnFreshGitSession(page);
      sessionId = await card.getAttribute("data-session-id");
      expect(sessionId).toBeTruthy();
      await card.click();
      await dismissOverlays(page);
      await runReloadAssertions(page, sessionId as string);
    } finally {
      // Restore the harness default so sibling specs are unaffected — specs
      // share one container.
      await setSpawnStrategy(page, previousStrategy).catch(() => {});
    }
  });
});

async function runReloadAssertions(page: Page, sessionId: string): Promise<void> {
  {

    // Accrue some state so #F3's "accumulated fields survive the re-register"
    // is a real assertion rather than 0 === 0.
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 60_000 });

    const before = await readSession(page, sessionId);
    expect(before, "session record present before reload").toBeTruthy();
    const pidBefore = before?.pid;
    const tokensBefore = (before?.tokensIn ?? 0) + (before?.tokensOut ?? 0);
    expect(pidBefore, "harness session must be dashboard-spawned (has a PID)").toBeTruthy();
    expect(tokensBefore, "faux round-trip must have accrued tokens").toBeGreaterThan(0);

    await sendPrompt(page, "/reload");

    // ── #F1: exactly ONE `/reload` pill, and it TERMINATES ────────────────
    // The old bug shape was a pill stuck at "in progress" (server emitted an
    // ephemeral terminal that never survived reattach) or a false "completed"
    // for a reload that never ran. Either way the count-and-settle assertion
    // below is what fails on a revert.
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
    expect(pills[0].label, "reload must not report failure on a keeper session").toBe(
      "completed",
    );

    // ── #F3: the record flaps (session_shutdown → re-register) but converges,
    // and the accumulated token/cost fields survive that re-registration ────
    await expect
      .poll(
        async () => (await readSession(page, sessionId))?.status ?? "missing",
        { timeout: 60_000, message: "session card converges to a live status" },
      )
      .not.toBe("ended");

    const after = await readSession(page, sessionId);
    expect((after?.tokensIn ?? 0) + (after?.tokensOut ?? 0)).toBeGreaterThanOrEqual(
      tokensBefore,
    );

    // ── #F2: the pi process was NOT terminated ────────────────────────────
    expect(after?.pid, "reload must not respawn a keeper-backed session").toBe(pidBefore);

    // …and the session is still reachable, which a dead-but-recorded process
    // would not be.
    await sendPrompt(page, "[[faux:plain-text]] again");
    await expect(page.getByText(PLAIN_TEXT_MARKER).nth(1)).toBeVisible({ timeout: 60_000 });
  }
}
