import { expect, test } from "./fixtures.js";
import {
  collectAgentTicks,
  sendPrompt,
  setSubagentTickThrottle,
  spawnFreshGitSession,
} from "./helpers/index.js";

/**
 * L3 cadence rows for the subagent-tick throttle (change:
 * reduce-bridge-tick-bandwidth).
 *
 * SUBSTRATE — synthetic Agent-tick producer, NOT a nested faux subagent.
 * The bridge throttle keys ONLY on `toolName === "Agent"` +
 * `partialResult.details.agentId` (not on how a frame was produced). A nested
 * faux subagent cannot be scripted in the harness — its inner `createAgentSession`
 * resolves a different faux core with an empty response queue, so it dies after
 * ~2 no-op turns and never sustains a ≥ 10 s tick stream (see change
 * measurement.md, Bug 2). So these rows drive `qa/fixtures/faux-agent-ticks.ext.ts`
 * — an `Agent` tool that streams `tool_execution_update` frames at a fixed
 * cadence via a `[[ticks:<count>@<intervalMs>]]` sentinel. Proven: 240 @ 50 ms
 * (20 fps) OFF → 19.6 fps on /ws; throttled `W=500` → 2.00 fps.
 *
 * HARNESS ARM — this producer SHADOWS the real subagents `Agent` tool
 * (first-registration-wins), so it is staged ONLY under `PI_SYNTH_AGENT_TICKS=1`,
 * where `docker/test-entrypoint.sh` skips the subagents producer. This spec is
 * therefore GATED: it self-skips unless the Playwright process ALSO carries
 * `PI_SYNTH_AGENT_TICKS=1`. Run it on its own arm:
 *
 *   PI_E2E_SEED=1 PI_TEST_PEERS=both PI_SYNTH_AGENT_TICKS=1 ./docker/test-up.sh -d
 *   PORT=$(jq -r '.dashboardPort' .pi-test-harness.json)
 *   PW_E2E_USE_RUNNING=1 PW_E2E_PORT=$PORT PI_SYNTH_AGENT_TICKS=1 PW_CHANNEL=chrome \
 *     npx playwright test subagent-tick-throttle
 *   ./docker/test-down.sh
 *
 * Every row counts frames FILTERED BY `toolName === "Agent"` (via
 * `collectAgentTicks`). A DOM-cadence assertion is deliberately absent: the
 * sibling `subagents:*` carrier paces the rendered view at 250 ms regardless of
 * this throttle, so a rendered-rate assertion would pass at any window value.
 */

const W = 500;
const MEASURE_MS = 10_000;
// A `[[ticks:<count>@<intervalMs>]]` prompt sets the source cadence: 240 @ 50 ms
// ≈ 12 s of 20 fps — comfortably past the 10 s measurement window.
const STREAM = "[[faux:synthetic-agent-ticks]] go";
const QUIET = "[[faux:synthetic-agent-ticks-quiet]] go";
const DONE = /synthetic ticks scenario complete/i;

