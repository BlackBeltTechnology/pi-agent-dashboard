import { expect, type Locator, type Page } from "@playwright/test";
import type { Browser } from "@playwright/test";
import { DASHBOARD_PORT } from "../lifecycle.js";
import { sendPrompt, spawnFreshGitSession } from "./index.js";

/**
 * Shared glue for L3 specs that need the SERVER running with a real replay
 * window (`memoryLimits.maxReplayEvents > 0`, optionally
 * `replayWindowMode: "tail-only"`).
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * `maxReplayEvents` / `replayWindowMode` are read ONCE, at server construction
 * (`cli.ts` → `ServerConfig` → `createBrowserGateway`), so they are restart-only
 * fields on the ONE container every spec shares. Arranging a windowed session is
 * therefore a fixed five-step dance: read the current limits, build a long
 * transcript BEFORE windowing is armed, write the new limits, restart the
 * daemon, and restore both the limits and the session in `afterAll`.
 *
 * `history-backfill-gap.spec.ts`, `history-backfill-perf.spec.ts` and
 * `max-replay-events-setting.spec.ts` each grew their own private copy of that
 * dance. `add-tail-only-replay-window` needs three more spec files, which would
 * have made six. The copies are consolidated here instead.
 *
 * ── This is NOT new infrastructure ──────────────────────────────────────────
 * Worth stating plainly, because a planning note in this change once claimed the
 * opposite and blocked on it. Nothing here boots a second container, adds a
 * Playwright project, or teaches `docker/test-up.sh` a new flag. Every primitive
 * it uses — `PUT /api/config`, `POST /api/restart`, the `[[faux:long-transcript]]`
 * fixture — is shipped and exercised by the three specs named above. The only
 * change is that the glue now lives in one place.
 *
 * The `page.route()`-cannot-intercept-WebSocket objection is real but
 * irrelevant: these specs do not intercept the protocol, they CONFIGURE the
 * server and then observe real frames via `watchBackfillFrames`.
 *
 * See change: add-tail-only-replay-window; fix-lazy-history-backfill-ux (D7).
 */

/**
 * `MIN_REPLAY_WINDOW`. Deliberately not the shipped 2000 default: the harness
 * cannot cheaply build a 2000-event session, and the window CODE PATH is
 * identical at either value — `computeReplayWindow` is parametric and its
 * behaviour at the shipped default is pinned deterministically at L1
 * (`subscription-handler-window.test.ts`). What only a browser can show is
 * scroll behaviour, splice ordering, and the rendered affordance.
 */
export const WINDOW = 100;

/**
 * `memoryLimits` as it travels over `/api/config`. `replayWindowMode` is a
 * STRING alongside the numeric siblings, so this is not `Record<string, number>`
 * — the older private copies of this type were, which silently mistyped the
 * mode field the moment `add-tail-only-replay-window` introduced it.
 */
export type MemoryLimits = Record<string, number | string>;

/** The gap divider's row. Present only once `history_window` has landed. */
export const divider = (page: Page): Locator => page.getByTestId("history-gap-divider");
const loadEarlier = (page: Page): Locator => page.getByTestId("history-gap-load");
export const scroller = (page: Page): Locator => page.getByTestId("chat-scroll-container");

/**
 * Restart the daemon and wait for it to answer again.
 *
 * The `fetch` is expected to reject — the connection dies with the daemon, and
 * that is the point, so the rejection is swallowed rather than reported.
 *
 * This works because `/api/restart` re-execs the SERVER PROCESS, not the
 * container: the `pi-state` tmpfs volume is not remounted, so config written
 * through `PUT /api/config` (or straight to `config.json`) survives. That is
 * what makes a per-spec windowed server reachable at all.
 */
