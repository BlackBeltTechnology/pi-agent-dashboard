import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { expandMountedToolOutputs } from "./helpers/tool-expand.js";

// File links are pre-confirmed in batches (change: rich-chat-links; test-plan P3, task 9.8).
//
// `[[faux:rich-links-flush]]` runs 30 finalized bash results with 20 distinct file mentions each, then a
// 31st tool that has already streamed 20 more mentions (`rl-flush/running-f*`) and is still running. The
// spec scrolls the transcript top→bottom over ~10 s and counts `POST /api/file/resolve-mentions` requests.

const WINDOW_MS = 1000;
const SCROLL_MS = 10_000;
/** A continuous scroll registers links every frame-ish; a gap longer than the 250 ms debounce is not a scroll. */
const SCROLL_STEP_MS = 100;

test.describe("rich-chat-links — batch flush rate (throughput)", () => {
  test("P3: at most one batch request per second, none carrying a still-running tool's mentions", async ({ page }) => {
    test.setTimeout(240_000); // 31 scripted turns + a ~10 s scroll
    const requests: Array<{ t: number; body: string }> = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/file/resolve-mentions")) {
        requests.push({ t: Date.now(), body: req.postData() ?? "" });
      }
    });

    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:rich-links-flush]] go");

    // The 31st tool is running (its sleep outlives the scroll); all 30 earlier results are finalized. Keep the
    // transcript pinned to its end until the running burst is mounted, so the workload starts while it runs.
    const scroller = page.getByTestId("chat-scroll-container");
    await expect(scroller).toBeVisible();
    await expect
      .poll(
        async () => {
          await scroller.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
          return page
            .locator('[data-testid="tool-burst-group"][data-running="true"]')
            .filter({ hasText: "sleep 90" })
            .count();
        },
        { timeout: 120_000, intervals: [200] },
      )
      .toBe(1);

    // Tool results are collapsed by default: opening them is part of the workload. Each pass opens whatever
    // is mounted, so scrolling top→bottom over ~10 s brings every result (and its 20 links) into view.
    const steps = SCROLL_MS / SCROLL_STEP_MS;
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    const scrollStart = Date.now();
    for (let i = 1; i <= steps; i++) {
      await scroller.evaluate(
        (el, frac) => {
          el.scrollTop = (el.scrollHeight - el.clientHeight) * frac;
        },
        i / steps,
      );
      await expandMountedToolOutputs(page);
      await page.waitForTimeout(SCROLL_STEP_MS);
    }
    await page.waitForTimeout(WINDOW_MS * 2); // let the last debounce flush
    // Not vacuous: the running tool is still running and its streamed links are on screen, unconfirmed.
    await expect(
      page.locator('[data-testid="tool-burst-group"][data-running="true"]').filter({ hasText: "sleep 90" }),
    ).toHaveCount(1);
    const streamed = page.locator("pre button", { hasText: "rl-flush/running-f1.ts" }).first();
    await expect(streamed).toBeVisible();
    await expect(streamed).toHaveAttribute("data-link-state", "unknown");
    const end = Date.now();

    expect(requests.length).toBeGreaterThan(0);
    // ≤ 1 request in every 1 s window (windows anchored at the first request).
    const first = requests[0].t;
    const perWindow = new Map<number, number>();
    for (const r of requests) {
      const w = Math.floor((r.t - first) / WINDOW_MS);
      perWindow.set(w, (perWindow.get(w) ?? 0) + 1);
    }
    expect({ perWindow: [...perWindow.entries()].filter(([, n]) => n > 1) }).toEqual({ perWindow: [] });
    // Total ≤ the number of 1 s windows the workload spans.
    expect(requests.length).toBeLessThanOrEqual(Math.ceil((end - first) / WINDOW_MS));
    // A still-running tool's mentions are never confirmed.
    expect(requests.filter((r) => r.body.includes("rl-flush/running-"))).toEqual([]);
    expect(end - scrollStart).toBeGreaterThanOrEqual(SCROLL_MS);
  });
});
