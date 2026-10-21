import { CHAT_MOTION_STREAM_TAIL } from "../../qa/fixtures/faux-scenarios.js";
import { expect, type Page, test } from "./fixtures.js";
import { byTestId, dismissToasts, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * OPT-IN render-cost gate for change: add-fluid-chat-motion (design D4;
 * test-plan #P1, #P2). Skipped unless PW_PERF=1.
 *
 * Paced reveal raises streaming-tail renders from per burst (~20/s) to up to per
 * frame, and the tail re-parses markdown on every step. D4 therefore sets a
 * budget measured on a ≥ 4000-char code + list answer streamed with motion on vs
 * off (reduced motion forces "off" — the code path is identical to pref off):
 *   P1  tail scripting time (CDP `Performance.getMetrics` ScriptDuration delta)
 *       motion-on ≤ 1.5× motion-off
 *   P2  p95 main-thread frame interval from an in-page rAF sampler < 16.7 ms
 *       (+0.3 ms measurement jitter) while streaming with motion on
 *
 * Both numbers are annotated so `openspec/changes/add-fluid-chat-motion/perf.md`
 * can quote them. Absolute budgets are machine-dependent; run on the CI
 * reference runner. RUN: PW_PERF=1 PW_E2E_USE_RUNNING=1 npm run test:e2e -- chat-motion-perf
 */

const STREAM = "[[faux:chat-motion-stream]] go";
const FRAME_BUDGET_MS = 16.7;
const JITTER_MS = 0.3;

interface Run {
  scriptMs: number;
  p95: number;
  frames: number;
}

async function streamAndMeasure(page: Page, reduced: boolean): Promise<Run> {
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  const card = await spawnFreshGitSession(page);
  await card.click();
  await dismissToasts(page);
  await byTestId(page, "chatScrollContainer").waitFor({ state: "visible", timeout: 30_000 });
  await page.evaluate(() => {
    const w = window as unknown as { __ft: number[] };
    w.__ft = [];
    const tick = (t: number) => {
      w.__ft.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const script = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "ScriptDuration")?.value ?? 0;
  const s0 = await script();
  const mark = await page.evaluate(() => (window as unknown as { __ft: number[] }).__ft.length);
  await sendPrompt(page, STREAM);
  await expect(page.getByText(CHAT_MOTION_STREAM_TAIL).last()).toBeVisible({ timeout: 120_000 });
  const scriptMs = ((await script()) - s0) * 1000;
  const ft = await page.evaluate((m) => (window as unknown as { __ft: number[] }).__ft.slice(m), mark);
  const intervals = ft.slice(1).map((t, i) => t - ft[i]).sort((a, b) => a - b);
  const p95 = intervals[Math.min(intervals.length - 1, Math.ceil(intervals.length * 0.95) - 1)] ?? 0;
  await cdp.detach();
  return { scriptMs, p95, frames: intervals.length };
}

test.describe("chat motion render cost (advisory, PW_PERF only)", () => {
  test.skip(!process.env.PW_PERF, "perf probe is opt-in: set PW_PERF=1");

  test("P1/P2: tail scripting ≤ 1.5× motion-off and p95 frame interval within budget", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "CDP Performance metrics need a Chromium-family browser");
    test.setTimeout(360_000);
    const off = await streamAndMeasure(page, true);
    const on = await streamAndMeasure(page, false);
    const ratio = on.scriptMs / Math.max(off.scriptMs, 1);
    testInfo.annotations.push({
      type: "perf",
      description: `scripting on=${on.scriptMs.toFixed(0)}ms off=${off.scriptMs.toFixed(0)}ms ratio=${ratio.toFixed(2)} (≤1.5) · p95 frame on=${on.p95.toFixed(1)}ms off=${off.p95.toFixed(1)}ms (<${FRAME_BUDGET_MS}) · frames on=${on.frames} off=${off.frames}`,
    });
    console.log(`[chat-motion-perf] ${testInfo.annotations.at(-1)?.description}`);
    expect(ratio, "P1 tail scripting ratio").toBeLessThanOrEqual(1.5);
    expect(on.p95, "P2 p95 frame interval").toBeLessThan(FRAME_BUDGET_MS + JITTER_MS);
  });
});
