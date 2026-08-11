import { expect, test } from "./fixtures.js";
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

/**
 * test-plan #P1 — the promise-handling cleanup must not put an `await` in a
 * render or event-handler hot path.
 *
 * Same opt-in/advisory posture as the probe above, and for the same reason:
 * absolute latency inside a shared container is machine-dependent, so a fixed
 * budget flakes as a gate. The manifest's "p95 regression ≤ 10% vs the
 * pre-change commit" is a two-commit measurement — run this spec on the base
 * commit and on the change to compare the annotated p95 values.
 *
 * Note recorded during implementation: the classification record
 * (`openspec/changes/cleanup-client-plugin-promises/classification.md`) shows
 * **zero `await`s were added to product code** — all 86 product-code sites took
 * `.catch(handler)`. P1's premise therefore has no instance in this change;
 * this probe stands as the guard that keeps it true.
 *
 * See change: cleanup-client-plugin-promises.
 */
test.describe("settings surface interaction latency (advisory, PW_PERF only)", () => {
  test.skip(!process.env.PW_PERF, "perf probe is opt-in: set PW_PERF=1");

  // Generous ceiling for the same contention reasons as the probe above; the
  // meaningful signal is the annotated p95 diffed across two commits.
  const MAX_P95_MS = 3_000;
  const SAMPLES = 8;

  test("navigating the touched settings surfaces stays within the latency ceiling", async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);

    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });

    const rail = page.getByTestId("settings-nav-rail");
    const content = page.getByTestId("settings-content");
    const samples: number[] = [];

    // Alternate between two surfaces this change rewrote, timing each
    // navigation to a settled rendered state.
    for (let i = 0; i < SAMPLES; i++) {
      const label = i % 2 === 0 ? "Packages" : "Providers";
      const t0 = Date.now();
      await rail.getByRole("button", { name: label, exact: true }).click();
      await expect(content).toBeVisible();
      samples.push(Date.now() - t0);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)];

    testInfo.annotations.push({
      type: "perf",
      description: `settings-surface nav p95=${p95}ms over ${SAMPLES} samples (ceiling ${MAX_P95_MS}ms); compare against the same run on the pre-change commit for the ≤10% rule`,
    });

    expect(p95).toBeLessThan(MAX_P95_MS);
  });
});
