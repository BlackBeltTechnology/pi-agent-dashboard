import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — a shed `session_updated` heals the rendered card without a reload.
 *
 * `session_updated` is transcript-class: above `MAX_WS_BUFFER` it is shed, and
 * it carries no seq, no backfill and no guaranteed successor frame. During a
 * long tool call the parent session emits its status frame ONCE and then goes
 * quiet, so a single shed frame leaves a stale badge for the whole call. The
 * server now records the shed id as a per-socket debt and re-pushes the
 * session's CURRENT state once the socket drains.
 *
 * Why these need a test-only injector: real back-pressure is a browser failing
 * to drain its own socket. Playwright cannot induce that deterministically, and
 * nothing else in the harness can push a live socket over 4 MB on demand. So
 * the server exposes `POST /api/test/force-shed`, registered ONLY under
 * `PI_E2E_FORCE_SHED=1` (set by `docker/compose.test.yml`), which forces
 * transcript frames to shed as if the socket were saturated.
 *
 * The injector is process-wide, so every test here releases it in `afterEach`
 * — including on failure. `playwright.config.ts` pins `workers: 1` and
 * `fullyParallel: false`, so no sibling spec can be running while it is on.
 *
 * Covers test-plan #F1, #F2.
 * See change: fix-backpressure-status-and-subagent-frames.
 */

/**
 * Status shape the card is currently rendering (`idle` / `working` / `ended`),
 * or `null` when no card for this session is mounted at all.
 *
 * The count guard is load-bearing: `getAttribute` AUTO-WAITS for its element,
 * so calling it on an unmounted card blocks until the test times out instead of
 * returning — which turns "the card left the live list" into a hang.
 */
async function statusShape(page: Page, sessionId: string): Promise<string | null> {
  const card = page.locator(`[data-session-id="${sessionId}"] [data-testid="session-status-icon"]`);
  if ((await card.count()) === 0) return null;
  return card.first().getAttribute("data-status-shape");
}

interface StatusFrame {
  sessionId: string;
  updates: Record<string, unknown>;
}

/**
 * Every `session_updated` frame this PAGE receives, in arrival order.
 *
 * MUST be installed before the page navigates: `page.on("websocket")` fires on
 * socket CREATION only, so attaching it after the dashboard has connected
 * silently collects nothing — and an assertion of "zero frames while shed"
 * would then pass for the wrong reason. It therefore cannot filter by session
 * id up front (no session exists yet); callers filter on read.
 */
function collectStatusFrames(page: Page): { seen: StatusFrame[]; forSession: (id: string) => StatusFrame[] } {
  const seen: StatusFrame[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      const raw = String(frame.payload);
      if (!raw.includes("session_updated")) return;
      try {
        const msg = JSON.parse(raw) as { type?: string; sessionId?: string; updates?: Record<string, unknown> };
        if (msg.type === "session_updated" && msg.sessionId) {
          seen.push({ sessionId: msg.sessionId, updates: msg.updates ?? {} });
        }
      } catch {
        /* non-JSON frame */
      }
    });
  });
  return { seen, forSession: (id) => seen.filter((f) => f.sessionId === id) };
}

/**
 * Every `session_removed` frame this PAGE receives, in arrival order.
 *
 * Sibling of `collectStatusFrames`, and installed the same way (before
 * navigation, since `page.on("websocket")` fires on socket creation only).
 * A shed `session_removed` is a reconcile debt too now, and because the debt
 * register keeps ONE kind per id (last-write-wins, `updated` cannot downgrade a
 * pending lifecycle kind), a teardown that sheds both `session_updated{ended}`
 * and the following `session_removed` reconciles to exactly this frame — the
 * status update is superseded, never emitted alongside it.
 * See change: close-registry-frame-shed-gaps.
 */
function collectRemovedFrames(page: Page): { seen: string[]; forSession: (id: string) => string[] } {
  const seen: string[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      const raw = String(frame.payload);
      if (!raw.includes("session_removed")) return;
      try {
        const msg = JSON.parse(raw) as { type?: string; sessionId?: string };
        if (msg.type === "session_removed" && msg.sessionId) seen.push(msg.sessionId);
      } catch {
        /* non-JSON frame */
      }
    });
  });
  return { seen, forSession: (id) => seen.filter((s) => s === id) };
}

/**
 * Toggle the injector. Asserts the ENABLE call reports `forceShed: true`, which
 * is what proves `PI_E2E_FORCE_SHED=1` actually reached the server — without
 * that check a harness booted without the flag would silently turn every
 * scenario below into a no-op that passes.
 */
