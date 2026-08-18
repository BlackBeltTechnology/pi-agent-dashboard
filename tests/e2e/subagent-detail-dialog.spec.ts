import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

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

// The subagent-tick throttle cadence rows (F1/P1/P2/F2/F5/P3/P4) moved to
// tests/e2e/subagent-tick-throttle.spec.ts — they require the synthetic
// Agent-tick producer on the PI_SYNTH_AGENT_TICKS=1 harness arm, because a
// nested faux subagent cannot sustain a >= 10 s tick stream (see change
// reduce-bridge-tick-bandwidth measurement.md, Bug 2).
