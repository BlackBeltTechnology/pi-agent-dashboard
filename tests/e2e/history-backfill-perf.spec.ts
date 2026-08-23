import type { Browser } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL, DASHBOARD_PORT } from "./lifecycle.js";

/**
 * L3 performance gate for `fix-lazy-history-backfill-ux` — test-plan P1 and P2,
 * **as amended by the task 1.2 measurement**.
 *
 * ── Why the metric changed ──────────────────────────────────────────────────
 * P1 originally asked for "time to first rendered transcript row: windowed ≥5×
 * faster". That is unmeasurable in principle, and the measurement said so:
 * 0.97× on a 4825-event session (340ms unwindowed vs 349ms windowed, median of
 * 5). The server ships replay in `REPLAY_BATCH_SIZE` (200) batches, so the FIRST
 * batch — and therefore the first painted row — lands at the same moment
 * whether 2000 or 20000 events follow it. Windowing does not touch that
 * observable, and scaling the workload would not have rescued the threshold:
 * at 20k the completion ratio grows, the first-row ratio stays ~1×.
 *
 * What windowing does improve, and what this file asserts:
 *   - DELIVERED EVENT COUNT — bounded by the budget. Fully deterministic.
 *   - WIRE BYTES — 57% smaller at 4825 events / 100-budget, 68% at 604.
 *   - FULL-REPLAY COMPLETION — constant-cost windowed, linear unwindowed.
 *     2.10× at 4825 events, 1.69× at the 604 this spec can afford to build.
 *
 * The first two carry the weight, deliberately: the sibling
 * `subscription-handler-window.test.ts` already records why this repo holds
 * windowing to "delivered event count and serialized wire bytes — never a
 * wall-clock threshold" (wall clock here is dominated by container load).
 * Completion time IS asserted, because the amendment names it, but at a
 * conservative 1.2× — comfortably under both measured ratios, so it fails on a
 * real regression rather than on a noisy neighbour.
 *
 * The budget is `MIN_REPLAY_WINDOW` (100) over a single `long-transcript`, not
 * the shipped 2000 over ~20k: building 20k events costs ~15 minutes on the
 * shared harness. The code path is identical and parametric — its behaviour AT
 * the shipped default is pinned deterministically at L1
 * (`subscription-handler-window.test.ts`, E7/E8/E9).
 *
 * See change: fix-lazy-history-backfill-ux (D7).
 */

const WINDOW = 100;
/** Conservative: measured 1.69× at this scale, 2.10× at 4825 events. */
const MIN_COMPLETION_RATIO = 1.2;
/** Conservative: measured 68% at this scale, 57% at 4825 events. */
const MIN_BYTE_REDUCTION = 0.4;

type MemoryLimits = Record<string, number>;

let originalLimits: MemoryLimits = {};
let sessionId = "";

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

interface Sample {
  completionMs: number;
  wireBytes: number;
  events: number;
  windowed: boolean;
}

/**
 * One cold open, measured at the WIRE.
 *
 * A FRESH browser context every time is load-bearing, not hygiene: its
 * IndexedDB is empty, so the client subscribes with `lastSeq: 0` and the server
 * serves a genuine FULL stream. Reusing a context would take the delta branch,
 * which is never windowed, and the comparison would silently measure nothing.
 */
