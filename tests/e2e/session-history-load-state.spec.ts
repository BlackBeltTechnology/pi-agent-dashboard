import type { Browser, BrowserContext, Locator, WebSocketRoute } from "@playwright/test";
import { expect, type Page, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * L3 gate for change: show-session-history-load-state.
 *
 * Scenario mapping (test-plan.md):
 *   F11 — arming the loading flag at selection (before paint) means a cold
 *         selection never flashes "No messages yet"; the skeleton is seen.
 *   F12 — the selected card's chip shows the spinning arc while a real
 *         multi-batch replay lands, and drops it once the transcript settles.
 *   F13 — the ring causes no layout shift: the card's name + timestamp boxes
 *         are identical with and without the ring, at 1440 px and 375 px.
 *   X6  — socket down + selected empty session → "Waiting for connection" +
 *         dashed ring, no spinner; after reconnect the transcript loads.
 *   X7  — replay frames held > 10 s → slow notice "Still loading history · 1Xs";
 *         Retry restarts the clock (notice gone); released frames render.
 *   X8  — replay frames dropped > 15 s → "Couldn't load history" (role=alert) +
 *         solid error ring; Retry with frames restored recovers.
 *
 * One long-transcript session is spawned once and every scenario observes it
 * from a FRESH browser context (empty IndexedDB → cold `lastSeq: 0` replay),
 * so each step starts with no client-side history. Steps, not separate tests:
 * the ~120-turn faux transcript is the dominant cost and the per-test reaper
 * would shut the session down between tests.
 *
 * Fault injection is `page.routeWebSocket` (exemplar: `stallServerToClientWs`
 * in `replay-in-flight-pill.spec.ts`), extended with a per-session replay
 * filter (pass / hold / drop) and a block mode that closes the page-side socket
 * and refuses reconnects — `setOffline` does NOT close an open WebSocket
 * (exemplar: `paging-exhausted-reconnect-rearm.spec.ts`).
 *
 * The harness port comes from the shared `BASE_URL`, never a hardcoded `:18000`.
 */

// Keep in sync with LONG_TRANSCRIPT_TAIL in qa/fixtures/faux-scenarios.ts
const LONG_TRANSCRIPT_TAIL = "long-transcript complete";
const RING = "session-history-ring";

interface WsCtl {
  /** `block`: close the page socket now and refuse every reconnect. */
  mode: "pass" | "block";
  /** Sequential per-frame delay for server→client frames. */
  gapMs: number;
  /** What to do with this session's `event_replay` frames. */
  replay: "pass" | "hold" | "drop";
  sessionId: string;
  held: string[];
  routes: WebSocketRoute[];
  /** Enqueue a frame on the ordered release chain of the live route. */
  release: () => void;
}

async function routeWs(page: Page, sessionId: string): Promise<WsCtl> {
  const ctl: WsCtl = { mode: "pass", gapMs: 0, replay: "pass", sessionId, held: [], routes: [], release: () => {} };
  await page.routeWebSocket(/.*/, (ws) => {
    if (ctl.mode === "block") {
      void ws.close();
      return;
    }
    ctl.routes.push(ws);
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m)); // client→server: immediate
    let chain = Promise.resolve();
    const deliver = (m: string | Buffer) => {
      chain = chain.then(async () => {
        if (ctl.gapMs > 0) await new Promise((r) => setTimeout(r, ctl.gapMs));
        ws.send(m);
      });
    };
    ctl.release = () => {
      for (const m of ctl.held.splice(0)) deliver(m);
    };
    server.onMessage((m) => {
      const raw = String(m);
      const isReplay = raw.includes('"event_replay"') && raw.includes(ctl.sessionId);
      if (isReplay && ctl.replay === "drop") return;
      if (isReplay && ctl.replay === "hold") {
        ctl.held.push(raw);
        return;
      }
      deliver(m);
    });
  });
  return ctl;
}

async function block(ctl: WsCtl): Promise<void> {
  ctl.mode = "block";
  for (const r of ctl.routes.splice(0)) await r.close().catch(() => {});
}

/** Record "No messages yet" / skeleton sightings once armed, across the page lifetime. */
async function recordSightings(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __armed?: boolean; __emptySeen?: number; __skeletonSeen?: boolean };
    w.__armed = false;
    w.__emptySeen = 0;
    w.__skeletonSeen = false;
    const scan = () => {
      if (!w.__armed) return;
      if (document.querySelector('[data-testid="chat-history-skeleton"]')) w.__skeletonSeen = true;
      if (document.body?.innerText.includes("No messages yet")) w.__emptySeen = (w.__emptySeen ?? 0) + 1;
    };
    const start = () => {
      new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    };
    if (document.documentElement) start();
    else document.addEventListener("DOMContentLoaded", start);
  });
}

async function armSightings(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __armed?: boolean }).__armed = true;
  });
}

async function sightings(page: Page): Promise<{ empty: number; skeleton: boolean }> {
  return page.evaluate(() => {
    const w = window as unknown as { __emptySeen?: number; __skeletonSeen?: boolean };
    return { empty: w.__emptySeen ?? 0, skeleton: w.__skeletonSeen === true };
  });
}

