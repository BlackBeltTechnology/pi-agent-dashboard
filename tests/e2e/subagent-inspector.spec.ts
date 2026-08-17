import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Scenario 5.3 (change: add-flow-plugin-e2e-tests) — the subagents plugin render
// surface on real subagent activity.
//
// The `subagent-spawn` faux scenario (qa/fixtures/faux-scenarios.ts) emits an
// `Agent` tool call whose prompt embeds a `[[faux:plain-text]]` sentinel, so pi
// spawns a REAL subagent that resolves the plain-text scenario, replies once, and
// completes — firing the `subagents:*` lifecycle events the subagents-plugin
// bridge forwards. The client renders the subagent through AgentToolRenderer +
// the plugin's inline SubagentDetailView. Two-step so the PARENT session
// terminates after the subagent returns.
//
// Assertion: the subagent inspector surface mounts (the subagent card shows the
// spawned agent's description) AND the parent round-trip settles.
test.describe("subagents inspector (L3)", () => {
  test("spawned subagent renders its inspector surface", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    // A card-centre click can land on the card's OpenSpec "Propose" affordance,
    // leaving a modal overlay that intercepts the composer's send button. Not a
    // product assertion — just dismiss a stray modal before prompting.
    await page.keyboard.press("Escape").catch(() => {});

    await sendPrompt(page, "[[faux:subagent-spawn]] go");

    // The subagents plugin renders the spawned agent — its description
    // ("faux subagent probe") surfaces in the AgentToolRenderer card.
    await expect(page.getByText(/faux subagent probe/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // Parent round-trip settles after the subagent completes.
    await expect(page.getByText(/subagent spawn complete/i).first()).toBeVisible({
      timeout: 60_000,
    });
  });

  // F3 (change: collapse-superseded-tool-execution-updates) — collapsing
  // superseded `tool_execution_update` events must not strip the state a REPLAY
  // rebuilds the subagent card from. After a reload the client re-folds the
  // stored (collapsed) buffer; if the policy dropped a tick the reducer
  // accumulates from, the card degrades to the "Subagent not found" placeholder.
  test("a completed subagent still renders after a page reload", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:subagent-spawn]] go");
    await expect(page.getByText(/subagent spawn complete/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // Reload → the transcript is rebuilt from the stored, COLLAPSED buffer.
    await page.reload();
    await expect(page.getByText(/subagent spawn complete/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // Expand the Agent card (it sits inside a collapsed tool-burst-group).
    const toggles = page.getByRole("button", { name: /faux subagent probe/i });
    const count = await toggles.count();
    for (let i = 0; i < count; i++) {
      await toggles.nth(i).click().catch(() => {});
    }

    // The subagent surface is intact and the not-found placeholder never shows.
    await expect(page.getByText(/faux subagent probe/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/subagent not found/i)).toHaveCount(0);
  });

  // P2 (change: collapse-superseded-tool-execution-updates) — the collapse
  // FIRES in the production shape: a real session, a real subagent, sustained
  // ~250 ms ticks through the real bridge → store path.
  //
  // Observable narrowing, stated honestly: the manifest's companion half
  // ("retained tool_execution_update per toolCallId ≤ 2") has NO L3 observable —
  // the server exposes no event-enumeration REST surface, and adding one purely
  // for a test would ship a new public API to serve an assertion. That half is
  // owned deterministically at L1 (memory-event-store.test.ts E1/E6, which
  // assert the retained set exactly). What only L3 can prove — that the policy
  // engages at all on real producer output rather than on synthetic fixtures —
  // is asserted here via the additive `/api/health` counter.
  //
  // The port is never hardcoded: `baseURL` is derived from the harness state
  // file (tests/e2e/lifecycle.ts), so `/api/health` resolves to this run's
  // container.
  test("collapse fires on a real sustained subagent run", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    const before = await page.request.get("/api/health");
    const beforeBody = await before.json() as { storeTrim: { collapsedUpdates: number } };

    await sendPrompt(page, "[[faux:subagent-sustained]] go");
    await expect(page.getByText(/sustained subagent complete/i).first()).toBeVisible({
      timeout: 120_000,
    });

    const after = await page.request.get("/api/health");
    const afterBody = await after.json() as { storeTrim: { collapsedUpdates: number } };
    expect(afterBody.storeTrim.collapsedUpdates).toBeGreaterThan(
      beforeBody.storeTrim.collapsedUpdates,
    );
  });
});
