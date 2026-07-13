import { expect, test } from "@playwright/test";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * OPT-IN performance probe for change `reduce-chat-render-cpu-umbrella`
 * (tasks 2.8 / 4.4 / 5.1). Skipped unless PW_PERF=1.
 *
 * WHY OPT-IN / ADVISORY, not a blocking gate: absolute layout-throughput budgets
 * inside a shared Docker container are machine- and load-dependent, so they flake
 * as CI gates (design Decision 5 frames verification as a trace DIFF, not fixed
 * numbers). This spec captures the real Chrome metric so a human can confirm the
 * idle-churn win, and catches a gross regression back toward the ~85 layouts/s
 * baseline — but it is not part of the default `npm run test:e2e` run.
 *
 * MECHANISM: Chrome DevTools Protocol `Performance.getMetrics()` exposes the same
 * cumulative `LayoutCount` / `RecalcStyleCount` counters the DevTools Performance
 * panel derives layouts/s from. We sample them around a fixed idle window on a
 * settled long transcript and divide by the elapsed seconds.
 *
 * RUN: PW_PERF=1 PW_CHANNEL=chrome npm run test:e2e -- chat-render-perf
 * (PW_CHANNEL=chrome drives the system browser; bundled Chromium also works.)
 */

const LONG = "[[faux:long-transcript]] go";
const LONG_TRANSCRIPT_TAIL = "long-transcript complete"; // mirror qa/fixtures
const IDLE_MS = 10_000;
// Generous ceiling: baseline was ~85 layouts/s, Phase-1/2 target is <5/s. A
// 30/s ceiling flags a regression toward baseline churn without flaking on
// container CPU contention. Tighten locally when diffing against a baseline.
const MAX_LAYOUTS_PER_SEC = 30;

test.describe("chat render — idle layout budget (advisory, PW_PERF only)", () => {
  test.skip(!process.env.PW_PERF, "perf probe is opt-in: set PW_PERF=1");

  test("idle long-session layouts/s stays below the regression ceiling", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "CDP Performance metrics need a Chromium-family browser");
    test.setTimeout(240_000);

    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, LONG);
    // Settle: whole transcript streamed + committed before we measure idle.
    await expect(page.getByText(LONG_TRANSCRIPT_TAIL).last()).toBeVisible({ timeout: 180_000 });
    await byTestId(page, "chatScrollContainer").waitFor({ state: "visible" });

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const readCounter = async (name: string): Promise<number> => {
      const { metrics } = await cdp.send("Performance.getMetrics");
      return metrics.find((m) => m.name === name)?.value ?? 0;
    };

    // Sample cumulative counters around a fixed idle window (no input/scroll).
    const layout0 = await readCounter("LayoutCount");
    const recalc0 = await readCounter("RecalcStyleCount");
    const t0 = Date.now();
    await page.waitForTimeout(IDLE_MS);
    const elapsedSec = (Date.now() - t0) / 1000;
    const layoutsPerSec = (await readCounter("LayoutCount") - layout0) / elapsedSec;
    const recalcsPerSec = (await readCounter("RecalcStyleCount") - recalc0) / elapsedSec;

    testInfo.annotations.push({
      type: "perf",
      description: `idle layouts/s=${layoutsPerSec.toFixed(1)} recalcs/s=${recalcsPerSec.toFixed(1)} (window ${elapsedSec.toFixed(1)}s, ceiling ${MAX_LAYOUTS_PER_SEC}/s)`,
    });

    expect(layoutsPerSec).toBeLessThan(MAX_LAYOUTS_PER_SEC);
  });
});
