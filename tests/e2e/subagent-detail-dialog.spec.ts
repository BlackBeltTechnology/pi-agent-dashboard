import { expect, test } from "./fixtures.js";
import {
  collectAgentTicks,
  sendPrompt,
  setSubagentTickThrottle,
  spawnFreshGitSession,
  type TickSample,
} from "./helpers/index.js";

// change: fix-subagent-live-detail-reliability (D4) — the subagent detail
// popout opens the shell `ui:dialog` primitive (parity with flow-agent-detail),
// NOT a `window.open(..., "_blank")` browser tab that breaks on Electron/PWA/
// mobile.
//
// Reuses the `subagent-spawn` faux scenario (qa/fixtures/faux-scenarios.ts):
// the parent emits an `Agent` tool call whose prompt embeds `[[faux:plain-text]]`,
// so pi spawns a REAL subagent and the subagents-plugin renders it through
// AgentToolRenderer (its card sits inside a tool-burst-group).
//
// Harness note: the faux subagent does not reliably resolve a `toolDetails.agentId`
// (it terminates before emitting a full AgentDetails), so the Popout affordance
// may stay DISABLED here. The POSITIVE dialog-open path (agentId present →
// dialog opens) is exercised deterministically in the AgentToolRenderer unit
// tests, where agentId is controllable. What THIS e2e proves through the real
// prompt → faux → bridge → /ws → renderer round-trip is the core D4 regression
// guard: activating the popout affordance NEVER opens a new browser tab/window
// (the retired `window.open` path), and — when agentId is present — opens a
// `ui:dialog` dismissable with Esc. Needs PI_E2E_SEED=1.
test.describe("subagent detail dialog (D4)", () => {
  test("popout never opens a new browser tab; opens a ui:dialog when agentId resolves", async ({ page, context }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    // A card-centre click can land on the card's OpenSpec "Propose" affordance,
    // leaving a modal overlay that intercepts the composer's send button. Not a
    // product assertion — just dismiss a stray modal before prompting.
    await page.keyboard.press("Escape").catch(() => {});

    await sendPrompt(page, "[[faux:subagent-spawn]] go");

    // Subagent card mounts and the parent round-trip settles.
    await expect(page.getByText(/faux subagent probe/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/subagent spawn complete/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // The Agent card sits inside a collapsed tool-burst-group; expand every
    // "Explore: faux subagent probe" toggle (group header + member row) until
    // the AgentToolRenderer CardControls (Details + Popout pills) surface.
    const popout = page.getByRole("button", { name: "Popout" }).first();
    const toggles = page.getByRole("button", { name: /Explore: faux subagent probe/i });
    for (let i = 0; i < (await toggles.count()); i++) {
      // Break on VISIBILITY, not DOM presence: the Popout button may exist in a
      // collapsed tool-burst-group but stay hidden until the group is expanded.
      if (await popout.isVisible().catch(() => false)) break;
      await toggles.nth(i).click();
    }
    await expect(popout).toBeVisible({ timeout: 30_000 });

    // No dialog before activation.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Arm a popup watcher: the retired window.open path would fire a `popup`
    // event and add a second context page.
    //
    // `popup` is a PAGE event, not a BrowserContext one. This previously read
    // `context.waitForEvent("popup", …)`, which could never fire — the watcher
    // was dead and the guard below rested on the page-count check alone. Fixed
    // when tests/ was first typechecked (change: fix-e2e-harness-memory-exhaustion).
    const popupPromise = page.waitForEvent("popup", { timeout: 3_000 }).catch(() => null);
    const pagesBefore = context.pages().length;

    if (await popout.isEnabled()) {
      // agentId resolved → popout opens the ui:dialog.
      await popout.click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    } else {
      // agentId unresolved (faux harness) → disabled affordance opens nothing.
      await popout.click({ force: true });
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    // Core D4 regression guard: NO new browser tab/window was ever opened.
    expect(await popupPromise).toBeNull();
    expect(context.pages().length).toBe(pagesBefore);
  });

  // F4 (change: collapse-superseded-tool-execution-updates) — collapse is
  // RETENTION-only: it removes superseded events from the store buffer and never
  // suppresses a live broadcast. The live view must therefore keep advancing at
  // the producer's cadence while a subagent runs.
  //
  // `subagent-sustained` keeps the subagent alive ~6 s across three sleeping
  // bash calls, so the parent's Agent tool emits ticks throughout. Sampling the
  // rendered card over a 10 s window must observe ≥ 2 DISTINCT states; a
  // collapse that (wrongly) suppressed broadcast would freeze it at one.
  test("the live subagent timeline keeps advancing while collapse is active", async ({ page }) => {
    // F4 asserts collapse is RETENTION-ONLY: it bounds what the store keeps and
    // never suppresses a live broadcast. That claim is about the wire, not the
    // DOM — so it is asserted on the /ws frames the browser actually receives.
    //
    // An earlier revision sampled `body.innerText()` for "≥ 2 distinct states".
    // That was VACUOUS: a probe showed the only text changing during a
    // sustained run is the elapsed-time counter ("2s" -> "13s") and the sidebar
    // token counters — so it passed off a ticking clock even with zero subagent
    // ticks on the wire. Counting real `tool_execution_update` frames cannot.
    // See change: collapse-superseded-tool-execution-updates (test-plan F4).
    const updateFrames: string[] = [];
    page.on("websocket", (ws) => {
      ws.on("framereceived", (frame) => {
        const payload = typeof frame.payload === "string" ? frame.payload : "";
        if (payload.includes("tool_execution_update")) updateFrames.push(payload);
      });
    });

    const card = await spawnFreshGitSession(page);
    await card.click();

    const before = await page.request.get("/api/health");
    const beforeBody = (await before.json()) as { storeTrim: { collapsedUpdates: number } };

    await sendPrompt(page, "[[faux:subagent-sustained]] go");

    const agentCard = page.getByText(/faux sustained subagent/i).first();
    await expect(agentCard).toBeVisible({ timeout: 60_000 });

    // Let the sustained run produce its tick stream.
    await expect
      .poll(() => updateFrames.length, { timeout: 30_000, intervals: [500] })
      .toBeGreaterThanOrEqual(2);

    const after = await page.request.get("/api/health");
    const afterBody = (await after.json()) as { storeTrim: { collapsedUpdates: number } };

    // Both halves must hold in the SAME window, else the test proves nothing:
    //   - collapse actually engaged (retention bounded), AND
    //   - the browser still received a live tick stream (nothing suppressed).
    expect(afterBody.storeTrim.collapsedUpdates).toBeGreaterThan(
      beforeBody.storeTrim.collapsedUpdates,
    );
    expect(updateFrames.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Subagent tick throttle (change: reduce-bridge-tick-bandwidth) ───────────
//
// Every row here counts frames FILTERED BY `toolName === "Agent"`. The F4 test
// above counts all `tool_execution_update` frames, which is right for its own
// claim and wrong for these: an unfiltered count can be carried entirely by
// unrelated tools and would pass at any window value.
//
// A DOM-cadence assertion is deliberately absent. The sibling `subagents:*`
// carrier is throttled by the PRODUCER at 250 ms and is what paces the rendered
// view; no window on THIS carrier can lower that, so a rendered-rate assertion
// would pass at any value and prove nothing.
const W = 500;
const MEASURE_MS = 10_000;

test.describe("subagent tick throttle — wire cadence", () => {
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
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});

    await sendPrompt(page, "[[faux:subagent-streaming]] go");
    await expect(page.getByText(/faux streaming subagent/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // Measure over a fixed window that starts once ticks are actually flowing,
    // so the window covers the producer's burst rather than its spin-up.
    await expect.poll(() => ticks.agent().length, { timeout: 60_000 }).toBeGreaterThan(0);
    const start = ticks.agent()[0]!.at;
    await page.waitForTimeout(MEASURE_MS);
    const inWindow = ticks.agent().filter((s) => s.at - start <= MEASURE_MS);

    // F1 — the floor, on the throttled carrier's OWN frames: >= 1 per 2 s.
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

    // Same fixture, measured twice in ONE spec so the comparison is against a
    // rate observed on this machine under this load, not a hardcoded constant.
    // One page and one collector: each run's window is sliced out by time, and
    // each run gets a FRESH session because the bridge reads the config once at
    // init (a running bridge keeps the old window).
    await page.goto("/");
    const ticks = collectAgentTicks(page);

    const measure = async (windowValue: number): Promise<number> => {
      await setSubagentTickThrottle(page, windowValue);
      const seen = ticks.agent().length;
      const card = await spawnFreshGitSession(page);
      await card.click();
      await page.keyboard.press("Escape").catch(() => {});
      await sendPrompt(page, "[[faux:subagent-streaming]] go");
      await expect
        .poll(() => ticks.agent().length, { timeout: 60_000 })
        .toBeGreaterThan(seen);
      const start = ticks.agent()[seen]!.at;
      await page.waitForTimeout(MEASURE_MS);
      const inWindow = ticks
        .agent()
        .slice(seen)
        .filter((s) => s.at - start <= MEASURE_MS);
      return (inWindow.length / MEASURE_MS) * 1000;
    };

    const throttled = await measure(W);
    const unthrottled = await measure(0);

    // Doubles as the fixture's own non-vacuity check: if the streaming fixture
    // did not actually stream, `unthrottled` would sit at the throttled rate
    // and this fails rather than silently certifying a fake reduction.
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

    // Record BOTH tick and end frames with their arrival order, so the illegal
    // edge (a held tick landing after the terminal event) is directly visible.
    const events: Array<{ at: number; kind: "update" | "end"; toolCallId: string }> = [];
    page.on("websocket", (ws) => {
      ws.on("framereceived", (frame) => {
        const payload = typeof frame.payload === "string" ? frame.payload : "";
        if (!payload.includes("tool_execution_")) return;
        let parsed: any;
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
    await sendPrompt(page, "[[faux:subagent-sustained]] go");
    await expect(page.getByText(/sustained subagent complete/i).first()).toBeVisible({
      timeout: 120_000,
    });
    // Past one full window after the end, so a held frame would have fired.
    await page.waitForTimeout(3 * W);

    const ended = new Set(events.filter((e) => e.kind === "end").map((e) => e.toolCallId));
    expect(ended.size, "the run reached tool_execution_end").toBeGreaterThan(0);

    for (const id of ended) {
      const endAt = events.find((e) => e.kind === "end" && e.toolCallId === id)!.at;
      const late = events.filter(
        (e) => e.kind === "update" && e.toolCallId === id && e.at > endAt,
      );
      expect(late, `no Agent tick for ${id} after its end frame`).toEqual([]);
    }
  });

  test("F5: the cadence floor is NOT asserted while the producer is quiet", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await setSubagentTickThrottle(page, W);

    const ticks = collectAgentTicks(page);
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});
    // Sleep-heavy fixture: > 2 s stretches where `pushUpdate` has NO call site
    // firing, so zero ticks exist on either carrier.
    await sendPrompt(page, "[[faux:subagent-sustained-long]] go");
    await expect(page.getByText(/long sustained subagent complete/i).first()).toBeVisible({
      timeout: 120_000,
    });

    const agent = ticks.agent();
    expect(agent.length, "the quiet fixture still produced ticks").toBeGreaterThan(0);

    // The anti-vacuity guard, stated positively: this fixture DOES contain a
    // gap wider than the floor. That is exactly why F1 must not run on it — a
    // floor asserted here would be measuring the fixture's sleeps, not the
    // throttle. The throttle can delay a tick by at most one window and can
    // never CREATE one, so the invariant that holds during a quiet stretch is
    // the delay bound below, applied only to gaps the producer did not cause.
    const gaps = agent.slice(1).map((s, i) => s.at - agent[i]!.at);
    expect(Math.max(...gaps), "the sleep-heavy fixture has a quiet stretch > 2 s").toBeGreaterThan(
      2_000,
    );
    // Nothing else is asserted about cadence here — deliberately.
  });
});

// P4 — the parent change's F4 must stay non-vacuous under the throttle: with a
// 500 ms window on F4's OWN ~6 s fixture, Agent ticks alone must still clear
// its >= 2-frame bar, rather than the bar being met by unrelated tools' frames.
test.describe("subagent tick throttle — F4 non-vacuity (P4)", () => {
  test("F4's frame count is still carried by Agent ticks with the throttle on", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await setSubagentTickThrottle(page, W);

    const ticks = collectAgentTicks(page);
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});

    const before = await page.request.get("/api/health");
    const beforeBody = (await before.json()) as { storeTrim: { collapsedUpdates: number } };

    await sendPrompt(page, "[[faux:subagent-sustained]] go");
    await expect(page.getByText(/faux sustained subagent/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // F4's own bar, on F4's own poll budget.
    await expect
      .poll(() => ticks.all.length, { timeout: 30_000, intervals: [500] })
      .toBeGreaterThanOrEqual(2);

    const agentFrames: TickSample[] = ticks.agent();
    expect(
      agentFrames.length,
      "F4's bar is met by Agent ticks themselves, not by unrelated tools",
    ).toBeGreaterThanOrEqual(2);

    const after = await page.request.get("/api/health");
    const afterBody = (await after.json()) as { storeTrim: { collapsedUpdates: number } };
    expect(afterBody.storeTrim.collapsedUpdates).toBeGreaterThanOrEqual(
      beforeBody.storeTrim.collapsedUpdates,
    );
  });
});
