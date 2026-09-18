/**
 * Browser E2E — the seek-to-card reveal against ASYNC folder collapse.
 *
 * Expanding a folder is now a WebSocket round-trip, which turns the reveal's
 * old guarded toggle into a read-modify-write race. Proving that needs a real
 * socket whose echo can be held back (`routeWebSocket`), a real layout (the
 * card is present at height 0 inside a collapsed folder), and the real 5s
 * backstop toast — none of which exist in jsdom.
 *
 * Covers test-plan #F5, #F6, #F8.
 * See change: persist-folder-collapse-server-side.
 */
import { expect, type Page, test } from "./fixtures.js";
import { collapseFolderViaUi, folderBodyCount, setFolderCollapsedViaBus } from "./helpers/folder-collapse.js";
import { ensureGitSession, expandFolder, FIXTURE_GIT, folderCard, gotoDashboard } from "./helpers/index.js";

const CWD = FIXTURE_GIT;
/** Comfortably longer than any local echo, short enough to keep the spec quick. */
const ECHO_DELAY_MS = 2_000;

/**
 * Hold every server→client `collapsed_folders_updated` frame for `delayMs`.
 * Must be installed BEFORE the page opens its socket. Everything else is
 * forwarded verbatim. Mirrors `ctx-running-render.spec.ts`'s proxy shape.
 */
async function delayCollapseEchoes(page: Page, delayMs: number): Promise<void> {
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (typeof m === "string" && m.includes('"collapsed_folders_updated"')) {
        setTimeout(() => {
          try {
            ws.send(m);
          } catch {
            /* socket already gone — the test is over */
          }
        }, delayMs);
        return;
      }
      ws.send(m);
    });
  });
}

/** Open a session's detail view and return its id (the Seek button's target). */
async function openSessionDetail(page: Page): Promise<string> {
  const card = await ensureGitSession(page);
  const id = await card.getAttribute("data-session-id");
  expect(id, "session card carries no data-session-id").toBeTruthy();
  await card.click();
  await page.getByTestId("session-header-seek-card").waitFor({ state: "visible", timeout: 30_000 });
  return id as string;
}

/**
 * Laid-out height of the session's sidebar card — 0 inside a collapsed folder.
 *
 * A raw DOM read, NOT `locator.boundingBox()`: the card inside a collapsed
 * folder is attached at height 0, and `boundingBox` waits for visibility, so it
 * blocks until the test times out instead of reporting the 0 under test.
 */
async function cardHeight(page: Page, sessionId: string): Promise<number> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    return el ? el.getBoundingClientRect().height : 0;
  }, `[data-session-id="${sessionId}"]`);
}

test.describe("folder collapse × seek-to-card", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  test.afterAll(async () => {
    // Server-side state outlives the spec file — hand the sidebar back expanded.
    await setFolderCollapsedViaBus(CWD, false);
  });

  // F5 — the reveal must complete on the collapsed-folders ECHO, well inside the
  // 5s give-up backstop, and therefore never show the Retry toast.
  test("F5: seeking a card inside a collapsed folder reveals it with no Retry toast", async ({ page }) => {
    const id = await openSessionDetail(page);
    await expandFolder(page, CWD);
    await collapseFolderViaUi(page, CWD);
    expect(await cardHeight(page, id), "card should be unlaid-out inside a collapsed folder").toBe(0);

    const startedAt = Date.now();
    await page.getByTestId("session-header-seek-card").click();

    await expect
      .poll(() => folderBodyCount(page, CWD), { timeout: 4_000, message: "the folder never expanded after Seek" })
      .toBe(1);
    await expect
      .poll(() => cardHeight(page, id), { timeout: 4_000, message: "the target card never laid out" })
      .toBeGreaterThan(0);
    // Echo-driven, not backstop-driven: the 5s timeout has not even fired yet.
    expect(Date.now() - startedAt, "reveal took longer than the 5s backstop").toBeLessThan(5_000);

    // Sit out the full backstop window and prove no toast was queued behind it.
    await page.waitForTimeout(6_000);
    await expect(page.getByText(/Couldn.t reveal the card/i)).toHaveCount(0);
    await expect(page.getByTestId("toast-action").filter({ hasText: /retry/i })).toHaveCount(0);
    expect(await folderBodyCount(page, CWD)).toBe(1);
  });

  // F6 — the toggle-inversion race. With the echo held for 2s, the second Seek
  // necessarily runs while the client still believes the folder is collapsed:
  // an ADD-ONLY expand is a no-op there, the old guarded TOGGLE would shut it.
  test("F6: a second Seek issued before the echo lands never re-collapses the folder", async ({ page }) => {
    await delayCollapseEchoes(page, ECHO_DELAY_MS);
    await gotoDashboard(page);
    const id = await openSessionDetail(page);
    await expandFolder(page, CWD);
    const collapseStartedAt = Date.now();
    await collapseFolderViaUi(page, CWD);
    // Non-vacuity guard: if the interception silently failed to match the
    // socket, the echo would land in milliseconds and the "second Seek beats the
    // echo" premise would be untrue while the test still passed.
    expect(
      Date.now() - collapseStartedAt,
      "the collapse echo was NOT held back — the race window never existed",
    ).toBeGreaterThanOrEqual(ECHO_DELAY_MS);

    const seek = page.getByTestId("session-header-seek-card");
    const firstClickAt = Date.now();
    await seek.click();
    await page.waitForTimeout(300);
    await seek.click();
    const window = Date.now() - firstClickAt;
    // Both clicks are inside the held-echo window by construction — no expand
    // echo can have been delivered between them.
    expect(window, "the second Seek fell outside the held-echo window").toBeLessThan(ECHO_DELAY_MS);

    await expect
      .poll(() => folderBodyCount(page, CWD), {
        timeout: 15_000,
        message: "the folder never expanded after the double Seek",
      })
      .toBe(1);
    // Stay past a second delayed echo: a re-collapse would land here.
    await page.waitForTimeout(ECHO_DELAY_MS + 2_000);
    expect(await folderBodyCount(page, CWD), "the second Seek re-collapsed the folder").toBe(1);
    expect(await cardHeight(page, id)).toBeGreaterThan(0);
  });

  // F8 — the planned "click `+ Session` twice on a COLLAPSED folder" race is
  // UNREACHABLE from the rendered UI: `FolderSpawnButtons` is the sidebar's only
  // `+ Session`, and it lives inside the `{!isCollapsed && !isStub && (` body
  // (SessionList.tsx:1784 → :1793), so its own `if (isCollapsed)` expand
  // (:1804/:1808) can never observe `true`. Asserting the premise's absence is
  // the honest test; a double-click test would pass while exercising nothing.
  test("F8: a collapsed folder exposes no `+ Session` control, so the double-spawn race is unreachable", async ({
    page,
  }) => {
    await ensureGitSession(page);
    await expandFolder(page, CWD);
    const card = folderCard(page, CWD);
    await expect(card.getByTestId("folder-spawn-session-btn")).toHaveCount(1);

    await collapseFolderViaUi(page, CWD);
    await expect(card.getByTestId("folder-spawn-session-btn")).toHaveCount(0);
    await expect(page.getByTestId(`folder-body-${CWD}`)).toHaveCount(0);

    // And expanding brings it back — the control is body-scoped, not removed.
    await expandFolder(page, CWD);
    await expect(card.getByTestId("folder-spawn-session-btn")).toHaveCount(1);
  });
});