test.describe("subagent tick throttle — wire cadence (synthetic producer)", () => {
  test.skip(
    process.env.PI_SYNTH_AGENT_TICKS !== "1",
    "requires the PI_SYNTH_AGENT_TICKS=1 harness arm (synthetic Agent-tick producer shadows the real subagents Agent tool)",
  );

  test("F1/P1: throttled Agent ticks hold the cadence floor without exceeding ~2 Hz", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    // Config first: the bridge reads it once at init, so the session must be
    // spawned AFTER the write.
    await setSubagentTickThrottle(page, W);

    const ticks = collectAgentTicks(page);
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});
    await sendPrompt(page, STREAM);

    // Readiness is the first Agent tick on the wire (the synthetic tool renders
    // no subagent card, so there is no DOM text to await). Filter by THIS
    // session so a prior test's still-streaming producer cannot inflate the
    // count (the shared harness runs one container).
    const mine = () => ticks.agent().filter((s) => s.sessionId === sessionId);
    await expect.poll(() => mine().length, { timeout: 60_000 }).toBeGreaterThan(0);
    const start = mine()[0]!.at;
    await page.waitForTimeout(MEASURE_MS);
    const inWindow = mine().filter((s) => s.at - start <= MEASURE_MS);

    // F1 — the floor, on the throttled carrier's OWN frames: >= 5 in the 10 s
    // window (>= 1 per 2 s). At W=500 a 20 fps source yields ~20.
    expect(
      inWindow.length,
      "cadence floor: >= 5 Agent-tick frames in the 10 s window",
    ).toBeGreaterThanOrEqual(5);

    // P1 — the ceiling: mean over the WHOLE window, not per 1 s bucket. The
    // leading + trailing edges of adjacent 500 ms windows can legitimately put
    // 3 frames in one second.
    const rate = (inWindow.length / MEASURE_MS) * 1000;
    expect(rate, `throttled Agent-tick rate ${rate.toFixed(2)}/s`).toBeLessThanOrEqual(2.2);
  });

  test("P2: the reduction is real — throttle OFF runs at >= 4x the throttled rate", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // Measured twice in ONE spec so the comparison is against a rate observed on
    // this machine under this load, not a hardcoded constant. Each run gets a
    // FRESH session because the bridge reads the config once at init.
    await page.goto("/");
    const ticks = collectAgentTicks(page);

    const measure = async (windowValue: number): Promise<number> => {
      await setSubagentTickThrottle(page, windowValue);
      const card = await spawnFreshGitSession(page);
      const sessionId = await card.getAttribute("data-session-id");
      await card.click();
      await page.keyboard.press("Escape").catch(() => {});
      await sendPrompt(page, STREAM);
      // Isolate THIS run's frames by session id. Slicing by index alone is not
      // enough: the previous run's ~12 s producer can still be streaming into
      // this ~10 s window, and those frames carry a different sessionId.
      const mine = () => ticks.agent().filter((s) => s.sessionId === sessionId);
      await expect.poll(() => mine().length, { timeout: 60_000 }).toBeGreaterThan(0);
      const start = mine()[0]!.at;
      await page.waitForTimeout(MEASURE_MS);
      const inWindow = mine().filter((s) => s.at - start <= MEASURE_MS);
      return (inWindow.length / MEASURE_MS) * 1000;
    };

    const throttled = await measure(W);
    const unthrottled = await measure(0);

    // Doubles as the fixture's own non-vacuity check: if the synthetic producer
    // did not actually stream, `unthrottled` would sit at the throttled rate and
    // this fails rather than silently certifying a fake reduction.
    expect(
      unthrottled,
      `unthrottled ${unthrottled.toFixed(2)}/s vs throttled ${throttled.toFixed(2)}/s`,
    ).toBeGreaterThanOrEqual(4 * throttled);
  });

  test("F2: no Agent tick for a toolCallId arrives after its tool_execution_end", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await setSubagentTickThrottle(page, W);

    // Record BOTH tick and end frames with arrival order, so the illegal edge
    // (a held tick landing after the terminal event) is directly visible.
    const events: Array<{ at: number; kind: "update" | "end"; toolCallId: string }> = [];
    page.on("websocket", (ws) => {
      ws.on("framereceived", (frame) => {
        const payload = typeof frame.payload === "string" ? frame.payload : "";
        if (!payload.includes("tool_execution_")) return;
        let parsed: { event?: { eventType?: string; data?: { toolName?: string; toolCallId?: string } } };
        try {
          parsed = JSON.parse(payload);
        } catch {
          return;
        }
        const ev = parsed?.event;
        if (!ev || ev.data?.toolName !== "Agent") return;
        if (ev.eventType === "tool_execution_update") {
          events.push({ at: Date.now(), kind: "update", toolCallId: String(ev.data.toolCallId) });
        } else if (ev.eventType === "tool_execution_end") {
          events.push({ at: Date.now(), kind: "end", toolCallId: String(ev.data.toolCallId) });
        }
      });
    });

    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});
    await sendPrompt(page, STREAM);
    await expect(page.getByText(DONE).first()).toBeVisible({ timeout: 120_000 });
    // Past one full window after the end, so a held frame would have fired.
    await page.waitForTimeout(3 * W);

    const ended = new Set(events.filter((e) => e.kind === "end").map((e) => e.toolCallId));
    expect(ended.size, "the run reached tool_execution_end").toBeGreaterThan(0);

    for (const id of ended) {
      const endAt = events.find((e) => e.kind === "end" && e.toolCallId === id)!.at;
      const late = events.filter((e) => e.kind === "update" && e.toolCallId === id && e.at > endAt);
      expect(late, `no Agent tick for ${id} after its end frame`).toEqual([]);
    }
  });

  test("F5: the cadence floor is NOT asserted while the producer is quiet", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await setSubagentTickThrottle(page, W);

    const ticks = collectAgentTicks(page);
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});
    // The `-quiet` sentinel inserts a > 2 s gap before tick index 30, so there
    // is a stretch where the producer emits NOTHING — no floor may be asserted.
    await sendPrompt(page, QUIET);
    await expect(page.getByText(DONE).first()).toBeVisible({ timeout: 120_000 });

    const agent = ticks.agent().filter((s) => s.sessionId === sessionId);
    // >= 2 ticks so there is at least one gap to measure — else `Math.max` over
    // an empty array is `-Infinity` and the failure message misleads.
    expect(agent.length, "the quiet fixture produced a measurable tick sequence").toBeGreaterThan(1);

    // The anti-vacuity guard, stated positively: this fixture DOES contain a gap
    // wider than the floor, which is exactly why F1 must not run on it. The
    // throttle can delay a tick by at most one window and can never CREATE one,
    // so a wider gap is the producer's, not the throttle's.
    const gaps = agent.slice(1).map((s, i) => s.at - agent[i]!.at);
    expect(Math.max(...gaps), "the quiet fixture has a stretch > 2 s").toBeGreaterThan(2_000);
    // Nothing else is asserted about cadence here — deliberately.
  });

  test("P3: delivered Agent ticks stay within one window of each other (staleness bound)", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await setSubagentTickThrottle(page, W);

    // Measured on the LIVE wire, NOT via replayed stored events: the parent
    // `collapse-superseded-tool-execution-updates` change trims superseded
    // `tool_execution_update`s from the store, so a reload replays only a
    // bounded handful of Agent ticks — the stored stream cannot carry the
    // cadence (an earlier draft measured a single 12 s gap for exactly this
    // reason). The throttle's staleness guarantee lives on the wire: its
    // trailing timer delivers a frame every ≤ one window while the producer is
    // active, so consecutive DELIVERED ticks bound how stale a mid-run view can
    // get. The synthetic producer is CONTINUOUS (no producer-quiet gaps), so
    // every delivered gap is one the throttle is responsible for.
    const ticks = collectAgentTicks(page);
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});
    await sendPrompt(page, STREAM);

    // Isolate THIS run's frames (shared harness: a prior producer may still stream).
    const mine = () => ticks.agent().filter((s) => s.sessionId === sessionId);
    await expect.poll(() => mine().length, { timeout: 60_000 }).toBeGreaterThan(0);
    const start = mine()[0]!.at;
    await page.waitForTimeout(MEASURE_MS);
    const window = mine().filter((s) => s.at - start <= MEASURE_MS);
    expect(window.length, "a delivered tick stream to measure").toBeGreaterThan(10);

    const gaps = window.slice(1).map((s, i) => s.at - window[i]!.at);
    const sorted = [...gaps].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
    // p95 ≤ 1.5×W and max ≤ 3×W: the trailing timer targets one window; wire +
    // scheduling jitter and the leading/trailing edge pattern widen the tail
    // slightly, but a gap approaching 3 windows would mean a dropped trailing
    // flush (the staleness regression this guards).
    expect(p95, `p95 delivered-tick gap ${p95}ms`).toBeLessThanOrEqual(1.5 * W);
    expect(Math.max(...gaps), "max delivered-tick gap").toBeLessThanOrEqual(3 * W);
  });
});
