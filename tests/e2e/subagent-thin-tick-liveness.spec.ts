import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 for reduce-subagent-details-payload — what only a real browser against a
 * real bridge can prove: that stripping the timeline off intermediate frames
 * does not cost the user anything they could see.
 *
 * The `subagent-sustained` faux scenario spawns a REAL subagent that stays
 * alive ~6 s while the parent's Agent tool ticks roughly every 250 ms — the
 * exact push firehose this change removes.
 *
 * `baseURL` comes from the harness state file, so `/api/health` and the page
 * both resolve to this run's container. Never hardcode `:18000`.
 */
test.describe("subagent thin ticks — liveness + fidelity (L3)", () => {
  /** Expand every Agent card so the inline inspector (and its cadence) mounts. */
  async function openInspector(page: import("@playwright/test").Page): Promise<void> {
    const toggles = page.getByRole("button", { name: /faux sustained subagent/i });
    const count = await toggles.count();
    for (let i = 0; i < count; i++) {
      await toggles.nth(i).click().catch(() => {});
    }
  }

  // F1 — a MOUNTED inspector converges on a GROWING timeline with no
  // close/reopen. Today's `emptyTimeline` precondition makes this impossible;
  // the D4 v1 cadence is what restores it once the push stops.
  test("F1: an open inspector converges while the timeline grows", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:subagent-sustained]] go");
    await expect(page.getByText(/faux sustained subagent/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // Mount the inspector EARLY, while the subagent is still running, and never
    // touch it again — every later entry must arrive through the pull loop.
    await openInspector(page);

    // The inner scenario runs three sleeping bash calls; the last one's output
    // can only be on screen if the mounted view kept converging.
    await expect(page.getByText(/tick-three/i).first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/subagent not found/i)).toHaveCount(0);
  });

  // F2 — the late joiner: a browser that opens the session AFTER the timeline
  // has accumulated. This is the case that is BROKEN today past 20 entries,
  // because the resync reply's `entries` array was clobbered to a string.
  test("F2: a fresh browser populates an already-running subagent's timeline", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:subagent-sustained]] go");
    await expect(page.getByText(/faux sustained subagent/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // Reload MID-RUN: the new page has no accumulated state and must pull.
    await page.reload();
    await openInspector(page);

    await expect(page.getByText(/tick-three|slow inner complete/i).first()).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByText(/subagent not found/i)).toHaveCount(0);
  });

  // F5 — terminal fidelity: the finished run's timeline survives a refresh
  // unchanged. The terminal frame is never stripped precisely so this holds.
  test("F5: a completed run renders the same timeline after a refresh", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:subagent-sustained]] go");
    await expect(page.getByText(/sustained subagent complete/i).first()).toBeVisible({
      timeout: 120_000,
    });
    await openInspector(page);
    await expect(page.getByText(/tick-three/i).first()).toBeVisible({ timeout: 60_000 });

    await page.reload();
    await expect(page.getByText(/sustained subagent complete/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await openInspector(page);

    // Same timeline content after replay — the terminal frame carried it.
    await expect(page.getByText(/tick-three/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/subagent not found/i)).toHaveCount(0);
  });

  // D6 — the counters prove the mechanism engaged on real producer output:
  // thin ticks dominate, and the pull loop is not a new firehose.
  test("D6: subagent-tick counters move and stay mostly thin", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    const before = (await (await page.request.get("/api/health")).json()) as {
      storeTrim: { subagentTicks: number; subagentFatTicks: number };
    };

    await sendPrompt(page, "[[faux:subagent-sustained]] go");
    await expect(page.getByText(/sustained subagent complete/i).first()).toBeVisible({
      timeout: 120_000,
    });

    const after = (await (await page.request.get("/api/health")).json()) as {
      storeTrim: { subagentTicks: number; subagentFatTicks: number };
    };
    const ticks = after.storeTrim.subagentTicks - before.storeTrim.subagentTicks;
    const fat = after.storeTrim.subagentFatTicks - before.storeTrim.subagentFatTicks;
    expect(ticks).toBeGreaterThan(0);
    // Terminal frames and resync replies are legitimately fat; the intermediate
    // firehose is not. A majority-fat run means the strip did not engage.
    expect(fat).toBeLessThan(ticks);
  });

  // P5 (task 1.4) — the kill-switch measurement. Recorded, and asserted only
  // against the C4 abort threshold: an inspector-open share above 50 % of
  // subagent runtime means the fat payload flows anyway and this change buys
  // little. This run never opens an inspector, so the share must be ~0.
  test("P5: inspector-open share is measurable and below the C4 abort threshold", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:subagent-sustained]] go");
    await expect(page.getByText(/sustained subagent complete/i).first()).toBeVisible({
      timeout: 120_000,
    });

    const telemetry = await page.evaluate(() => {
      const read = (globalThis as Record<string, unknown>).__piSubagentInspectorTelemetry as
        | (() => { runtimeMs: number; inspectorOpenMs: number; share: number })
        | undefined;
      return read?.() ?? null;
    });

    // The signal exists at all — that alone is new (task 1.5).
    expect(telemetry).not.toBeNull();
    expect(telemetry!.runtimeMs).toBeGreaterThan(0);
    console.log(`[P5] inspector-open share: ${(telemetry!.share * 100).toFixed(1)}%`);
    expect(telemetry!.share).toBeLessThanOrEqual(0.5);
  });
});
