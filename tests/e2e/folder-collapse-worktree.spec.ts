/**
 * Browser E2E — collapse keys for a group whose RENDERED path is not any
 * session's `cwd`.
 *
 * A worktree session renders under its main repo path (`resolveSessionGroupPath`),
 * so the folder the user collapses is addressed by a path no session reports.
 * That mismatch is the leak that motivated the change: the toggle wrote the
 * display path while every lookup used a raw `cwd`. Reproducing it needs a real
 * `git worktree` + a real bridge reporting `gitWorktree.mainPath` — the grouping
 * unit tests assert the mapping, not the collapse round-trip through it.
 *
 * Covers test-plan #F4, #F7.
 * See change: persist-folder-collapse-server-side.
 */
import type { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import { connectBus, expect, type Page, shutdownSession, test } from "./fixtures.js";
import {
  armExpandedFrameWatch,
  collapseFolderViaUi,
  expandedFrameCount,
  folderBodyCount,
  inContainer,
  setFolderCollapsedViaBus,
} from "./helpers/folder-collapse.js";
import { expandFolder, FIXTURE_GIT, folderCard, gotoDashboard, pinDirectory } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

interface SessionRow {
  id: string;
  cwd: string;
  gitWorktree?: { mainPath: string; name: string };
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  return (await res.json()) as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

const token = Date.now().toString(36);
const BRANCH = `e2e-collapse-${token}`;

/** The fixture's default branch, read off the `isMain` entry — never assumed. */
async function baseBranch(): Promise<string> {
  const wts = await apiGet<{ data?: { worktrees?: Array<{ isMain?: boolean; branch?: string | null }> } }>(
    `/api/git/worktrees?cwd=${encodeURIComponent(FIXTURE_GIT)}`,
  );
  const base = (wts.data?.worktrees ?? []).find((w) => w.isMain)?.branch;
  if (!base) throw new Error(`no base branch: ${JSON.stringify(wts)}`);
  return base;
}

/** Poll until the bridge reports the worktree session's parentage. */
async function awaitWorktreeSessionId(cwd: string): Promise<string> {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const rows = (await apiGet<{ data?: SessionRow[] }>("/api/sessions")).data ?? [];
    const row = rows.find((s) => s.cwd === cwd && s.gitWorktree?.mainPath === FIXTURE_GIT);
    if (row) return row.id;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error("worktree session never reported gitWorktree.mainPath");
}

let worktreePath = "";
let sessionId = "";
let setupError = "";

test.describe("folder collapse × worktree grouping", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  // Spawned in beforeAll ON PURPOSE: a session created inside a test body is in
  // that test's reap delta and would be shut down before the next test runs.
  test.beforeAll(async () => {
    try {
      const created = await apiPost<{ success?: boolean; data?: { path?: string } }>("/api/git/worktree", {
        cwd: FIXTURE_GIT,
        base: await baseBranch(),
        newBranch: BRANCH,
      });
      worktreePath = created.data?.path ?? "";
      if (!created.success || !worktreePath) throw new Error(`worktree create: ${JSON.stringify(created)}`);

      await apiPost("/api/session/spawn", { cwd: worktreePath });
      sessionId = await awaitWorktreeSessionId(worktreePath);
    } catch (err) {
      setupError = String(err);
    }
  });

  test.afterAll(async () => {
    await setFolderCollapsedViaBus(FIXTURE_GIT, false).catch(() => undefined);
    let client: BusClient | undefined;
    try {
      client = await connectBus();
      if (sessionId) await shutdownSession(client, sessionId);
    } catch {
      /* best effort */
    } finally {
      client?.close();
    }
    try {
      inContainer(
        [
          worktreePath
            ? `git -C ${FIXTURE_GIT} worktree remove --force '${worktreePath}' 2>/dev/null || rm -rf '${worktreePath}'`
            : "true",
          `git -C ${FIXTURE_GIT} branch -D '${BRANCH}' 2>/dev/null || true`,
          `git -C ${FIXTURE_GIT} worktree prune || true`,
        ].join("; "),
      );
    } catch {
      /* best effort */
    }
  });

  /** Dashboard mode with the fixture pinned and the worktree session grouped. */
  async function dashboardWithGroup(page: Page): Promise<void> {
    await gotoDashboard(page);
    const home = page.getByTestId(`folder-home-row-${FIXTURE_GIT}`).first();
    if (!(await home.isVisible().catch(() => false))) await pinDirectory(page, FIXTURE_GIT);
    await home.waitFor({ state: "visible", timeout: 30_000 });
    await expandFolder(page, FIXTURE_GIT);
    // The session's card renders under the MAIN path, and the worktree path is
    // never its own folder card — the premise both scenarios rest on.
    await expect(folderCard(page, FIXTURE_GIT).locator(`[data-session-id="${sessionId}"]`)).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(page.getByTestId(`folder-home-row-${worktreePath}`)).toHaveCount(0);
  }

  // F4 — collapse the group a worktree session renders under, reload, and it is
  // still collapsed: the key written is the one the render reads.
  test("F4: a group rendered under the worktree's main path stays collapsed across a reload", async ({ page }) => {
    test.skip(Boolean(setupError), `worktree setup failed: ${setupError}`);
    await dashboardWithGroup(page);
    await collapseFolderViaUi(page, FIXTURE_GIT);

    await armExpandedFrameWatch(page, FIXTURE_GIT);
    await gotoDashboard(page);
    await expect(page.getByTestId(`folder-home-row-${FIXTURE_GIT}`).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_500);
    expect(await folderBodyCount(page, FIXTURE_GIT), "the worktree-backed group re-expanded after reload").toBe(0);
    expect(await expandedFrameCount(page)).toBe(0);
    await setFolderCollapsedViaBus(FIXTURE_GIT, false);
  });

  // F7 — the reveal must key off the RESOLVED group path. Keyed off `s.cwd` it
  // would expand `<main>/.worktrees/<name>`, a key no rendered group owns, and
  // the card would stay buried until the 5s backstop toast.
  test("F7: seeking a worktree session expands the group rendered under the main path", async ({ page }) => {
    test.skip(Boolean(setupError), `worktree setup failed: ${setupError}`);
    await dashboardWithGroup(page);

    // Route, not a card click: the worktree card is tall enough that its centre
    // lands on a nested pill rather than the navigating surface.
    await page.goto(`/session/${encodeURIComponent(sessionId)}`);
    await page.getByTestId("session-header-seek-card").waitFor({ state: "visible", timeout: 30_000 });
    await expandFolder(page, FIXTURE_GIT);
    await collapseFolderViaUi(page, FIXTURE_GIT);

    const startedAt = Date.now();
    await page.getByTestId("session-header-seek-card").click();
    await expect
      .poll(() => folderBodyCount(page, FIXTURE_GIT), {
        timeout: 4_000,
        message: "the main-path group never expanded for the worktree session's Seek",
      })
      .toBe(1);
    // Raw DOM read: a card inside a collapsed folder is attached at height 0,
    // and `locator.boundingBox()` waits for visibility instead of reporting it.
    const height = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return el ? el.getBoundingClientRect().height : 0;
    }, `[data-session-id="${sessionId}"]`);
    expect(height, "the worktree session's card never laid out").toBeGreaterThan(0);
    expect(Date.now() - startedAt, "reveal fell through to the 5s backstop").toBeLessThan(5_000);
    await expect(page.getByText(/Couldn.t reveal the card/i)).toHaveCount(0);
  });
});
