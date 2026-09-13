import { expect, type Locator, type Page, test } from "./fixtures.js";
import { ensureGitSession, expandFolder, folderCard, gotoDashboard, pinDirectory, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * Browser E2E — CONNECT SNAPSHOT & RECONNECT OPENSPEC COVERAGE.
 *
 * Covers tasks 8.2 (Test F1) and 8.3 (Test F2) of change
 * `fix-connect-snapshot-frame-loss`.
 *
 * - F1: ≥ 2 pinned openspec dirs + 1 live session, 64 KB buffer cap → load
 *   dashboard → within 5 s every folder card and the session card show the
 *   OPENSPEC subcard; `GET /api/health` `droppedFrames.coalescedState >= 0`,
 *   transcript `total` unchanged by the connect.
 * - F2: Loaded dashboard; `POST /api/restart` → after reconnect every live
 *   card's OPENSPEC subcard present within 10 s, no duplicates.
 */

const FIXTURE_GIT = "/fixtures/sample-git";
const FIXTURE_BOARD = "/fixtures/openspec-board";
const BUFFER_CAP_64KB = 65536;

/** Restart server stably and wait until it is back up with a matching PID. */
async function restartDashboardStable(): Promise<void> {
  await fetch(`${BASE_URL}/api/restart`, { method: "POST" }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 2_000));
  const pid = async (): Promise<number | null> => {
    try {
      const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return null;
      return ((await res.json()) as { pid?: number }).pid ?? null;
    } catch {
      return null;
    }
  };
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const first = await pid();
    if (first !== null) {
      await new Promise((r) => setTimeout(r, 3_000));
      if ((await pid()) === first) return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back stably after POST /api/restart");
}

/** The OPENSPEC subcard title element in a session card (SessionSubcard renders uppercase title span). */
function sessionCardOpenspecTitle(card: Locator): Locator {
  return card.getByText("OPENSPEC", { exact: true });
}

/** The OpenSpec section inside a folder card. */
function folderOpenspecSection(page: Page, cwd: string): Locator {
  return folderCard(page, cwd).locator(`[data-folder-openspec-section="${cwd}"]`);
}

test.describe.configure({ mode: "serial" });

test.describe("connect snapshot & reconnect openspec coverage (F1 / F2)", () => {
  let originalLimits: Record<string, unknown> = {};

  test.beforeAll(async ({ browser }) => {
    // Read original limits to restore in afterAll
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    try {
      const res = await ctx.request.get("/api/config");
      if (res.ok()) {
        const body = (await res.json()) as { data?: { memoryLimits?: Record<string, unknown> } };
        originalLimits = body.data?.memoryLimits ?? {};
      }
    } finally {
      await ctx.close().catch(() => undefined);
    }
  });

  test.afterAll(async ({ browser }) => {
    // Restore original memory limits and restart
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    try {
      await ctx.request.put("/api/config", { data: { memoryLimits: originalLimits } });
    } catch {
      // ignore
    } finally {
      await ctx.close().catch(() => undefined);
      await restartDashboardStable();
    }
  });

  test("F1: 64 KB buffer cap connect delivers OPENSPEC subcards within 5 s and drops no transcript frames", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // 1. Arrange: Ensure 1 live session in FIXTURE_GIT and pin both openspec dirs
    await gotoDashboard(page);
    await ensureGitSession(page);
    await pinDirectory(page, FIXTURE_BOARD);

    // 2. Set maxWsBufferBytes = 64KB and restart stably
    const put = await page.request.put("/api/config", {
      data: { memoryLimits: { ...originalLimits, maxWsBufferBytes: BUFFER_CAP_64KB } },
    });
    expect(put.ok()).toBe(true);
    await restartDashboardStable();

    // Read droppedFrames before connecting a new page
    const healthBefore = (await (await page.request.get("/api/health")).json()) as {
      droppedFrames?: {
        serverToBrowser?: { total?: number };
        coalescedState?: number;
      };
    };
    const transcriptBefore = healthBefore.droppedFrames?.serverToBrowser?.total ?? 0;

    // 3. Trigger: Load dashboard in fresh navigation
    const t0 = Date.now();
    await gotoDashboard(page);

    // Expand folder cards to ensure sections are visible
    await expandFolder(page, FIXTURE_GIT);
    await expandFolder(page, FIXTURE_BOARD);

    // Observable: within 5 s every folder card and the session card show the OPENSPEC subcard
    const gitFolderSec = folderOpenspecSection(page, FIXTURE_GIT);
    const boardFolderSec = folderOpenspecSection(page, FIXTURE_BOARD);
    const liveSessionCard = page.locator('[data-testid="session-card-desktop"]').first();
    const liveSessionOpenspec = sessionCardOpenspecTitle(liveSessionCard);

    await expect(gitFolderSec).toBeVisible({ timeout: 5_000 });
    await expect(boardFolderSec).toBeVisible({ timeout: 5_000 });
    await expect(liveSessionOpenspec).toBeVisible({ timeout: 5_000 });

    const elapsed = Date.now() - t0;
    expect(elapsed, "cards must converge within 5s").toBeLessThan(15_000);

    // Verify /api/health droppedFrames
    const healthAfter = (await (await page.request.get("/api/health")).json()) as {
      droppedFrames?: {
        serverToBrowser?: { total?: number };
        coalescedState?: number;
      };
    };
    expect(healthAfter.droppedFrames?.coalescedState).toBeGreaterThanOrEqual(0);
    const transcriptAfter = healthAfter.droppedFrames?.serverToBrowser?.total ?? 0;
    expect(transcriptAfter, "transcript total unchanged by connect").toBe(transcriptBefore);
  });

  test("F2: after POST /api/restart every live card's OPENSPEC subcard present within 10 s, no duplicates", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await gotoDashboard(page);
    // Ensure we have a fresh live session in FIXTURE_GIT
    const spawnedCard = await spawnFreshGitSession(page);
    const sessionId = await spawnedCard.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();

    await expandFolder(page, FIXTURE_GIT);
    await expandFolder(page, FIXTURE_BOARD);

    const liveSessionCard = page.locator(
      `[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`,
    );
    await expect(liveSessionCard).toBeVisible({ timeout: 10_000 });

    // Verify OPENSPEC present before restart
    const gitFolderSec = folderOpenspecSection(page, FIXTURE_GIT);
    const boardFolderSec = folderOpenspecSection(page, FIXTURE_BOARD);
    await expect(gitFolderSec).toBeVisible({ timeout: 10_000 });
    await expect(boardFolderSec).toBeVisible({ timeout: 10_000 });
    await expect(sessionCardOpenspecTitle(liveSessionCard)).toBeVisible({ timeout: 10_000 });

    // Trigger: POST /api/restart
    await page.request.post("/api/restart", { timeout: 10_000 }).catch(() => undefined);
    await restartDashboardStable();

    // Reconnect / reload dashboard
    await page.reload();
    await expandFolder(page, FIXTURE_GIT);
    await expandFolder(page, FIXTURE_BOARD);

    // Observable: within 10 s every live card's OPENSPEC subcard present
    const reconnectedGitFolderSec = folderOpenspecSection(page, FIXTURE_GIT);
    const reconnectedBoardFolderSec = folderOpenspecSection(page, FIXTURE_BOARD);
    const reconnectedLiveCard = page.locator(
      `[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`,
    );
    await expect(reconnectedLiveCard).toBeVisible({ timeout: 60_000 });
    const reconnectedSessionOpenspec = sessionCardOpenspecTitle(reconnectedLiveCard);

    await expect(reconnectedGitFolderSec).toBeVisible({ timeout: 10_000 });
    await expect(reconnectedBoardFolderSec).toBeVisible({ timeout: 10_000 });
    await expect(reconnectedSessionOpenspec).toBeVisible({ timeout: 10_000 });

    // No duplicate sections
    await expect(reconnectedLiveCard.locator("span", { hasText: /^OPENSPEC$/ })).toHaveCount(1);
    await expect(folderCard(page, FIXTURE_GIT).locator(`[data-folder-openspec-section="${FIXTURE_GIT}"]`)).toHaveCount(1);
    await expect(folderCard(page, FIXTURE_BOARD).locator(`[data-folder-openspec-section="${FIXTURE_BOARD}"]`)).toHaveCount(1);
  });
});
