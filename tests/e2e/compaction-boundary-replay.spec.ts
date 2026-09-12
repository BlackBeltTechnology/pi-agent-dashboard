import { expect, type Page, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Compaction-boundary replay parity (browser E2E, change:
 * replay-compaction-boundary, test-plan #F1/#F2).
 *
 * The live bridge forwards pi's `session_compact` event, which the client
 * reducer renders as the `── Session compacted ──` divider. Replay rebuilds
 * the transcript from pi's persisted `compaction` entry and before this change
 * had NO arm for the entry, so the divider vanished and the summarized turns
 * sat flush against the surviving ones.
 *
 * Shape mirrors `custom-entry-replay-parity.spec.ts`: drive the REAL paths
 * (dashboard-spawned session + real persisted entry), then assert the rebuilt
 * transcript. The compaction itself is made deterministic by the `e2e-custom`
 * fixture's `session_before_compact` handler (returns a canned result → no
 * faux summarization round-trip) plus the harness-seeded low
 * `compaction.keepRecentTokens` (see scripts/seed-settings-compaction.mjs), so
 * a few small turns are enough for a manual `/compact` to find a cut point.
 *
 * ── Scope note: which producer these rows can reach ─────────────────────────
 * `replayEntriesAsEvents` has two producers: the bridge's `getBranch()` replay
 * and the server's disk cold load. These rows exercise the BRIDGE producer
 * (via `/reload`, which respawns pi, re-registers the session and re-forwards
 * its branch after the server's register-time store wipe). A live disk
 * cold load is NOT reachable from this harness: `POST /api/restart` exits the
 * container's main process, and `compose.test.yml`'s `restart: unless-stopped`
 * respawns the container — the `pi-state` tmpfs (where session JSONL lives) is
 * RAM-backed and wiped on restart, so the file the cold load needs is gone
 * before the server can read it. The disk producer is instead gated
 * deterministically at L2 by `loadAndReplay` over a real session file in
 * `packages/server/src/__tests__/session-load-worker.test.ts`.
 */
test.setTimeout(360_000);

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

/** Pin the harness to headless spawns for the duration of `fn` (restored after). */
async function withHeadlessSpawn<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  const res = await page.request.get("/api/config");
  const prev = ((await res.json())?.data?.spawnStrategy as string) ?? "tmux";
  await page.request.put("/api/config", { data: { spawnStrategy: "headless" } });
  try {
    return await fn();
  } finally {
    await page.request.put("/api/config", { data: { spawnStrategy: prev } }).catch(() => {});
  }
}

/** Spawn a session, open it, and wait until the composer can actually send. */
async function openFreshSession(
  page: Page,
): Promise<{ sessionId: string; composer: ReturnType<Page["getByPlaceholder"]> }> {
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

/** Read the session's live pid from the dashboard's own REST. */
async function readPid(page: Page, sessionId: string): Promise<number | undefined> {
  return page.evaluate(async (sid: string) => {
    const body = (await (await fetch("/api/sessions")).json()) as {
      data?: Array<{ id: string; pid?: number }>;
    };
    return body.data?.find((s) => s.id === sid)?.pid;
  }, sessionId);
}

/**
 * Force a bridge reconnect + branch replay: `/reload` respawns the headless pi,
 * which re-registers the SAME session and replays `getBranch()`. The server
 * wipes the store on the changed entry count and the client re-reduces the
 * replayed stream — the register-time reset gate the spec's R3 rides.
 */
async function forceBridgeReplay(page: Page, sessionId: string): Promise<void> {
  const before = await readPid(page, sessionId);
  await sendPrompt(page, "/reload");
  await expect
    .poll(async () => ((await readPid(page, sessionId)) ?? before) !== before, {
      timeout: 150_000,
      intervals: [1_000],
    })
    .toBe(true);

  // Terminal condition for the register-wipe → replay cycle: the client clears
  // the transcript on `session_state_reset` and the replayed frames rebuild it.
  // The replay ends when frames stop arriving, so poll until the rendered row
  // count is non-zero and unchanged across samples. A fixed sleep either races
  // a slow replay or (worse) samples before a late duplicate lands.
  let previousRows = -1;
  await expect
    .poll(
      async () => {
        const rows = await page.getByText(/done thinking/).count();
        const settled = rows > 0 && rows === previousRows;
        previousRows = rows;
        return settled;
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toBe(true);
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

test.describe("compaction boundary — replay parity", () => {
  /**
   * #F1 — a session whose events were evicted is rebuilt by replay, and the
   * synthesized boundary must land between the entries around it.
   */
  test("#F1 replay rebuilds exactly one boundary between content", async ({ page }) => {
    await withHeadlessSpawn(page, async () => {
      const { sessionId } = await openFreshSession(page);
      await buildCompactedTranscript(page);

      await forceBridgeReplay(page, sessionId);

      await expect(page.getByText(DIVIDER)).toHaveCount(1, { timeout: 90_000 });
      await assertVerticalOrder(page, [/BEFORE-BETA/, DIVIDER, /AFTER-GAMMA/]);
      // The persisted summary is context, not transcript content.
      await expect(page.getByText(/E2E-COMPACTION-SUMMARY/)).toHaveCount(0);
    });
  });

  /**
   * #F2 — a session already showing the boundary live is re-registered TWICE.
   * The register-time reset either wipes and re-reduces or drops the replayed
   * insert; either way the view must still carry exactly ONE boundary — never
   * two (accumulating duplicates), never zero (a dropped divider).
   */
  test("#F2 repeated reconnect replays never duplicate or drop the boundary", async ({ page }) => {
    await withHeadlessSpawn(page, async () => {
      const { sessionId } = await openFreshSession(page);
      await buildCompactedTranscript(page);
      await expect(page.getByText(DIVIDER)).toHaveCount(1);

      for (const round of [1, 2]) {
        await forceBridgeReplay(page, sessionId);
        await expect(page.getByText(/AFTER-GAMMA/)).toBeVisible({ timeout: 60_000 });
        await expect(
          page.getByText(DIVIDER),
          `round ${round}: exactly one boundary after the replay`,
        ).toHaveCount(1, { timeout: 60_000 });
      }
    });
  });
});
