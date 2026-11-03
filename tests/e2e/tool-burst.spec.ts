import { test, expect } from "./fixtures.js";
import { spawnFreshGitSession, sendPrompt } from "./helpers/index.js";

// Faux round-trip — temporal tool-call BURST grouping.
//
// Sends `[[faux:burst-heterogeneous]]`; the faux fixture streams three DISTINCT
// bash calls (echo/echo/sleep+echo) then a final text. `groupToolBursts` wraps
// the run into one burst group:
//   • while the slow 3rd call runs → auto-expanded header "Working · N done"
//     + a live-command chip surfacing the running `$ sleep …`;
//   • once "burst complete" lands → auto-collapsed to "3 tool calls".
// Clicking the collapsed header re-expands the fixed-max-height scrollbox body.
//
// Scenario: qa/fixtures/faux-scenarios.ts → "burst-heterogeneous".
// See change: group-tool-call-bursts.
test.describe("faux round-trip — tool burst grouping", () => {
  test("burst forms, shows running header, then auto-collapses and re-expands", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:burst-heterogeneous]] go");

    const burst = page.getByTestId("tool-burst-group");
    await expect(burst).toBeVisible({ timeout: 30_000 });

    // While the slow 3rd call runs the burst is auto-expanded and the header
    // surfaces the live command (raced against the 2s sleep window).
    await expect(burst).toHaveAttribute("data-running", "true", { timeout: 10_000 });
    await expect(page.getByTestId("tool-burst-live-command")).toContainText("sleep");

    // Final text lands → burst auto-collapses to the honest done summary.
    await expect(page.getByText("burst complete").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tool-burst-header")).toContainText("3 tool calls");
    await expect(page.getByTestId("tool-burst-body")).toHaveCount(0);

    // Manual expand re-opens the scrollbox body with the member rows.
    await page.getByTestId("tool-burst-header").click();
    await expect(page.getByTestId("tool-burst-body")).toBeVisible();
    await expect(page.getByTestId("tool-burst-body")).toContainText("burst-one");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Running-burst auto-open is bounded by size (#1100).
// A running burst auto-expands only while it has ≤ 8 visible members; a larger
// one stays collapsed (live header + stop), so a new tool call never mounts the
// whole burst into its virtual row. Test-plan #F1, #P1, #P2.
// Scenarios: burst-heterogeneous (3 members) · burst-large (40 quick members,
// then two slow ones joining one after the other).
// See change: fix-chat-transcript-layout (design D1, tasks 1.14–1.16).
// ─────────────────────────────────────────────────────────────────────────

interface BurstSample {
  body: boolean;
  memberRows: number;
  rowHeight: number;
  groupHeight: number;
  nodes: number;
}

/**
 * Start an in-page rAF sampler over the (single) burst group: per frame, whether
 * its body is mounted, how many member rows it holds, its virtual-row height
 * and its DOM node count. Stops itself once `stopText` is on the page.
 */
async function startBurstSampler(page: import("@playwright/test").Page, stopText: string): Promise<void> {
  await page.evaluate((stop) => {
    const w = window as unknown as { __burstSamples: BurstSample[]; __burstSamplerDone: boolean };
    w.__burstSamples = [];
    w.__burstSamplerDone = false;
    const tick = () => {
      const group = document.querySelector<HTMLElement>('[data-testid="tool-burst-group"]');
      if (group) {
        const body = group.querySelector('[data-testid="tool-burst-body"]');
        const row = group.closest<HTMLElement>("[data-index]");
        w.__burstSamples.push({
          body: body != null,
          // Each member row (ToolCallStep) is a `.border-l-2` frame inside the body.
          memberRows: body ? body.querySelectorAll(".border-l-2").length : 0,
          rowHeight: (row ?? group).getBoundingClientRect().height,
          groupHeight: group.getBoundingClientRect().height,
          nodes: group.querySelectorAll("*").length,
        });
      }
      if (document.body.innerText.includes(stop)) {
        w.__burstSamplerDone = true;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, stopText);
}

async function burstSamples(page: import("@playwright/test").Page): Promise<BurstSample[]> {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __burstSamplerDone: boolean }).__burstSamplerDone), {
      timeout: 60_000,
    })
    .toBe(true);
  return page.evaluate(() => (window as unknown as { __burstSamples: BurstSample[] }).__burstSamples);
}

/** Open a session, send `burst-large`, and wait until the 40-member burst is collapsed with the first slow call running. */
async function startLargeBurst(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, "[[faux:burst-large]] go");
  await expect(page.getByTestId("tool-burst-live-command")).toContainText("big-late-one", { timeout: 60_000 });
  await expect(page.getByTestId("tool-burst-header")).toContainText("40 done");
  await expect(page.getByTestId("tool-burst-body")).toHaveCount(0);
}

test.describe("running burst auto-open is size-bounded (#1100)", () => {
  test("#F1 a ≤ 8-member burst expands while its next tool runs, collapses on end, never mounts > 8 rows", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:burst-heterogeneous]] go");
    await expect(page.getByTestId("tool-burst-group")).toBeVisible({ timeout: 30_000 });
    await startBurstSampler(page, "burst complete");
    const samples = await burstSamples(page);

    expect(samples.length).toBeGreaterThan(0);
    // The slow 3rd call starts after the first two ended: the body is open while it runs.
    expect(samples.some((s) => s.body), "body expanded while a member runs").toBe(true);
    expect(Math.max(...samples.map((s) => s.memberRows))).toBeLessThanOrEqual(8);
    // Settled: collapsed again (accepted flap, D1).
    await expect(page.getByTestId("tool-burst-header")).toContainText("3 tool calls");
    await expect(page.getByTestId("tool-burst-body")).toHaveCount(0);
  });

  test("#P1 a tool joining a 40-member collapsed burst causes no height step", async ({ page }) => {
    test.setTimeout(120_000);
    await startLargeBurst(page);
    const collapsedHeader = await page.getByTestId("tool-burst-group").evaluate((el) => el.getBoundingClientRect().height);
    // Window: first slow call running → it ends → the second joins and runs → done.
    await startBurstSampler(page, "large burst complete");
    const samples = await burstSamples(page);

    expect(samples.length, "sampled frames").toBeGreaterThan(30);
    expect(Math.max(...samples.map((s) => s.rowHeight))).toBeLessThanOrEqual(collapsedHeader + 40);
    expect(Math.max(...samples.map((s) => s.memberRows)), "no member row mounts").toBe(0);
    expect(samples.every((s) => !s.body)).toBe(true);
  });

  test("#P2 mount cost of a tool cycle in a 40-member burst stays header-only", async ({ page }) => {
    test.setTimeout(120_000);
    await startLargeBurst(page);
    const baseline = await page.getByTestId("tool-burst-group").evaluate((el) => el.querySelectorAll("*").length);
    await startBurstSampler(page, "large burst complete");
    const samples = await burstSamples(page);

    // Header-only: the live command / stop control / done-summary swap a few
    // nodes; a single member row alone is well over 20 nodes.
    expect(Math.max(...samples.map((s) => s.nodes))).toBeLessThanOrEqual(baseline + 20);
  });
});