async function setForceShed(page: Page, enabled: boolean): Promise<void> {
  const body = await page.evaluate(async (on) => {
    const res = await fetch("/api/test/force-shed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: on }),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }, enabled);
  expect(body.status, "force-shed route must exist (PI_E2E_FORCE_SHED=1)").toBe(200);
  expect(body.json?.data?.forceShed).toBe(enabled);
}

interface ReconcileCounters {
  queued: number;
  sent: number;
}

async function reconcileCounters(page: Page): Promise<ReconcileCounters> {
  return page.evaluate(async () => {
    const health = await (await fetch("/api/health")).json();
    return {
      queued: health.droppedFrames.statusReconcileQueued as number,
      sent: health.droppedFrames.statusReconcileSent as number,
    };
  });
}

test.describe.configure({ mode: "serial" });

test.describe("shed session_updated is reconciled in the rendered UI", () => {
  test.afterEach(async ({ page }) => {
    // Never leave the injector on: it is process-wide, and a leaked `true`
    // would starve every subsequent spec of transcript frames.
    await setForceShed(page, false).catch(() => {});
  });

  test("a stale card heals after the socket drains, with no reload (test-plan #F1)", async ({
    page,
  }) => {
    test.fixme(true, "https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/683"); // quarantine: see issue #683
    await gotoDashboard(page);
    const card = await spawnFreshGitSession(page);
    const sessionId = (await card.getAttribute("data-session-id"))!;
    await card.click();
    await expect.poll(() => statusShape(page, sessionId), { timeout: 30_000 }).toBe("idle");

    const before = await reconcileCounters(page);
    await setForceShed(page, true);

    // A long tool call — the incident's exact shape. The status frame is
    // emitted once at the start and then the session goes quiet for seconds,
    // which is what makes a single shed frame visible for the whole call.
    await sendPrompt(page, "[[faux:subagent-slow-inner]] run the sustained probe");

    // The shed is REAL, not assumed: the server recorded a debt for it.
    await expect
      .poll(async () => (await reconcileCounters(page)).queued, { timeout: 30_000 })
      .toBeGreaterThan(before.queued);

    // …and the card is stale — still idle while the server says streaming.
    expect(await statusShape(page, sessionId)).toBe("idle");

    // Drain. No reload, no navigation — only the socket recovering.
    const urlBefore = page.url();
    await setForceShed(page, false);

    await expect
      .poll(() => statusShape(page, sessionId), { timeout: 5_000 })
      .toBe("working");
    expect(page.url()).toBe(urlBefore);
    expect((await reconcileCounters(page)).sent).toBeGreaterThan(before.sent);
  });

  /**
   * The terminal edge is asserted on the WIRE plus the live-card claim, not on
   * an `ended` badge. Once a session ends its card leaves the live folder body
   * for the per-folder ended bucket, which is collapsed by default and
   * server-paged — so "is the badge `ended`" measures that disclosure
   * affordance, which this change does not touch. What the change owes is: the
   * edge is delivered exactly once after the drain, and the row stops rendering
   * as live.
   *
   * Since `close-registry-frame-shed-gaps` BOTH teardown frames are registry
   * frames, so the shed pair (`session_updated{ended}` then `session_removed`)
   * collapses in the debt register to one owed `removed`: the delivered frame is
   * the removal, and the superseded status frame is ABSENT (asserted — a
   * register that kept the first kind would emit the status frame instead, and
   * one that kept both would emit both).
   */
  test("an ended transition converges exactly once (test-plan #F2)", async ({ page }) => {
    test.fixme(true, "https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/683"); // quarantine: see issue #683
    const received = collectStatusFrames(page); // before any navigation
    const removed = collectRemovedFrames(page); // before any navigation
    await gotoDashboard(page);
    const card = await spawnFreshGitSession(page);
    const sessionId = (await card.getAttribute("data-session-id"))!;
    await card.click();
    await expect.poll(() => statusShape(page, sessionId), { timeout: 30_000 }).toBe("idle");

    const before = await reconcileCounters(page);
    await setForceShed(page, true);
    received.seen.length = 0; // only frames from here on are under test
    removed.seen.length = 0;

    // End the session while its frames are being shed. The bridge teardown
    // emits `session_updated {status:"ended"}` (event-wiring) followed by
    // `session_removed`. Both are registry frames now, so both are shed and
    // owed — and the register keeps ONE kind per id, so the pair collapses to a
    // single owed `removed`. See change: close-registry-frame-shed-gaps.
    const shutdown = await page.evaluate(
      async (id) => (await fetch(`/api/session/${id}/shutdown`, { method: "POST" })).status,
      sessionId,
    );
    expect(shutdown).toBe(200);

    // The edge was SHED AND OWED — not merely absent. Without this the
    // "no frame arrived" assertion below would also pass if the server had
    // never emitted the teardown frames at all, making the release step's
    // delivery unattributable to the reconcile.
    await expect
      .poll(async () => (await reconcileCounters(page)).queued, { timeout: 30_000 })
      .toBeGreaterThan(before.queued);

    // Neither frame landed, and the card is still rendering as live.
    expect(received.forSession(sessionId)).toHaveLength(0);
    expect(removed.forSession(sessionId)).toHaveLength(0);
    expect(await statusShape(page, sessionId)).toBe("idle");

    await setForceShed(page, false);

    // Delivered after the drain: the settled truth is the REMOVAL. The shed
    // `session_updated{ended}` is superseded by it, so no status frame arrives.
    await expect.poll(() => removed.forSession(sessionId).length, { timeout: 10_000 }).toBe(1);
    expect(received.forSession(sessionId)).toHaveLength(0);

    // …and the row stopped rendering as live.
    await expect
      .poll(() => statusShape(page, sessionId), { timeout: 10_000 })
      .not.toBe("idle");

    // Converged ONCE. The reconcile re-marks a shed frame as still-owed, so a
    // loop that failed to clear the debt would keep re-pushing the same row —
    // which shows up here as a second frame.
    await page.waitForTimeout(2_000);
    expect(removed.forSession(sessionId)).toHaveLength(1);
  });
});
