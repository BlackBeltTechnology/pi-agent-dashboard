/**
 * Extension slash command dispatch, in-process, end to end.
 *
 * The L1 suites prove `tryDispatchExtensionCommand` emits the right
 * `command_feedback` sequence against a stub pi; only the harness proves the
 * REAL bridge reaches core `AgentSession.prompt()` with
 * `expandPromptTemplates: true`, that pi executes the extension handler instead
 * of handing the text to the model, and that the terminal pill survives a
 * browser reload (the persisted-then-broadcast contract that makes reattach
 * work).
 *
 * Target: `/dashboard-where` — the bridge's OWN registered extension command
 * (`pi.registerCommand("dashboard-where")`, `source:"extension"`, not
 * `__`-prefixed). Its handler writes to stderr and never starts an agent turn,
 * so "no model turn" is a directly observable property (flat token counters,
 * one transcript occurrence).
 *
 * Covers test-plan F1 (rendered convergence, headless) and F2 (reattach replay).
 * F4 (terminal-hosted pi in tmux, judged by hand) stays manual-only — the
 * container has no terminal-hosted pi.
 *
 * See change: retire-slash-dispatch-via-expand-prompt-templates.
 */
import { expect, type Page, test } from "./fixtures.js";
import { byTestId, gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

const COMMAND = "/dashboard-where";

interface SessionShape {
  id: string;
  status?: string;
  tokensIn?: number;
  tokensOut?: number;
}

/**
 * Flip the server's spawn strategy and report the previous value.
 *
 * The harness defaults to `tmux`. Headless is the shape this change targets in
 * the harness (the retired Path C was headless-only); the tmux/terminal shape
 * the change also fixes is covered by the manual F4 row.
 */
async function setSpawnStrategy(page: Page, strategy: string): Promise<string> {
  return page.evaluate(async (next: string) => {
    const cur = await fetch("/api/config").then((r) => r.json());
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
 *
 * Presence is probed via the dialog's own `propose-name` input — the
 * `propose-dialog-overlay` testid three older specs use does not exist in the
 * client, so their version of this guard could never fire
 * (`compaction-boundary-replay.spec.ts`, `headless-reload-dispatch.spec.ts`).
 */
async function dismissOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const dialog = page.getByTestId("propose-name");
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
}

/**
 * Every rendered command-feedback pill for `command`, with its status label.
 *
 * `CommandFeedbackCard` renders `<code>{command}</code><span>{label}</span>`
 * with no testid, so the DOM walk mirrors `headless-reload-dispatch.spec.ts`.
 */
async function pillsFor(page: Page, command: string): Promise<Array<{ label: string }>> {
  return page.evaluate((cmd: string) => {
    const out: Array<{ label: string }> = [];
    for (const code of Array.from(document.querySelectorAll("code"))) {
      if (code.textContent?.trim() !== cmd) continue;
      out.push({ label: code.nextElementSibling?.textContent?.trim() ?? "" });
    }
    return out;
  }, command);
}

/** How many times `needle` appears in the visible transcript. */
async function transcriptOccurrences(page: Page, needle: string): Promise<number> {
  const text = await page.getByTestId("chat-scroll-container").innerText();
  return text.split(needle).length - 1;
}

/**
 * Number of RENDERED chat rows in the transcript.
 *
 * Virtual rows carry `data-index` (the same signal
 * `chat-transcript-virtualization.spec.ts` counts), so this is the direct
 * "no user row, no assistant row" observable: a model turn or a fall-through to
 * the composer would each add a row.
 */
async function chatRowCount(page: Page): Promise<number> {
  return page.locator('[data-testid="chat-scroll-container"] [data-index]').count();
}

async function openFreshHeadlessSession(page: Page): Promise<string> {
  const card = await spawnFreshGitSession(page);
  const sessionId = await card.getAttribute("data-session-id");
  expect(sessionId, "spawned session must carry a data-session-id").toBeTruthy();
  await card.click();
  await dismissOverlays(page);
  return sessionId as string;
}

test.describe("extension slash dispatch (in-process)", () => {
  test("#F1 renders a completed pill, sends no model turn, never errors", async ({ page }) => {
    await gotoDashboard(page);
    const previousStrategy = await setSpawnStrategy(page, "headless");

    try {
      const sessionId = await openFreshHeadlessSession(page);
      const before = await readSession(page, sessionId);
      // Presence is REQUIRED, not incidental: a failed `/api/sessions` read
      // returns `undefined`, and the token comparison below would then be
      // `0 === 0` — passing for the wrong reason.
      expect(before, "session record must be readable before the dispatch").toBeTruthy();
      const tokensBefore = (before?.tokensIn ?? 0) + (before?.tokensOut ?? 0);

      await sendPrompt(page, COMMAND);

      // ── the pill converges to `completed` ─────────────────────────────────
      await expect
        .poll(async () => (await pillsFor(page, COMMAND)).map((p) => p.label).join("|"), {
          timeout: 10_000,
          intervals: [200, 400, 800],
        })
        .toBe("completed");

      // ── no error pill ever rendered for this command ──────────────────────
      const labels = (await pillsFor(page, COMMAND)).map((p) => p.label);
      expect(labels).toEqual(["completed"]);

      // ── no model turn: the command text is NOT echoed as a user row ───────
      // A user row would add a second occurrence alongside the pill's <code>.
      // Poll so a momentarily-visible optimistic bubble settles rather than
      // flakes; the settle IS the assertion when the bridge drops it.
      await expect
        .poll(async () => transcriptOccurrences(page, COMMAND), {
          timeout: 10_000,
          intervals: [200, 400, 800],
        })
        .toBe(1);

      // ── no assistant row and no user row: exactly ONE chat row (the pill) ─
      // The pill's own <code> accounts for the single `/dashboard-where`
      // occurrence asserted above; a user-row echo would make it two, and any
      // model turn would add a row here.
      await expect
        .poll(async () => chatRowCount(page), { timeout: 10_000, intervals: [200, 400, 800] })
        .toBe(1);

      // ── no model turn: token counters did not move ────────────────────────
      // The handler writes to stderr only. A fall-through to the LLM (the exact
      // regression this change closes) would consume tokens.
      const after = await readSession(page, sessionId);
      expect(after, "session record must be readable after the dispatch").toBeTruthy();
      expect((after?.tokensIn ?? 0) + (after?.tokensOut ?? 0)).toBe(tokensBefore);
    } finally {
      // Specs share one container — restore the harness default.
      await setSpawnStrategy(page, previousStrategy).catch(() => {});
    }
  });

  test("#F2 the terminal pill survives a page reload and session reattach", async ({ page }) => {
    await gotoDashboard(page);
    const previousStrategy = await setSpawnStrategy(page, "headless");

    try {
      const sessionId = await openFreshHeadlessSession(page);

      await sendPrompt(page, COMMAND);
      await expect
        .poll(async () => (await pillsFor(page, COMMAND)).map((p) => p.label).join("|"), {
          timeout: 10_000,
          intervals: [200, 400, 800],
        })
        .toBe("completed");

      // Reload: the pill must be rebuilt from the REPLAYED persisted event, not
      // from live state. A broadcast-only terminal (no `insertEvent`) would
      // leave the bridge's persisted `started` and render "in progress" here.
      await page.reload();
      await byTestId(page, "headerAppBar").waitFor({ state: "visible" });

      const card = page.locator(
        `[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`,
      );
      await card.waitFor({ state: "visible", timeout: 60_000 });
      await card.click();
      await dismissOverlays(page);

      await expect
        .poll(async () => (await pillsFor(page, COMMAND)).map((p) => p.label).join("|"), {
          timeout: 30_000,
          intervals: [300, 600, 1200],
        })
        .toBe("completed");
    } finally {
      await setSpawnStrategy(page, previousStrategy).catch(() => {});
    }
  });
});