async function measureOpen(browser: Browser): Promise<Sample> {
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  try {
    const page = await ctx.newPage();
    let wireBytes = 0;
    let events = 0;
    let windowed = false;
    let completedAt: number | null = null;

    page.on("websocket", (ws: import("@playwright/test").WebSocket) => {
      ws.on("framereceived", (frame: { payload: string | Buffer }) => {
        const raw =
          typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8");
        wireBytes += raw.length;
        try {
          const m = JSON.parse(raw) as { type?: string; isLast?: boolean; events?: unknown[] };
          if (m.type === "history_window") windowed = true;
          if (m.type === "event_replay") {
            events += m.events?.length ?? 0;
            if (m.isLast === true) completedAt = Date.now();
          }
        } catch {
          // non-JSON frame
        }
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`[data-session-id="${sessionId}"]`, { timeout: 60_000 });

    // Zero the counters AFTER the session list has loaded, so only the
    // transcript subscribe is measured.
    wireBytes = 0;
    events = 0;
    windowed = false;
    completedAt = null;

    const started = Date.now();
    await page.locator(`[data-session-id="${sessionId}"]`).click();
    await page.waitForSelector("[data-index]", { timeout: 120_000 });
    await expect.poll(() => completedAt !== null, { timeout: 60_000 }).toBe(true);

    return { completionMs: (completedAt ?? Date.now()) - started, wireBytes, events, windowed };
  } finally {
    await ctx.close();
  }
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function medianOf(browser: Browser, runs: number): Promise<Sample> {
  const samples: Sample[] = [];
  for (let i = 0; i < runs; i++) samples.push(await measureOpen(browser));
  return {
    completionMs: median(samples.map((s) => s.completionMs)),
    wireBytes: median(samples.map((s) => s.wireBytes)),
    events: samples[0].events,
    windowed: samples[0].windowed,
  };
}

test.describe.configure({ mode: "serial" });

test.describe("replay windowing — measured effect (P1, P2)", () => {
  test.setTimeout(900_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(900_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      const cfg = (await (await page.request.get("/api/config")).json()) as {
        data?: { memoryLimits?: MemoryLimits };
      };
      originalLimits = cfg.data?.memoryLimits ?? {};

      const card = await spawnFreshGitSession(page);
      sessionId = (await card.getAttribute("data-session-id")) ?? "";
      expect(sessionId).toBeTruthy();
      await card.click();

      const composer = page.getByPlaceholder(/message/i).first();
      await composer.waitFor({ state: "visible", timeout: 60_000 });
      await composer.fill("warmup");
      await expect(page.getByTestId("send-button")).toBeEnabled({ timeout: 120_000 });
      await composer.fill("");
      // P2's workload: tool-heavy, so it compacts POORLY. `compactEventsForReplay`
      // only drops superseded `message_update`s — tool events pass straight
      // through — which is exactly why such sessions still window, and why the
      // ~20:1 compaction ratio does not generalise.
      await sendPrompt(page, "[[faux:long-transcript]] go");
      await expect(page.getByText(/long-transcript complete/).first()).toBeVisible({
        timeout: 240_000,
      });
      await page.waitForTimeout(2_000);
    } finally {
      await ctx.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      // `beforeAll` spawns are never in the auto-reap delta, so this file must
      // end its own session or it trips the residual-session budget later.
      if (sessionId) {
        await page.request
          .post(`/api/session/${sessionId}/shutdown`, { timeout: 20_000 })
          .catch(() => undefined);
      }
      await page.request.put("/api/config", {
        data: {
          memoryLimits: { ...originalLimits, maxReplayEvents: originalLimits.maxReplayEvents ?? 0 },
        },
      });
    } finally {
      await ctx.close();
      await restartDashboard();
    }
  });

  test("P1/P2: windowing bounds the payload, cuts wire bytes, and completes sooner", async ({
    browser,
    page,
  }) => {
    // ── unwindowed baseline ────────────────────────────────────────────────
    await page.request.put("/api/config", {
      data: { memoryLimits: { ...originalLimits, maxReplayEvents: 0 } },
    });
    await restartDashboard();
    const unwindowed = await medianOf(browser, 5);

    // ── windowed ───────────────────────────────────────────────────────────
    await page.request.put("/api/config", {
      data: { memoryLimits: { ...originalLimits, maxReplayEvents: WINDOW } },
    });
    await restartDashboard();
    const windowed = await medianOf(browser, 5);

    // Premise: the session is big enough for the window to engage at all.
    // Without this the comparison below could pass by measuring nothing.
    expect(unwindowed.windowed, "no window at maxReplayEvents=0").toBe(false);
    expect(windowed.windowed, "a window was announced").toBe(true);
    expect(unwindowed.events).toBeGreaterThan(WINDOW);

    // ── P1a: the payload is BOUNDED by the budget. Deterministic. ──────────
    expect(windowed.events).toBeLessThanOrEqual(WINDOW);
    expect(windowed.events).toBeLessThan(unwindowed.events);

    // ── P1b: materially fewer wire bytes. Near-deterministic. ──────────────
    const byteReduction = 1 - windowed.wireBytes / unwindowed.wireBytes;
    expect(byteReduction).toBeGreaterThanOrEqual(MIN_BYTE_REDUCTION);

    // ── P1c: full replay COMPLETES sooner. The one wall-clock number, held ──
    //        to a conservative ratio for the reason in the file header.
    const completionRatio = unwindowed.completionMs / windowed.completionMs;
    expect(
      completionRatio,
      `completion ${unwindowed.completionMs}ms → ${windowed.completionMs}ms ` +
        `(${completionRatio.toFixed(2)}×), bytes -${(byteReduction * 100).toFixed(0)}%, ` +
        `events ${unwindowed.events} → ${windowed.events}`,
    ).toBeGreaterThanOrEqual(MIN_COMPLETION_RATIO);
  });
});
