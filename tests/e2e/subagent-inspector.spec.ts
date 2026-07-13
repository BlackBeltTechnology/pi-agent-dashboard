import { expect, test } from "@playwright/test";
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
});