async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(
    () => undefined,
  );
  await new Promise((r) => setTimeout(r, 2_000));
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`)).ok) return;
    } catch {
      // still down
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}

/** Write `memoryLimits` and restart so the new values are actually in force. */
export async function writeLimits(page: Page, limits: MemoryLimits): Promise<void> {
  const res = await page.request.put("/api/config", { data: { memoryLimits: limits } });
  expect(res.ok()).toBeTruthy();
  await restartDashboard();
}

export interface WindowedSession {
  sessionId: string;
  /** Exactly what was read before the spec touched anything. */
  originalLimits: MemoryLimits;
}

/**
 * Build a long transcript, then arm windowing over it.
 *
 * Ordering is load-bearing: the session is built BEFORE windowing, so the
 * transcript is produced from an unwindowed replay and the build is not racing
 * the affordance under test.
 *
 * `long-transcript` is the repo's existing "many turns, heterogeneous rows"
 * fixture — thinking + prose + a real bash tool call per turn — so the stream
 * carries tool pairs the window can split.
 */
export async function buildWindowedSession(
  browser: Browser,
  opts: { mode?: "head-tail" | "tail-only"; window?: number } = {},
): Promise<WindowedSession> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const cfg = (await (await page.request.get("/api/config")).json()) as {
      data?: { memoryLimits?: MemoryLimits };
    };
    const originalLimits = cfg.data?.memoryLimits ?? {};

    const card = await spawnFreshGitSession(page);
    const sessionId = (await card.getAttribute("data-session-id")) ?? "";
    expect(sessionId).toBeTruthy();
    await card.click();

    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 60_000 });
    await composer.fill("warmup");
    await expect(page.getByTestId("send-button")).toBeEnabled({ timeout: 120_000 });
    await composer.fill("");
    await sendPrompt(page, "[[faux:long-transcript]] go");
    await expect(page.getByText(/long-transcript complete/).first()).toBeVisible({
      timeout: 240_000,
    });
    await page.waitForTimeout(2_000);

    await writeLimits(page, {
      ...originalLimits,
      maxReplayEvents: opts.window ?? WINDOW,
      replayWindowMode: opts.mode ?? "tail-only",
    });
    return { sessionId, originalLimits };
  } finally {
    await ctx.close();
  }
}

/**
 * Undo everything `buildWindowedSession` did.
 *
 * Restores the limits EXACTLY as read — never `?? 0`, which would coerce an
 * absent field into an explicit "unlimited" and persist it for every later spec
 * (the same presence bug `fix-lazy-history-backfill-ux` D7 fixes in the settings
 * panel).
 *
 * Also ends the session this file BUILT: the auto-reap fixture snapshots ids
 * around each test BODY, so a `beforeAll` spawn is never in a delta and would
 * otherwise survive the file and trip the residual-session budget in whichever
 * spec runs next.
 */
export async function teardownWindowedSession(
  browser: Browser,
  session: WindowedSession,
): Promise<void> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    if (session.sessionId) {
      await page.request
        .post(`/api/session/${session.sessionId}/shutdown`, { timeout: 20_000 })
        .catch(() => undefined);
    }
    await page.request.put("/api/config", { data: { memoryLimits: session.originalLimits } });
  } finally {
    await ctx.close();
    await restartDashboard();
  }
}

/**
 * Bring the divider into the MOUNTED set.
 *
 * The transcript is virtualized: only the viewport plus overscan is in the DOM.
 * In `tail-only` the divider is the FIRST row, so it is reachable, but the view
 * still opens pinned to the BOTTOM — absence before climbing is virtualization,
 * NOT a missing affordance.
 *
 * Climbs by writing `scrollTop = 0` repeatedly. A single write is unreliable and
 * the reason matters: it does not go through `handleScroll`'s gesture path, so
 * `stickToBottomRef` can stay armed and the next measurement-driven growth
 * re-pins the view to the bottom, unmounting the divider again.
 */
export async function scrollDividerIntoDom(page: Page): Promise<void> {
  const el = scroller(page);
  await el.waitFor({ state: "visible", timeout: 60_000 });
  await expect
    .poll(
      async () => {
        await el.evaluate((n) => {
          n.scrollTop = 0;
        });
        return (await divider(page).count()) > 0;
      },
      { timeout: 120_000, intervals: [900] },
    )
    .toBe(true);
}

/**
 * Climb to the divider through the PRODUCT's own ascent affordance.
 *
 * Required after a `tail-only` splice, where the raw `scrollTop = 0` climb
 * cannot converge. The raw write does not go through `handleScroll`'s gesture
 * path, so `stickToBottomRef` stays armed; on a transcript the splice just made
 * ~10x taller, measurement-driven growth re-pins to the bottom faster than the
 * loop can climb, and the poll burns its full budget without ever mounting the
 * divider. Observed directly — a 10-minute F9 run expired inside that poll.
 *
 * `scroll-to-top` drives `scrollToIndex(0)` with the ascent latch held, which
 * is both what a real user does and the only path that suppresses the re-pin.
 * Falls back to the raw climb when the button is absent (short transcript, no
 * ascent needed).
 */
export async function climbToDivider(page: Page): Promise<void> {
  const btn = page.getByTestId("scroll-to-top");
  if (await btn.count()) {
    await btn.first().click();
    // The ascent is bounded + re-issued on remeasure; give it room to land
    // rather than asserting on the first frame.
    await expect(divider(page)).toHaveCount(1, { timeout: 120_000 });
    await page.waitForTimeout(600);
    return;
  }
  await scrollDividerIntoDom(page);
}

/**
 * Re-establish the divider at the top and let the virtualizer settle. Cheap,
 * idempotent, and the only safe thing to do immediately before a measurement or
 * a click: the transcript is virtualized and the position is PERISHABLE.
 */
export async function pinDividerToTop(page: Page): Promise<void> {
  const el = scroller(page);
  for (let i = 0; i < 6; i++) {
    await el.evaluate((n) => {
      n.scrollTop = 0;
    });
    await page.waitForTimeout(400);
    if ((await divider(page).count()) > 0) break;
  }
  await expect(divider(page)).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(400);
}

/**
 * Open the windowed session in a transcript that has finished hydrating.
 * Returns once the divider is mounted and the affordance is ARMED — the client
 * disarms backfill until the terminal replay batch lands, so asserting before
 * that would be racing hydration rather than testing it.
 */
export async function openWindowedSession(
  page: Page,
  sessionId: string,
  opts: { requireLoadButton?: boolean } = {},
): Promise<void> {
  const { gotoDashboard } = await import("./index.js");
  await gotoDashboard(page);
  const card = page.locator(`[data-session-id="${sessionId}"]`).first();
  await card.waitFor({ state: "visible", timeout: 60_000 });
  await card.click();
  await scrollDividerIntoDom(page);
  await pinDividerToTop(page);
  await expect(divider(page)).toBeVisible({ timeout: 60_000 });
  /**
   * `requireLoadButton` defaults to FALSE, and the default matters in
   * `tail-only`.
   *
   * Waiting for an enabled "Load earlier" is a `head-tail` precondition. In
   * `tail-only` the divider AUTO-LOADS on scroll proximity, and the climb above
   * writes `scrollTop` directly through `evaluate` — which is deliberately NOT
   * carrying the `programmaticScrollUntil` stamp, so the product reads it as a
   * genuine user ascent and fires the trigger. Correct behaviour (D7), but it
   * means the manual button is frequently replaced by the loading/terminus row
   * before an assertion can reach it, and the wait then fails with
   * "element(s) not found" on a perfectly healthy session.
   *
   * Callers that genuinely need the manual affordance (the `head-tail` rows)
   * opt in explicitly.
   */
  if (opts.requireLoadButton) {
    await expect(loadEarlier(page)).toBeEnabled({ timeout: 60_000 });
  }
}

/**
 * Perform the SCROLL half of a click up front, so a scroll measurement taken
 * afterwards is not polluted by it. `locator.click()` auto-scrolls the target
 * into view; that scroll is Playwright's, not the product's.
 */
export async function settleClickTarget(page: Page): Promise<void> {
  await loadEarlier(page)
    .scrollIntoViewIfNeeded()
    .catch(() => undefined);
  await page.waitForTimeout(600);
}

/**
 * Invoke the load action WITHOUT letting the click move the viewport.
 *
 * Used ONLY by the scroll-measurement tests. `dispatchEvent("click")` runs the
 * identical React handler and the identical product code path; all it removes is
 * the harness's own scrolling (Playwright's pre-click auto-scroll, plus the
 * browser scrolling the freshly-FOCUSED button when the divider re-renders).
 *
 * Functional tests deliberately keep a REAL `.click()` — they assert what the
 * click DOES, not where the viewport ends up.
 */
export async function clickLoadEarlierWithoutScrolling(page: Page): Promise<void> {
  await loadEarlier(page).dispatchEvent("click");
}

/**
 * Wait until a locator's viewport `y` STOPS moving, then return it.
 *
 * Load-bearing, not a convenience: the transcript is virtualized with ESTIMATED
 * row sizes, so rows keep re-measuring after they mount and drift on their own
 * (~21px over 2.5s with no backfill at all). Taking a baseline against an
 * unsettled view would attribute that pre-existing convergence to the splice.
 *
 * Returns `null` if it never settles, which the caller MUST treat as a failure
 * rather than silently continuing.
 */
async function settledY(
  target: Locator,
  page: Page,
  timeoutMs = 30_000,
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  let stable = 0;
  let last: number | null = null;
  while (Date.now() < deadline) {
    const box = await target.boundingBox().catch(() => null);
    const y = box?.y ?? null;
    if (y !== null && last !== null && Math.abs(y - last) <= 1) {
      if (++stable >= 3) return y;
    } else {
      stable = 0;
    }
    last = y;
    await page.waitForTimeout(300);
  }
  return null;
}

/** Settle the divider specifically — the common case. */
export const settledDividerY = (page: Page, timeoutMs = 30_000): Promise<number | null> =>
  settledY(divider(page), page, timeoutMs);

/**
 * Wait until the scroller's `scrollTop` STOPS moving, then return it.
 *
 * The counterpart to `settledY` for the `tail-only` splice, where settling on
 * the DIVIDER is impossible by construction: the D7a anchor deliberately
 * scrolls the loading head out of the viewport, so the virtualizer unmounts it
 * and `boundingBox()` returns `null` forever. Settling on `scrollTop` measures
 * the same convergence without depending on a row that is *supposed* to leave.
 *
 * Returns `null` if it never settles, which the caller MUST treat as a failure.
 */
export async function settledScrollTop(page: Page, timeoutMs = 30_000): Promise<number | null> {
  const el = scroller(page);
  const deadline = Date.now() + timeoutMs;
  let stable = 0;
  let last: number | null = null;
  while (Date.now() < deadline) {
    const top = await el.evaluate((n) => n.scrollTop).catch(() => null);
    if (top !== null && last !== null && Math.abs(top - last) <= 1) {
      if (++stable >= 3) return top;
    } else {
      stable = 0;
    }
    last = top;
    await page.waitForTimeout(300);
  }
  return null;
}

/** Every `history_backfill*` / `history_window` frame seen on this page's WebSocket. */
export function watchBackfillFrames(page: Page) {
  const sent: Array<Record<string, unknown>> = [];
  const received: Array<Record<string, unknown>> = [];
  page.on("websocket", (ws) => {
    const read = (frame: { payload: string | Buffer }) => {
      const raw =
        typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8");
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    };
    ws.on("framesent", (f) => {
      const m = read(f);
      if (m?.type === "history_backfill") sent.push(m);
    });
    ws.on("framereceived", (f) => {
      const m = read(f);
      if (m?.type === "history_backfill_result" || m?.type === "history_window") received.push(m);
    });
  });
  return { sent, received };
}

/** Wait for at least `n` backfill RESULTS to have landed. */
export async function awaitBackfillResults(
  page: Page,
  frames: { received: Array<Record<string, unknown>> },
  n = 1,
): Promise<void> {
  await expect
    .poll(() => frames.received.filter((m) => m.type === "history_backfill_result").length, {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(n);
}
