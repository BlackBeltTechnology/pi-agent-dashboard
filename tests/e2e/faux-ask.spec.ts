import { test, expect } from "./fixtures.js";
import { gotoDashboard, spawnFreshGitSession, sendPrompt } from "./helpers/index.js";

// Faux round-trip — interactive ask_user renderer.
//
// Sends `[[faux:ask-select]]`; the faux fixture streams an `ask_user` tool call
// (method `select`, options ["alpha","beta"]). The bridge surfaces it as an
// interactiveUi message → /ws → ChatView dispatches to SelectRenderer, which
// renders one clickable option button per choice. Asserting the "alpha" option
// button is visible proves the interactive select widget mounted end-to-end.
//
// Scenario args: qa/fixtures/faux-scenarios.ts → askScenario("select", { options }).

test.describe("faux round-trip — interactive ask_user", () => {
  test("select widget mounts for a faux ask_user tool call", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:ask-select]] go");

    await expect(
      page.getByRole("button", { name: /alpha/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});

// Rendered-UI behaviour for prompt-derived `currentTool`.
//
// `currentTool` is derived from live pi events, and the original
// `tool_execution_start{ask_user}` is not a transcript entry — so it is never
// replayed. Before this change, any bridge re-register ended with a synthetic
// `agent_start` that cleared the field, and a session genuinely blocked on the
// user rendered "Thinking…" forever.
//
// See change: restore-ask-user-tool-state-on-reconnect, test-plan #F6, #F8.
test.describe("prompt-derived tool state — rendered card", () => {
  /** Drive a faux session until it is genuinely parked on an `ask_user` prompt. */
  async function parkOnAskUser(page: import("@playwright/test").Page) {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:ask-select]] go");
    // The rendered option button proves the prompt is live and unanswered.
    await expect(
      page.getByRole("button", { name: /alpha/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
    return card;
  }

  /** `{ pid, startedAt }` identifying the current server process, or null while down. */
  async function serverIdentity(
    page: import("@playwright/test").Page,
  ): Promise<{ pid: number; startedAt: string } | null> {
    try {
      const res = await page.request.get("/api/health", { timeout: 5_000 });
      if (!res.ok()) return null;
      const body = (await res.json()) as { pid: number; startedAt: string };
      return body.pid == null ? null : { pid: body.pid, startedAt: body.startedAt };
    } catch {
      return null; // mid-restart: connection refused / empty response
    }
  }

  test("#F6 the card converges back to 'Needs you' after a dashboard server restart", async ({
    page,
  }) => {
    await gotoDashboard(page);

    // MUST be a session the dashboard did not spawn. `server.stop()` calls
    // `shutdownHeadlessProcesses()`, which SIGTERMs every dashboard-spawned pi
    // ("GONE and can never reattach"), so such a session cannot demonstrate a
    // reconnect — there would be nothing left to re-register. The harness
    // fixture (PI_E2E_INDEPENDENT_SESSION=1) launches a pi outside that
    // lifecycle, exactly like a TUI session a user started themselves.
    const listed = await page.request.get("/api/sessions");
    const { data } = (await listed.json()) as { data: Array<{ id: string; source: string }> };
    const independent = data.find((s) => s.source === "tui");
    test.skip(
      !independent,
      "needs the independent-pi fixture: PI_E2E_INDEPENDENT_SESSION=1 docker/test-up.sh",
    );

    const card = page.locator(
      `[data-testid="session-card-desktop"][data-session-id="${independent!.id}"]`,
    );
    await card.waitFor({ state: "visible", timeout: 30_000 });
    await card.click();

    // Park it on a real, unanswered prompt.
    await sendPrompt(page, "[[faux:ask-select]] go");
    await expect(
      page.getByRole("button", { name: /alpha/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("Needs you")).toBeVisible({ timeout: 15_000 });

    const before = await serverIdentity(page);
    expect(before, "server identity must be readable before restart").not.toBeNull();

    // Restart the dashboard server only — the pi session (a separate process)
    // stays alive and its bridge re-registers, replaying history and ending
    // with the synthetic `agent_start` that used to destroy the state.
    await page.request.post("/api/restart", { timeout: 10_000 }).catch(() => {
      // The server tears the socket down mid-response; a transport error here
      // is the expected shape of a successful restart request.
    });

    // Wait for a DIFFERENT server process. Without this the assertions below
    // race the restart and can pass against the pre-restart DOM — a vacuous
    // green that would not notice the bug this change exists to fix. It also
    // leaves the server healthy for the next test in the file.
    await expect
      .poll(async () => {
        const now = await serverIdentity(page);
        return now !== null && (now.pid !== before!.pid || now.startedAt !== before!.startedAt);
      }, { timeout: 120_000, intervals: [500] })
      .toBe(true);

    // Reload so the browser re-subscribes to the restarted server, then let the
    // bridge finish re-registering (register → prompt_request → replay_complete
    // → synthetic agent_start).
    await page.reload();

    // The SAME session must come back — proving it survived rather than being
    // replaced by a fresh spawn.
    await expect(card).toBeVisible({ timeout: 90_000 });
    // …blocked-on-you, not stuck on "Thinking…". This is the regression: the
    // reconnect ends with a synthetic `agent_start` that used to clear
    // `currentTool`, leaving a prompt-blocked session rendering as working.
    await expect(card.getByText("Needs you")).toBeVisible({ timeout: 60_000 });
    await expect(card.getByText("Thinking…")).toHaveCount(0);
  });

  test("#F8 answering the prompt clears the needs-you state", async ({ page }) => {
    const card = await parkOnAskUser(page);
    await expect(card.getByText("Needs you")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /alpha/i }).first().click();

    // The last prompt resolving clears `currentTool`, so the card must leave
    // the needs-you state — the clear path, not just the set path.
    await expect(card.getByText("Needs you")).toHaveCount(0, { timeout: 30_000 });
  });
});
