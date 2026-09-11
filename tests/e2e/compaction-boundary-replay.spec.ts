import { expect, type Page, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Compaction-boundary replay parity (browser E2E, change:
 * replay-compaction-boundary, test-plan #F1/#F2).
 *
 * The live bridge forwards pi's `session_compact` event, which the client
 * reducer renders as the `── Session compacted ──` divider. Replay rebuilds
 * the transcript from pi's persisted `compaction` entry — both the server's
 * cold load from disk and the bridge's replay of the branch on reconnect —
 * and before this change had NO arm for the entry, so the divider vanished and
 * the summarized turns sat flush against the surviving ones.
 *
 * Shape mirrors `custom-entry-replay-parity.spec.ts`: drive the REAL paths
 * (dashboard-spawned session + real persisted entry), then assert the rebuilt
 * transcript. The compaction itself is made deterministic by the `e2e-custom`
 * fixture's `session_before_compact` handler (returns a canned result → no
 * faux summarization round-trip) plus the harness-seeded low
 * `compaction.keepRecentTokens` (see scripts/seed-settings-compaction.mjs), so
 * a few small turns are enough for a manual `/compact` to find a cut point.
 */
test.setTimeout(300_000);

/** The reducer's divider row. */
const DIVIDER = /Session compacted/;

async function dismissOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const overlay = page.getByTestId("propose-dialog-overlay");
    if (!(await overlay.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
}

/** Resolve the spawned session's card, open it, and wait for the composer. */
async function openFreshSession(page: Page): Promise<{ sessionId: string; composer: ReturnType<Page["getByPlaceholder"]> }> {
  const card = await spawnFreshGitSession(page);
  const sessionId = await card.getAttribute("data-session-id");
  expect(sessionId).toBeTruthy();
  await card.click();
  await dismissOverlays(page);

  // A cold container keeps the send button disabled until the bridge has wired
  // the session to the faux default model: prime the composer, wait, clear.
  const composer = page.getByPlaceholder(/message/i).first();
  await composer.waitFor({ state: "visible", timeout: 60_000 });
  await composer.fill("warmup");
  await expect(byTestId(page, "sendButton")).toBeEnabled({ timeout: 120_000 });
  await composer.fill("");
  return { sessionId: sessionId as string, composer };
}

/** Drive two plain turns around a real `/compact`. */
async function buildCompactedTranscript(page: Page): Promise<void> {
  await sendPrompt(page, "[[faux:thinking-text]] BEFORE-ALPHA");
  await expect(page.getByText(/done thinking/).first()).toBeVisible({ timeout: 60_000 });
  await sendPrompt(page, "[[faux:thinking-text]] BEFORE-BETA");
  await expect(page.getByText(/done thinking/).nth(1)).toBeVisible({ timeout: 60_000 });

  await sendPrompt(page, "/compact");
  await expect(page.getByText(DIVIDER)).toHaveCount(1, { timeout: 90_000 });

  // Content AFTER the boundary — the durability proof is that replay places the
  // divider between the two, not at the top.
  await sendPrompt(page, "[[faux:thinking-text]] AFTER-GAMMA");
  await expect(page.getByText(/done thinking/).nth(2)).toBeVisible({ timeout: 60_000 });
}

/** y-order of the first visible match for each text, top to bottom. */
async function assertVerticalOrder(page: Page, texts: RegExp[]): Promise<void> {
  const ys: number[] = [];
  for (const t of texts) {
    const loc = page.getByText(t).first();
    await expect(loc).toBeVisible({ timeout: 30_000 });
    const box = await loc.boundingBox();
    expect(box, `no bounding box for ${t}`).not.toBeNull();
    ys.push(box!.y);
  }
  for (let i = 1; i < ys.length; i++) {
    expect(ys[i], `${texts[i]} must sit below ${texts[i - 1]}`).toBeGreaterThan(ys[i - 1]);
  }
}

/** Wait for the dashboard to come back on a DIFFERENT process. */
async function restartServer(page: Page): Promise<void> {
  let before: { pid?: number; startedAt?: string } | null = null;
  try {
    const res = await page.request.get("/api/health", { timeout: 5_000 });
    if (res.ok()) before = await res.json();
  } catch {
    /* already down */
  }
  await page.request.post("/api/restart", { timeout: 10_000 }).catch(() => {
    // The server tears the socket down mid-response — expected on success.
  });
  await expect
    .poll(
      async () => {
        try {
          const res = await page.request.get("/api/health", { timeout: 5_000 });
          if (!res.ok()) return "down";
          const now = await res.json();
          if (!before) return "up";
          return now.pid !== before.pid || now.startedAt !== before.startedAt ? "restarted" : "old";
        } catch {
          return "down";
        }
      },
      { timeout: 120_000, intervals: [1_000] },
    )
    .toBe(before ? "restarted" : "up");
}

test.describe("compaction boundary — replay parity", () => {
  /**
   * #F1 — a session whose events were EVICTED is rebuilt from the session file
   * (server cold load). The synthesized boundary must land between the entries
   * around it.
   */
  test("#F1 cold reload rebuilds exactly one boundary between content", async ({ page }) => {
    const { sessionId } = await openFreshSession(page);
    await buildCompactedTranscript(page);

    // Drop the in-memory buffer for real: a server restart also ends the
    // dashboard-spawned pi, so reopening the card is a pure disk cold load.
    await restartServer(page);
    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });

    const card = page.locator(
      `[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`,
    );
    await card.waitFor({ state: "visible", timeout: 90_000 });
    await card.click();

    await expect(page.getByText(DIVIDER)).toHaveCount(1, { timeout: 90_000 });
    await assertVerticalOrder(page, [/BEFORE-BETA/, DIVIDER, /AFTER-GAMMA/]);
    // The persisted summary is context, not transcript content.
    await expect(page.getByText(/E2E-COMPACTION-SUMMARY/)).toHaveCount(0);
  });

  /**
   * #F2 — a session already showing the boundary live is re-registered after a
   * bridge reconnect, which replays the branch. The register-time reset either
   * wipes and re-reduces or drops the replayed insert; either way the view must
   * still carry exactly ONE boundary (never two, never zero).
   */
  test("#F2 reconnect replay does not duplicate or drop the boundary", async ({ page }) => {
    // `/reload` respawns a headless pi (the harness default is tmux, whose
    // reload is a no-op without a one-time in-TUI opt-in). The respawn
    // re-registers the SAME session and replays its branch — the reconnect
    // path under test. Mirrors headless-reload-dispatch.spec.ts.
    const spawnRes = await page.request.get("/api/config");
    const prev = ((await spawnRes.json())?.data?.spawnStrategy as string) ?? "tmux";
    await page.request.put("/api/config", { data: { spawnStrategy: "headless" } });

    try {
      const { sessionId } = await openFreshSession(page);
      await buildCompactedTranscript(page);

      const readPid = async (): Promise<number | undefined> =>
        page.evaluate(async (sid: string) => {
          const body = (await (await fetch("/api/sessions")).json()) as {
            data?: Array<{ id: string; pid?: number }>;
          };
          return body.data?.find((s) => s.id === sid)?.pid;
        }, sessionId);
      const pidBefore = await readPid();

      await sendPrompt(page, "/reload");
      await expect
        .poll(
          async () => {
            const pid = await readPid();
            return pid !== undefined && pid !== pidBefore ? "respawned" : "same";
          },
          { timeout: 150_000, intervals: [1_000] },
        )
        .toBe("respawned");

      // Let the replayed branch land, then assert the invariant holds after the
      // replay completes — a duplication would arrive with the replay frames.
      await expect(page.getByText(/AFTER-GAMMA/)).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(8_000);
      await expect(page.getByText(DIVIDER)).toHaveCount(1, { timeout: 60_000 });
      await assertVerticalOrder(page, [/BEFORE-BETA/, DIVIDER, /AFTER-GAMMA/]);
    } finally {
      await page.request.put("/api/config", { data: { spawnStrategy: prev } }).catch(() => {});
    }
  });
});
