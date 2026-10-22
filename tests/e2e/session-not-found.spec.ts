/**
 * L3 — unresolved `/session/:id` URLs: inline not-found, server lookup for ids
 * outside the windowed snapshot, and the reconnect / archive edge cases.
 *
 * Covers test-plan #F14, #F15, #F16, #F18, #F19 of change
 * `add-session-ui-deep-links-for-agents` (spec url-routing).
 *
 * Exemplars: `archive-fold.spec.ts` (archive from the sidebar card),
 * `sessions-page-stub-group.spec.ts` (the seeded ended session OUTSIDE the
 * snapshot window: `STUB_SESSION_ID`, scripts/seed-sessions-window.mjs) and
 * `paging-exhausted-reconnect-rearm.spec.ts` (hard WebSocket cut).
 */
import { expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, gotoDashboard } from "./helpers/index.js";

const DESKTOP = { width: 1280, height: 800 } as const;
/** Seeded ended session older than the snapshot window (`Stub Session`). */
const STUB_SESSION_ID = "019f0000-0000-7000-8000-000000000001";

async function liveSessionId(page: Page): Promise<string> {
  const card = await ensureGitSession(page);
  const id = await card.getAttribute("data-session-id");
  expect(id).toBeTruthy();
  return id as string;
}

test.describe("session deep link: not found and lookup (L3)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test("F14: an unknown id shows the not-found state once the snapshot is applied, and stays", async ({ page }) => {
    await liveSessionId(page);
    await page.goto("/session/does-not-exist");
    // The snapshot is applied once the sidebar lists a session.
    await expect(page.getByTestId("session-card-desktop").first()).toBeVisible({ timeout: 30_000 });
    const nf = page.getByTestId("session-not-found");
    await expect(nf).toBeVisible({ timeout: 30_000 });
    await expect(nf).toContainText("does-not-exist");
    await expect
      .poll(() => page.url(), { timeout: 2_000, intervals: [250] })
      .toMatch(/\/session\/does-not-exist$/);
    await expect(nf).toBeVisible();
  });

  test("F15: an ended session outside the snapshot window opens through the id lookup", async ({ page }) => {
    const lookups: string[] = [];
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("/api/sessions?") && u.includes("id=")) lookups.push(u);
    });
    await page.goto(`/session/${STUB_SESSION_ID}`);
    await expect(page.getByTestId("session-header")).toContainText("Stub Session", { timeout: 30_000 });
    await expect(page.getByTestId("session-not-found")).toHaveCount(0);
    expect(lookups.filter((u) => u.includes(STUB_SESSION_ID))).toHaveLength(1);
  });

  test("F16: an unknown id on the desktop diff route shows not-found and never fetches a diff", async ({ page }) => {
    const diffRequests: string[] = [];
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("session-diff") && u.includes("does-not-exist")) diffRequests.push(u);
    });
    await liveSessionId(page);
    await page.goto("/session/does-not-exist/diff");
    await expect(page.getByTestId("session-not-found")).toBeVisible({ timeout: 30_000 });
    expect(diffRequests).toEqual([]);
  });

  test("F18: a WebSocket reconnect never blanks the open session", async ({ page }) => {
    const id = await liveSessionId(page);
    // Track live sockets (before any page script runs) so the ESTABLISHED one
    // can be closed: `setOffline(true)` does not close an open WebSocket. The app
    // then reconnects itself — same React instance, so the sticky id is exercised.
    await page.addInitScript(() => {
      const Real = window.WebSocket;
      const w = window as unknown as { __dashSockets: WebSocket[]; WebSocket: typeof WebSocket };
      w.__dashSockets = [];
      const Wrapped = function (url: string, protocols?: string | string[]) {
        const socket = protocols === undefined ? new Real(url) : new Real(url, protocols);
        w.__dashSockets.push(socket);
        return socket;
      } as unknown as typeof WebSocket;
      Wrapped.prototype = Real.prototype;
      Object.assign(Wrapped, Real);
      w.WebSocket = Wrapped;
    });
    let snapshots = 0;
    page.on("websocket", (ws) =>
      ws.on("framereceived", (f) => {
        if (String(f.payload).includes("sessions_snapshot")) snapshots++;
      }),
    );
    await page.goto(`/session/${id}`);
    const composer = page.getByPlaceholder(/message/i).first();
    await expect(composer).toBeVisible({ timeout: 30_000 });
    const handle = await composer.elementHandle();
    await expect.poll(() => snapshots, { timeout: 30_000 }).toBeGreaterThan(0);
    const before = snapshots;

    await page.evaluate(() => {
      for (const s of (window as unknown as { __dashSockets: WebSocket[] }).__dashSockets) {
        try {
          s.close();
        } catch {
          /* already gone */
        }
      }
    });

    // Poll across the whole reconnect window, until the NEW snapshot has landed.
    const seen = { notFound: 0, resolving: 0 };
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      seen.notFound += await page.getByTestId("session-not-found").count();
      seen.resolving += await page.getByTestId("session-resolving").count();
      if (snapshots > before) break;
      await page.waitForTimeout(100);
    }
    expect(snapshots, "the reconnect delivered a fresh snapshot").toBeGreaterThan(before);
    for (let i = 0; i < 10; i++) {
      seen.notFound += await page.getByTestId("session-not-found").count();
      seen.resolving += await page.getByTestId("session-resolving").count();
      await page.waitForTimeout(100);
    }
    expect(seen).toEqual({ notFound: 0, resolving: 0 });
    expect(await handle?.evaluate((el) => el.isConnected)).toBe(true);
  });

  test("F19: archiving the viewed session converges to / without a not-found flash", async ({ page }) => {
    const id = await liveSessionId(page);
    await gotoDashboard(page);
    await page.goto(`/session/${id}`);
    await expect(page.getByPlaceholder(/message/i).first()).toBeVisible({ timeout: 30_000 });

    const flashes: number[] = [];
    const timer = setInterval(() => {
      void page
        .getByTestId("session-not-found")
        .count()
        .then((n) => flashes.push(n))
        .catch(() => undefined);
    }, 100);
    try {
      await page.locator(`[data-session-id="${id}"]`).getByTestId("session-archive-btn").click();
      await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe("/");
    } finally {
      clearInterval(timer);
    }
    expect(Math.max(0, ...flashes)).toBe(0);
    await expect(page.getByTestId("session-not-found")).toHaveCount(0);
  });
});
