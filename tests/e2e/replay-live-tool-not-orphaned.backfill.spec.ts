import type { Browser, Page } from "@playwright/test";
import { LONG_STREAM_HOLD_TAIL } from "../../qa/fixtures/faux-scenarios.js";
import { expect, test } from "./fixtures.js";
import { gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import {
  climbToDivider,
  loadEarlier,
  type MemoryLimits,
  nudgeAscent,
  restartDashboard,
  WINDOW,
  watchBackfillFrames,
  writeLimits,
} from "./helpers/windowed-session.js";

/**
 * L3 — a STILL-RUNNING subagent whose `Agent` start falls into the lazy
 * backfill (tail-only replay, after a dashboard restart or a browser reload)
 * must render running, never "result not loaded", and must converge to
 * completed when the subagent finishes.
 *
 * Substrate: `faux:subagent-long-stream-hold` — one Agent call whose inner run
 * streams enough subagent events into the PARENT store to push the Agent start
 * out of a `WINDOW`-event tail, then holds ~75 s.
 *
 * Non-vacuity: each test proves the Agent start actually arrived in a
 * `history_backfill_result` (not the tail replay), so a window that happened to
 * keep the start in the tail cannot pass the test for free.
 *
 * Exemplars: `replay-live-tool-not-orphaned.spec.ts` (restart mid-call),
 * `helpers/windowed-session.ts` (arming a real window).
 * See change: fix-backfill-elides-live-tools (test-plan #F15, #F16).
 */

const RUNNING_CARD = '[data-testid="agent-activity-row"]';
const ELIDED_NOTE = '[data-testid="agent-elided-note"]';

let originalLimits: MemoryLimits = {};

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const cfg = (await (await page.request.get("/api/config")).json()) as { data?: { memoryLimits?: MemoryLimits } };
    originalLimits = cfg.data?.memoryLimits ?? {};
    await writeLimits(page, { ...originalLimits, maxReplayEvents: WINDOW, replayWindowMode: "tail-only" });
  } finally {
    await ctx.close();
  }
});

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    // Restore EXACTLY as read — never `?? 0`.
    await page.request.put("/api/config", { data: { memoryLimits: originalLimits } });
  } finally {
    await ctx.close();
    await restartDashboard();
  }
});

/** Spawn a session and start the long-stream-hold Agent; returns its id and the instant the card ran. */
async function startHoldingAgent(page: Page): Promise<{ sessionId: string; t0: number }> {
  const card = await spawnFreshGitSession(page);
  const sessionId = (await card.getAttribute("data-session-id")) ?? "";
  expect(sessionId).toBeTruthy();
  await card.click();
  await page.keyboard.press("Escape").catch(() => {});
  await sendPrompt(page, "[[faux:subagent-long-stream-hold]] go");
  await expect(page.locator(RUNNING_CARD).first()).toBeVisible({ timeout: 60_000 });
  return { sessionId, t0: Date.now() };
}

/**
 * Wait out the inner run's first hold (`sleep 40`) plus its streaming burst
 * (measured ~60 s in the harness; ~190 parent-store events), so the parent
 * store holds the stream AFTER any restart. The second hold (`sleep 90`) is
 * still running when this returns.
 */
async function waitForStream(page: Page, t0: number): Promise<void> {
  const remaining = t0 + 110_000 - Date.now();
  if (remaining > 0) await page.waitForTimeout(remaining);
}

/** True once a backfill result carried the Agent's `tool_execution_start`. */
function agentStartBackfilled(received: Array<Record<string, unknown>>): boolean {
  return received.some(
    (m) =>
      m.type === "history_backfill_result" &&
      Array.isArray(m.events) &&
      (m.events as Array<{ event?: { eventType?: string; data?: { toolName?: string } } }>).some(
        (e) => e.event?.eventType === "tool_execution_start" && e.event.data?.toolName === "Agent",
      ),
  );
}

/** Open the session and walk the backfill until the Agent start has been spliced in. */
async function backfillToAgentRow(page: Page, sessionId: string, received: Array<Record<string, unknown>>) {
  await gotoDashboard(page);
  const card = page.locator(`[data-session-id="${sessionId}"]`).first();
  await card.waitFor({ state: "visible", timeout: 60_000 });
  await card.click();
  await page.keyboard.press("Escape").catch(() => {});
  // Precondition: the replay was actually windowed with a gap to backfill.
  await expect
    .poll(() => received.some((m) => m.type === "history_window" && Number(m.gapCount) > 0), { timeout: 60_000 })
    .toBe(true);
  await expect
    .poll(
      async () => {
        if (agentStartBackfilled(received)) return true;
        // A transcript too short to scroll never fires the proximity auto-load:
        // press the divider's own "Load earlier" when it is offered.
        const load = loadEarlier(page);
        if (await load.isEnabled().catch(() => false)) {
          await load.click().catch(() => undefined);
        } else {
          await climbToDivider(page).catch(() => undefined);
          await nudgeAscent(page).catch(() => undefined);
        }
        return agentStartBackfilled(received);
      },
      { timeout: 60_000, intervals: [1_500] },
    )
    .toBe(true);
}

/** The shared invariants: running, never "result not loaded", then completed. */
async function assertRunningThenCompleted(page: Page): Promise<void> {
  await expect(page.locator(ELIDED_NOTE)).toHaveCount(0);
  await expect(page.locator(RUNNING_CARD).first()).toBeAttached({ timeout: 30_000 });
  await expect(page.locator(ELIDED_NOTE)).toHaveCount(0);
  await expect(page.getByText(LONG_STREAM_HOLD_TAIL).first()).toBeVisible({ timeout: 180_000 });
  await expect(page.locator(RUNNING_CARD)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(ELIDED_NOTE)).toHaveCount(0);
}

/**
 * "Reload" in a FRESH browser context. A same-context `page.reload()` resubscribes
 * from the IndexedDB replay cache as a DELTA, which is never windowed, so the
 * Agent start would never reach the backfill; a cold-cache reload (new device,
 * cleared storage, evicted cache) takes the windowed full-stream path the bug
 * lives on. `watchBackfillFrames` attaches BEFORE the page opens.
 */
async function reloadCold(browser: Browser, sessionId: string): Promise<void> {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const frames = watchBackfillFrames(page);
    await backfillToAgentRow(page, sessionId, frames.received);
    await assertRunningThenCompleted(page);
  } finally {
    await ctx.close();
  }
}

test.describe("a backfilled live Agent call is not 'result not loaded' (L3)", () => {
  test("#F15 after a dashboard restart the backfilled Agent card stays running, then completes", async ({
    page,
    browser,
  }) => {
    test.setTimeout(480_000);
    const { sessionId, t0 } = await startHoldingAgent(page);
    // Inside the inner run's first hold: the stream lands in the REBUILT store.
    await restartDashboard();
    await waitForStream(page, t0);
    await reloadCold(browser, sessionId);
  });

  test("#F16 after a browser reload the backfilled Agent card stays running, then completes", async ({
    page,
    browser,
  }) => {
    test.setTimeout(480_000);
    const { sessionId, t0 } = await startHoldingAgent(page);
    await waitForStream(page, t0);
    await reloadCold(browser, sessionId);
  });
});