async function dismissProposeDialog(page: Page): Promise<void> {
  const overlay = page.locator('[data-testid="propose-dialog-overlay"]');
  if (!(await overlay.isVisible().catch(() => false))) return;
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden({ timeout: 5_000 });
}

/** A fresh context (empty IndexedDB) on the dashboard root, WS routed. */
async function freshPage(
  browser: Browser,
  sessionId: string,
  viewport?: { width: number; height: number },
): Promise<{ ctx: BrowserContext; page: Page; ctl: WsCtl }> {
  const ctx = await browser.newContext({ baseURL: BASE_URL, ...(viewport ? { viewport } : {}) });
  const page = await ctx.newPage();
  await recordSightings(page);
  const ctl = await routeWs(page, sessionId);
  await page.goto("/");
  return { ctx, page, ctl };
}

function desktopCard(page: Page, sid: string): Locator {
  return page.locator(`[data-testid="session-card-desktop"][data-session-id="${sid}"]`);
}

/** Select via the status chip: never an action button, unlike the card centre. */
async function selectCard(page: Page, card: Locator): Promise<void> {
  await card.getByTestId("session-status-icon").click();
  await dismissProposeDialog(page);
}

/**
 * Ring-sensitive geometry of the card's name + timestamp. The relative-age text
 * ("3m") may legitimately re-render between samples and change the timestamp's
 * WIDTH by a glyph, which the flex-1 name absorbs. So compare what a reflow from
 * the ring would move — name left/top/height, timestamp top/height/right edge —
 * exactly (±0 px), not the text-dependent widths.
 */
async function nameAndTimeBoxes(card: Locator) {
  const chip = card.getByTestId("session-status-icon");
  const name = await chip.locator("xpath=following-sibling::*[1]").boundingBox();
  const time = await card.locator('[title^="Started"]').first().boundingBox();
  expect(name, "card name has no box").not.toBeNull();
  expect(time, "card timestamp has no box").not.toBeNull();
  const n = name as NonNullable<typeof name>;
  const t = time as NonNullable<typeof time>;
  return {
    name: { x: n.x, y: n.y, height: n.height },
    time: { right: t.x + t.width, y: t.y, height: t.height },
  };
}

