/**
 * Browser E2E — folder collapse is SERVER state now, not localStorage.
 *
 * Only a real browser can prove these: whether a reload repaints a collapsed
 * folder expanded before correcting it (a frame, not a final state), whether a
 * SECOND browser context sees the same collapse without being told, and whether
 * a pinned folder with zero sessions survives a session-list change — the exact
 * shape the deleted prune used to wipe (Leak B). jsdom sees none of it: it has
 * one document, no connect snapshot ordering, and no second client.
 *
 * Covers test-plan #F1, #F2, #F3, #F9.
 * See change: persist-folder-collapse-server-side.
 */
import { expect, type Page, test } from "./fixtures.js";
import {
  armExpandedFrameWatch,
  collapseFolderViaUi,
  expandedFrameCount,
  folderBodyCount,
  inContainer,
  pinViaBus,
  setFolderCollapsedViaBus,
  unpinViaBus,
} from "./helpers/folder-collapse.js";
import { ensureGitSession, expandFolder, FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/** Folder group that owns sessions. */
const WITH_SESSIONS = FIXTURE_GIT;
/**
 * Second group: pinned, zero sessions. Created here rather than borrowing an
 * existing `/fixtures/*` dir so unpinning it in teardown cannot disturb another
 * spec that pinned the same path in the shared container.
 */
const EMPTY_PIN = "/fixtures/collapse-e2e";

test.describe("folder collapse persistence", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    inContainer(`mkdir -p ${EMPTY_PIN}`);
    await pinViaBus(EMPTY_PIN);
  });

  test.afterAll(async () => {
    // Collapse state OUTLIVES the spec file (it is in preferences.json), so it
    // must be put back or every later spec inherits a collapsed sidebar.
    await setFolderCollapsedViaBus(WITH_SESSIONS, false);
    await setFolderCollapsedViaBus(EMPTY_PIN, false);
    await unpinViaBus(EMPTY_PIN);
    try {
      inContainer(`rm -rf ${EMPTY_PIN}`);
    } catch {
      /* best effort — cleanup must never fail the run */
    }
  });

  /** Both groups present and expanded — the shared precondition. */
  async function twoExpandedGroups(page: Page): Promise<void> {
    await ensureGitSession(page);
    await page.getByTestId(`folder-home-row-${EMPTY_PIN}`).first().waitFor({ state: "visible", timeout: 30_000 });
    await expandFolder(page, WITH_SESSIONS);
    await expandFolder(page, EMPTY_PIN);
  }

  // F1 — the headline: collapse survives a reload, and the reload never paints
  // the folder expanded first (the connect snapshot carries the state).
  test("F1: a collapsed folder is still collapsed after a reload, with no expanded frame", async ({ page }) => {
    await twoExpandedGroups(page);
    await collapseFolderViaUi(page, WITH_SESSIONS);

    await armExpandedFrameWatch(page, WITH_SESSIONS);
    await gotoDashboard(page);

    // The OTHER group hydrating is the proof the sidebar actually rendered —
    // without it "collapsed" would also hold for a sidebar that never painted.
    await expect
      .poll(() => folderBodyCount(page, EMPTY_PIN), { timeout: 30_000, message: "sidebar never hydrated after reload" })
      .toBe(1);
    await expect(page.getByTestId(`folder-home-row-${WITH_SESSIONS}`).first()).toBeVisible();
    await expect(page.getByTestId(`folder-body-${WITH_SESSIONS}`)).toHaveCount(0);
    // Settle past any late snapshot before reading the frame counter.
    await page.waitForTimeout(1_500);
    expect(await folderBodyCount(page, WITH_SESSIONS)).toBe(0);
    expect(
      await expandedFrameCount(page),
      "the collapsed folder was rendered EXPANDED at least once before correcting",
    ).toBe(0);
  });

  // F2 — a client that never collapsed anything: the state has to arrive in the
  // connect snapshot, not via a mutation broadcast that will never fire.
  test("F2: a fresh browser context renders the server's collapsed folder collapsed from the first frame", async ({
    page,
    browser,
  }) => {
    await twoExpandedGroups(page);
    await setFolderCollapsedViaBus(WITH_SESSIONS, true);
    await expect
      .poll(() => folderBodyCount(page, WITH_SESSIONS), { timeout: 15_000 })
      .toBe(0);

    const fresh = await browser.newContext({ baseURL: BASE_URL });
    try {
      const other = await fresh.newPage();
      await armExpandedFrameWatch(other, WITH_SESSIONS);
      await gotoDashboard(other);
      await expect
        .poll(() => folderBodyCount(other, EMPTY_PIN), {
          timeout: 30_000,
          message: "fresh context never hydrated the sidebar",
        })
        .toBe(1);
      await expect(other.getByTestId(`folder-home-row-${WITH_SESSIONS}`).first()).toBeVisible();
      await other.waitForTimeout(1_500);
      expect(await folderBodyCount(other, WITH_SESSIONS)).toBe(0);
      expect(
        await expandedFrameCount(other),
        "the fresh client rendered the folder EXPANDED before the state arrived",
      ).toBe(0);
    } finally {
      await fresh.close();
    }
  });

  // F3 — server-owned state fans out: a collapse in one context reaches another
  // open context with no reload.
  test("F3: collapsing in one context converges the other without a reload", async ({ page, browser }) => {
    await twoExpandedGroups(page);

    const second = await browser.newContext({ baseURL: BASE_URL });
    try {
      const observer = await second.newPage();
      await gotoDashboard(observer);
      await expandFolder(observer, WITH_SESSIONS);
      expect(await folderBodyCount(observer, WITH_SESSIONS)).toBe(1);

      await collapseFolderViaUi(page, WITH_SESSIONS);

      await expect
        .poll(() => folderBodyCount(observer, WITH_SESSIONS), {
          timeout: 20_000,
          message: "the second context never received the collapse broadcast",
        })
        .toBe(0);
      // It converged WITHOUT a reload: the same document is still loaded.
      expect(await observer.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(1);
    } finally {
      await second.close();
    }
  });

  // F9 — Leak B: the deleted prune keyed off `sessions.map(s => s.cwd)`, so a
  // collapsed folder with no sessions was wiped by the next session change.
  test("F9: a collapsed pinned folder with no sessions survives a spawn elsewhere plus a reload", async ({ page }) => {
    await twoExpandedGroups(page);
    await collapseFolderViaUi(page, EMPTY_PIN);

    // Session-list change in a DIFFERENT folder — what used to trigger the prune.
    const res = await page.request.post("/api/session/spawn", {
      data: { cwd: WITH_SESSIONS },
      timeout: 60_000,
    });
    expect(res.ok(), `spawn in ${WITH_SESSIONS}: ${res.status()}`).toBe(true);
    await expect
      .poll(
        async () =>
          page.request
            .get("/api/sessions", { timeout: 15_000 })
            .then(async (r) => (((await r.json()) as { data?: unknown[] }).data ?? []).length)
            .catch(() => 0),
        { timeout: 120_000, message: "spawned session never registered" },
      )
      .toBeGreaterThan(0);

    await armExpandedFrameWatch(page, EMPTY_PIN);
    await gotoDashboard(page);
    await expect
      .poll(() => folderBodyCount(page, WITH_SESSIONS), { timeout: 30_000, message: "sidebar never hydrated" })
      .toBe(1);
    await expect(page.getByTestId(`folder-home-row-${EMPTY_PIN}`).first()).toBeVisible();
    await page.waitForTimeout(1_500);
    expect(await folderBodyCount(page, EMPTY_PIN), "the zero-session folder was wiped (Leak B)").toBe(0);
    expect(await expandedFrameCount(page)).toBe(0);
  });
});