test.describe("session history load state", () => {
  test.setTimeout(600_000);

  test("F11/F12/F13/X6/X7/X8 chat + card history-load states", async ({ page, browser }) => {
    const card = await spawnFreshGitSession(page);
    const sid = (await card.getAttribute("data-session-id")) as string;
    expect(sid).toBeTruthy();
    await card.click();
    await dismissProposeDialog(page);
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 60_000 });
    await composer.fill("warmup");
    await expect(page.getByTestId("send-button")).toBeEnabled({ timeout: 120_000 });
    await composer.fill("");
    await sendPrompt(page, "[[faux:long-transcript]] go");
    await expect(page.getByText(LONG_TRANSCRIPT_TAIL).last()).toBeVisible({ timeout: 180_000 });

    await test.step("F11 no 'No messages yet' flash on a cold selection; skeleton seen", async () => {
      const { ctx, page: p, ctl } = await freshPage(browser, sid);
      try {
        ctl.gapMs = 150;
        const c = desktopCard(p, sid);
        await expect(c).toBeVisible({ timeout: 60_000 });
        await armSightings(p);
        await selectCard(p, c);
        await expect(p.getByText(LONG_TRANSCRIPT_TAIL).last()).toBeVisible({ timeout: 180_000 });
        const seen = await sightings(p);
        expect(seen.empty, "'No messages yet' painted during a cold selection").toBe(0);
        expect(seen.skeleton, "loading skeleton never shown").toBe(true);
      } finally {
        await ctx.close();
      }
    });

    await test.step("F12 + F13@1440 arc during multi-batch replay, no layout shift", async () => {
      const { ctx, page: p, ctl } = await freshPage(browser, sid, { width: 1440, height: 900 });
      try {
        ctl.gapMs = 250;
        const c = desktopCard(p, sid);
        await expect(c).toBeVisible({ timeout: 60_000 });
        await selectCard(p, c);
        const ring = c.getByTestId(RING);
        await expect(ring).toHaveAttribute("data-history-phase", "loading", { timeout: 30_000 });
        await expect(ring).toHaveClass(/animate-spin/);
        const withRing = await nameAndTimeBoxes(c);
        await expect(p.getByText(LONG_TRANSCRIPT_TAIL).last()).toBeVisible({ timeout: 180_000 });
        await expect(p.getByTestId("replay-in-flight-pill")).toHaveCount(0, { timeout: 60_000 });
        await expect(ring).toHaveCount(0, { timeout: 60_000 });
        const noRing = await nameAndTimeBoxes(c);
        expect(noRing).toEqual(withRing);
      } finally {
        await ctx.close();
      }
    });

    await test.step("F13@375 mobile ring causes no layout shift", async () => {
      const { ctx, page: p, ctl } = await freshPage(browser, sid, { width: 375, height: 800 });
      try {
        ctl.replay = "hold";
        const hamburger = p.getByTestId("hamburger-button");
        const mobileCard = p.locator(`li[data-session-id="${sid}"]`).filter({ has: p.getByTestId("session-status-icon") });
        const openList = async () => {
          if (!(await mobileCard.isVisible().catch(() => false)) && (await hamburger.isVisible().catch(() => false))) {
            await hamburger.click();
          }
          await expect(mobileCard).toBeVisible({ timeout: 30_000 });
        };
        await openList();
        await mobileCard.getByTestId("session-status-icon").click();
        await dismissProposeDialog(p);
        await openList();
        const ring = mobileCard.getByTestId(RING);
        await expect(ring).toHaveAttribute("data-history-phase", "loading", { timeout: 30_000 });
        const withRing = await nameAndTimeBoxes(mobileCard);
        ctl.replay = "pass";
        ctl.release();
        await expect(ring).toHaveCount(0, { timeout: 120_000 });
        const noRing = await nameAndTimeBoxes(mobileCard);
        expect(noRing).toEqual(withRing);
      } finally {
        await ctx.close();
      }
    });

    await test.step("X6 waiting while disconnected, recovers on reconnect", async () => {
      const { ctx, page: p, ctl } = await freshPage(browser, sid);
      try {
        const c = desktopCard(p, sid);
        await expect(c).toBeVisible({ timeout: 60_000 });
        await block(ctl);
        await selectCard(p, c);
        const waiting = p.getByTestId("chat-history-waiting");
        await expect(waiting).toBeVisible({ timeout: 30_000 });
        await expect(waiting).toHaveAttribute("role", "status");
        await expect(waiting.getByText("Waiting for connection")).toBeVisible();
        await expect(p.getByTestId("chat-history-skeleton")).toHaveCount(0);
        const ring = c.getByTestId(RING);
        await expect(ring).toHaveAttribute("data-history-phase", "waiting");
        await expect(ring).toHaveClass(/border-dashed/);
        await expect(ring).not.toHaveClass(/animate-spin/);
        await armSightings(p);
        ctl.mode = "pass"; // the app's own backoff reconnects
        await expect(p.getByText(LONG_TRANSCRIPT_TAIL).last()).toBeVisible({ timeout: 180_000 });
        await expect(waiting).toHaveCount(0);
        await expect(ring).toHaveCount(0, { timeout: 60_000 });
        expect((await sightings(p)).empty).toBe(0);
      } finally {
        await ctx.close();
      }
    });

    await test.step("X7 slow notice after 10 s; Retry restarts the clock", async () => {
      const { ctx, page: p, ctl } = await freshPage(browser, sid);
      try {
        const c = desktopCard(p, sid);
        await expect(c).toBeVisible({ timeout: 60_000 });
        ctl.replay = "hold";
        await selectCard(p, c);
        const notice = p.getByTestId("chat-history-slow-notice");
        await expect(notice).toBeVisible({ timeout: 14_000 });
        await expect(notice.getByRole("status")).toHaveText("Still loading history");
        await expect(notice).toContainText(/· 1\ds/);
        await p.getByTestId("chat-history-slow-retry").click();
        await expect(notice).toHaveCount(0, { timeout: 2_000 });
        ctl.replay = "pass";
        ctl.release();
        await expect(p.getByText(LONG_TRANSCRIPT_TAIL).last()).toBeVisible({ timeout: 180_000 });
        await expect(notice).toHaveCount(0);
      } finally {
        await ctx.close();
      }
    });

    await test.step("X8 dropped replay → failed state + error ring; Retry recovers", async () => {
      const { ctx, page: p, ctl } = await freshPage(browser, sid);
      try {
        const c = desktopCard(p, sid);
        await expect(c).toBeVisible({ timeout: 60_000 });
        ctl.replay = "drop";
        await selectCard(p, c);
        const failed = p.getByTestId("chat-history-failed");
        await expect(failed).toBeVisible({ timeout: 30_000 });
        await expect(failed).toHaveAttribute("role", "alert");
        await expect(failed.getByText("Couldn't load history")).toBeVisible();
        await expect(p.getByText("No messages yet")).toHaveCount(0);
        const ring = c.getByTestId(RING);
        await expect(ring).toHaveAttribute("data-history-phase", "failed");
        await expect(ring).toHaveClass(/border-\[var\(--tint-red-fg\)\]/);
        ctl.replay = "pass";
        await armSightings(p);
        await p.getByTestId("chat-history-retry").click();
        await expect(p.getByText(LONG_TRANSCRIPT_TAIL).last()).toBeVisible({ timeout: 180_000 });
        await expect(failed).toHaveCount(0);
        await expect(ring).toHaveCount(0, { timeout: 60_000 });
        expect((await sightings(p)).skeleton).toBe(true);
      } finally {
        await ctx.close();
      }
    });
  });
});
