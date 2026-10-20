/**
 * L3 — Supervised mode (dashboard tool approval), change: add-supervised-tool-approval.
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The L1 suites pin the gate's settlement table, the card's markup contract and the derived
 * `awaitingToolApproval` flag. Only a live browser against a real server + real bridge + faux
 * model proves: the card renders in the session's own transcript BEFORE the tool runs, each
 * answer (Allow once / Deny / reason / abort / timeout) reaches the agent as the right block
 * reason, a second surface converges on the first answer, the composer mode flip lands between
 * two tool calls of ONE turn, the mode survives reload / restart, and the attention routing
 * (needs-you, lane, toast) tracks the pending approval.
 *
 * Faux scenarios (qa/fixtures/faux-scenarios.ts): `tool-bash-echo`, `tool-bash-two-calls`,
 * `tool-write-notes`. The path-gate chain rows (F15–F18) live in
 * `supervised-approval-path-gate.spec.ts`; the Settings row (F22) in `supervised-settings.spec.ts`.
 *
 * Exemplars: `faux-ask.spec.ts`, `pending-prompt-recovery.spec.ts`, `composer-session-strip.spec.ts`,
 * `headless-reload-dispatch.spec.ts`, `keeper-restart-survival.spec.ts`.
 * test-plan: #F1–#F10, #F14, #F19–#F21, #F23.
 */
import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { FIXTURE_GIT, gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import {
  allowOnceBtn,
  approvalCard,
  browserCommand,
  clockSeconds,
  decisionRows,
  denyBtn,
  enableToolSurfaces,
  ensureFixturePinned,
  expectPendingCard,
  getConfig,
  openFreshSession,
  openSupervisedSession,
  putConfig,
  readSession,
  resolvedRow,
  revealToolBodies,
  runScenario,
  SUPERVISED_BASH_TAIL,
  selectSession,
  setMode,
  transcript,
} from "./helpers/supervised.js";

const TWO_CALLS_TAIL = "supervised two calls done";
const WRITE_TAIL = "supervised write done";

/** The `echo hi` tool OUTPUT (exact `hi`), distinct from the `echo hi` command text. Needs `revealToolBodies`. */
const toolOutputHi = (page: Page) => transcript(page).getByText("hi", { exact: true });
/** The live tool burst reads "Working" while a tool row is still running (before approval / after a stuck row). */
const toolRunning = (page: Page) => transcript(page).getByText("Working", { exact: true });
/** Settle + expand, then assert the tool ran and printed `hi`. */
async function expectToolRan(page: Page): Promise<void> {
  await revealToolBodies(page);
  await expect(toolOutputHi(page)).toBeVisible({ timeout: 15_000 });
}
/** Settle + expand, then assert the tool was blocked with `reason` and printed nothing. */
async function expectToolBlocked(page: Page, reason: string | RegExp): Promise<void> {
  await revealToolBodies(page);
  await expect(transcript(page).getByText(reason).first()).toBeVisible({ timeout: 15_000 });
  await expect(toolOutputHi(page)).toHaveCount(0);
}

// Wide enough that the composer settings row shows the mode chip inline (below `@[44rem]` it folds
// into ⋯, which #F23 covers explicitly; `setMode` handles both).
test.use({ viewport: { width: 1700, height: 900 } });

test.beforeEach(async ({ page }) => {
  await gotoDashboard(page);
  await enableToolSurfaces(page);
});

test.describe("supervised approval card (L3)", () => {
  test("#F1 a Supervised session asks before a risky tool runs", async ({ page }) => {
    await openSupervisedSession(page);
    await runScenario(page, "tool-bash-echo");

    const card = await expectPendingCard(page);
    await expect(card.getByTestId("tool-approval-title")).toHaveText("Run this command?");
    await expect(card.getByTestId("tool-approval-tool")).toHaveText("bash");
    await expect(card.getByTestId("tool-approval-command")).toHaveText("echo hi");
    // Not run yet: the turn has not reached its closing text, and the tool row for THIS call is
    // rendered and still running ("Working") beside the pending card.
    await expect(page.getByText(SUPERVISED_BASH_TAIL)).toHaveCount(0);
    await expect(toolRunning(page)).toBeVisible();
    await expect(transcript(page).getByText("$ echo hi").first()).toBeVisible();
    await expect(toolOutputHi(page)).toHaveCount(0);

    await denyBtn(page).click(); // leave the session clean
  });

  test("#F2 Allow once runs the tool and collapses to a resolved row naming the surface", async ({ page }) => {
    await openSupervisedSession(page);
    await runScenario(page, "tool-bash-echo");
    await expectPendingCard(page);

    await allowOnceBtn(page).click();

    await expect(page.getByText(SUPERVISED_BASH_TAIL)).toBeVisible({ timeout: 30_000 });
    // The tool row settled LIVE (no reload needed) and printed `hi`.
    await expectToolRan(page);
    await expect(approvalCard(page)).toHaveCount(0);
    const row = resolvedRow(page);
    await expect(row).toHaveAttribute("data-outcome", "approved");
    await expect(row.getByTestId("tool-approval-surface")).toHaveText("Dashboard");
  });

  test("#F3 Deny blocks the tool; the turn continues to its end", async ({ page }) => {
    await openSupervisedSession(page);
    await runScenario(page, "tool-bash-echo");
    await expectPendingCard(page);

    await denyBtn(page).click();

    await expect(page.getByText(SUPERVISED_BASH_TAIL)).toBeVisible({ timeout: 30_000 });
    await expectToolBlocked(page, /supervised: denied/);
    await expect(resolvedRow(page)).toHaveAttribute("data-outcome", "denied");
  });

  test("#F20 Deny with a reason hands the agent the operator's words", async ({ page }) => {
    await openSupervisedSession(page);
    await runScenario(page, "tool-bash-echo");
    await expectPendingCard(page);

    await page.getByTestId("tool-approval-deny-reason").click();
    await page.getByTestId("tool-approval-reason").fill("use a dry run");
    await page.getByTestId("tool-approval-deny-send").click();

    await expect(page.getByText(SUPERVISED_BASH_TAIL)).toBeVisible({ timeout: 30_000 });
    await expectToolBlocked(page, 'supervised: denied — operator said: "use a dry run"');
  });

  test("#F4 a browser reload replays the pending card, same deadline, still answerable", async ({ page }) => {
    await openSupervisedSession(page);
    await runScenario(page, "tool-bash-echo");
    await expectPendingCard(page);
    // Let the clock move off its opening value so a re-armed deadline would be detectable.
    await page.waitForTimeout(3_500);
    const before = await clockSeconds(page);
    expect(before).toBeLessThan(120);

    await page.reload();
    const card = await expectPendingCard(page, 60_000);
    await expect(card.getByTestId("tool-approval-command")).toHaveText("echo hi");
    const after = await clockSeconds(page);
    // Same absolute `deadline`: the countdown kept running (a new window would read ~2:00 again).
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeGreaterThan(0);

    await allowOnceBtn(page).click();
    await expect(page.getByText(SUPERVISED_BASH_TAIL)).toBeVisible({ timeout: 30_000 });
    await expectToolRan(page);
  });

  test("#F5 first response wins across surfaces; one decision entry", async ({ page, context }) => {
    const { sessionId } = await openSupervisedSession(page);
    await runScenario(page, "tool-bash-echo");
    await expectPendingCard(page);

    const second = await context.newPage();
    await gotoDashboard(second);
    await second.locator(`[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`).click();
    await expectPendingCard(second, 30_000);

    await allowOnceBtn(page).click();

    await expect(approvalCard(second)).toHaveCount(0, { timeout: 15_000 });
    await expect(second.getByText(SUPERVISED_BASH_TAIL)).toBeVisible({ timeout: 30_000 });
    await expectToolRan(second);
    // Exactly one durable decision entry, in BOTH views.
    await expect(decisionRows(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(decisionRows(second)).toHaveCount(1, { timeout: 15_000 });
    await second.close();
  });

  test("#F8 flipping to Full access never resolves a pending approval", async ({ page }) => {
    await openSupervisedSession(page);
    await runScenario(page, "tool-bash-echo");
    await expectPendingCard(page);

    await setMode(page, false);

    // Still pending, and the tool has still not run.
    await page.waitForTimeout(2_000);
    await expect(approvalCard(page)).toHaveCount(1);
    await expect(toolRunning(page)).toBeVisible();
    await expect(page.getByText(SUPERVISED_BASH_TAIL)).toHaveCount(0);
    await allowOnceBtn(page).click();
    await expect(page.getByText(SUPERVISED_BASH_TAIL)).toBeVisible({ timeout: 30_000 });
    await expectToolRan(page);
  });

  test("#F9 a write card shows the concrete action; the diff is collapsed until expanded", async ({ page }) => {
    await openSupervisedSession(page);
    await runScenario(page, "tool-write-notes");

    const card = await expectPendingCard(page);
    await expect(card.getByTestId("tool-approval-title")).toHaveText("Create this file?");
    await expect(card.getByTestId("tool-approval-tool")).toHaveText("write");
    await expect(card.getByTestId("tool-approval-path")).toHaveText("notes/x.txt");
    await expect(card).toContainText("+3");
    await expect(card).toContainText("−0");
    // Inside the workspace: the path gate stays silent, so this is the ONLY card.
    await expect(approvalCard(page)).toHaveCount(1);
    await expect(page.getByText(/outside its workspace/i)).toHaveCount(0);
    // Diff collapsed → expand shows the content.
    await expect(card.getByTestId("tool-approval-diff")).toHaveCount(0);
    await card.getByTestId("tool-approval-diff-toggle").click();
    await expect(card.getByTestId("tool-approval-diff")).toContainText("line one");

    await denyBtn(page).click();
    await expect(page.getByText(WRITE_TAIL)).toBeVisible({ timeout: 30_000 });
  });

  test.afterEach(() => {
    // The in-root write is denied, but never leave a leftover file in the shared fixture repo.
    try {
      execFileSync("docker", ["exec", resolveContainer(), "sh", "-c", `rm -rf ${FIXTURE_GIT}/notes`], { stdio: "ignore" });
    } catch {
      // harness may already be gone; nothing to clean
    }
  });
});

test.describe("supervised approval — expiry and abort (L3)", () => {
  let restore: { askUserPromptTimeoutSeconds?: number } = {};

  test.afterEach(async ({ page }) => {
    if (restore.askUserPromptTimeoutSeconds !== undefined) {
      await putConfig(page, { askUserPromptTimeoutSeconds: restore.askUserPromptTimeoutSeconds }).catch(() => undefined);
      restore = {};
    }
  });

  test("#F10 an expired approval leaves no answerable card in either surface", async ({ page, context }) => {
    test.setTimeout(120_000);
    // The bridge reads `askUserPromptTimeoutSeconds` at session start → set it BEFORE the spawn.
    const cfg = await getConfig<{ askUserPromptTimeoutSeconds?: number }>(page);
    restore = { askUserPromptTimeoutSeconds: cfg.askUserPromptTimeoutSeconds ?? 300 };
    await putConfig(page, { askUserPromptTimeoutSeconds: 3 }); // effective max(1, min(120, 3−1)) = 2 s

    const { sessionId } = await openSupervisedSession(page);
    const second = await context.newPage();
    await gotoDashboard(second);
    await second.locator(`[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`).click();

    await runScenario(page, "tool-bash-echo");
    // The 2 s window may close before the second surface paints: assert the END state on both.
    await expect(approvalCard(page)).toHaveCount(0, { timeout: 30_000 });
    await expect(approvalCard(second)).toHaveCount(0, { timeout: 30_000 });
    await expect(allowOnceBtn(page)).toHaveCount(0);
    await expect(allowOnceBtn(second)).toHaveCount(0);
    await expect(page.getByText(SUPERVISED_BASH_TAIL)).toBeVisible({ timeout: 30_000 });
    await expectToolBlocked(page, /supervised: timeout/);
    await second.close();
  });

  test("#F21 aborting the turn withdraws the pending card everywhere; no late allow", async ({ page, context }) => {
    const { sessionId } = await openSupervisedSession(page);
    await runScenario(page, "tool-bash-echo");
    await expectPendingCard(page);
    const second = await context.newPage();
    await gotoDashboard(second);
    await second.locator(`[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`).click();
    await expectPendingCard(second, 30_000);

    await page.getByTestId("stop-button").click();

    await expect(approvalCard(page)).toHaveCount(0, { timeout: 30_000 });
    await expect(approvalCard(second)).toHaveCount(0, { timeout: 30_000 });
    // No late allow: the command never ran. The bridge blocks with `supervised: aborted` (pinned at L1,
    // X15/X16), but pi's agent loop replaces ANY block reason with its own "Operation aborted" once the
    // turn signal is aborted (agent-loop.js), so the rendered row reads that, and the decision row
    // records the outcome (`Blocked, turn aborted`).
    await page.waitForTimeout(1_500);
    for (const p of [page, second]) {
      await expectToolBlocked(p, "Operation aborted");
      await expect(decisionRows(p).filter({ hasText: "Blocked, turn aborted" })).toHaveCount(1);
    }
    await second.close();
  });
});

test.describe("supervised live toggle mid-turn (L3)", () => {
  test("#F6 flipping ON during call 1 spares call 1 and asks for call 2", async ({ page }) => {
    test.setTimeout(120_000);
    await openFreshSession(page); // Full access
    await runScenario(page, "tool-bash-two-calls");
    // Call 1 (`sleep 5`) is running un-gated; flip while it sleeps.
    await expect(transcript(page).getByText("sleep 5").first()).toBeVisible({ timeout: 30_000 });
    await setMode(page, true);

    const card = await expectPendingCard(page, 60_000);
    await expect(card.getByTestId("tool-approval-command")).toHaveText("echo two");
    // Call 1 never raised a card.
    await expect(page.getByTestId("tool-approval-command").filter({ hasText: "sleep" })).toHaveCount(0);

    await allowOnceBtn(page).click();
    await expect(page.getByText(TWO_CALLS_TAIL)).toBeVisible({ timeout: 30_000 });
  });

  test("#F7 flipping OFF during call 1 lets call 2 run without a card", async ({ page }) => {
    test.setTimeout(120_000);
    await openSupervisedSession(page);
    await runScenario(page, "tool-bash-two-calls");
    const card = await expectPendingCard(page);
    await expect(card.getByTestId("tool-approval-command")).toHaveText("sleep 5");
    await allowOnceBtn(page).click(); // call 1 approved → sleeping
    await setMode(page, false);

    await expect(page.getByText(TWO_CALLS_TAIL)).toBeVisible({ timeout: 60_000 });
    // `echo two` ran (output "two") with no card of its own.
    await revealToolBodies(page);
    await expect(transcript(page).getByText("two", { exact: true })).toBeVisible();
    await expect(page.getByTestId("tool-approval-command").filter({ hasText: "echo two" })).toHaveCount(0);
    await expect(approvalCard(page)).toHaveCount(0);
  });
});

test.describe("supervised mode persistence (L3)", () => {
  /** The next risky call raises a card (proves the mode really is Supervised in the bridge). */
  async function expectNextBashAsks(page: Page): Promise<void> {
    await runScenario(page, "tool-bash-echo");
    await expectPendingCard(page, 60_000);
    await denyBtn(page).click();
    await expect(page.getByText(SUPERVISED_BASH_TAIL).last()).toBeVisible({ timeout: 30_000 });
  }
  const chipMode = (page: Page) => page.getByTestId("session-mode-chip").getAttribute("data-mode");

  async function serverIdentity(page: Page): Promise<{ pid: number; startedAt: string } | null> {
    try {
      const res = await page.request.get("/api/health", { timeout: 5_000 });
      if (!res.ok()) return null;
      const body = (await res.json()) as { pid?: number; startedAt: string };
      return body.pid == null ? null : { pid: body.pid, startedAt: body.startedAt };
    } catch {
      return null; // mid-restart
    }
  }

  test("#F14(c) the mode survives a browser reload", async ({ page }) => {
    await openSupervisedSession(page);
    await page.reload();
    await expect(page.getByTestId("session-mode-chip")).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => chipMode(page), { timeout: 30_000 }).toBe("supervised");
    await expectNextBashAsks(page);
  });

  test("#F14(a) the mode survives an extension reload (/reload)", async ({ page }) => {
    // In-process reload (default spawn strategy): same session id, same pi process — the bridge
    // is torn down and re-created, so the mode must come back from the `supervised-mode` entry.
    // (A headless respawn of the harness's faux session persists no transcript and registers a
    // NEW session id, which by design inherits nothing — E30 — so it cannot witness restore.)
    test.setTimeout(300_000);
    const { sessionId } = await openSupervisedSession(page);
    await sendPrompt(page, "/reload");
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Array.from(document.querySelectorAll("code"))
              .filter((c) => c.textContent?.trim() === "/reload")
              .map((c) => c.nextElementSibling?.textContent?.trim() ?? "")
              .join(","),
          ),
        { timeout: 90_000, message: "the /reload pill terminates" },
      )
      .toMatch(/completed|failed/);
    await expect
      .poll(async () => (await readSession(page, sessionId))?.status ?? "missing", { timeout: 120_000 })
      .not.toBe("ended");
    await selectSession(page, sessionId);
    await expect.poll(() => chipMode(page), { timeout: 60_000 }).toBe("supervised");
    await expectNextBashAsks(page);
  });

  test("#F14(b) the mode survives a dashboard server restart", async ({ page }) => {
    test.setTimeout(300_000);
    const { sessionId } = await openSupervisedSession(page);
    const before = await serverIdentity(page);
    expect(before, "server identity readable before restart").not.toBeNull();

    await page.request.post("/api/restart", { timeout: 10_000 }).catch(() => undefined);
    await expect
      .poll(async () => (await serverIdentity(page))?.startedAt ?? "down", { timeout: 120_000 })
      .not.toBe(before!.startedAt);
    // The bridge re-registers; the server's persisted `{on,rev}` and the bridge reconcile.
    await expect
      .poll(async () => (await readSession(page, sessionId))?.supervised, { timeout: 120_000 })
      .toBe(true);
    await gotoDashboard(page);
    await selectSession(page, sessionId);
    await expect.poll(() => chipMode(page), { timeout: 60_000 }).toBe("supervised");
    await expectNextBashAsks(page);
  });
});

test.describe("supervised attention routing (L3)", () => {
  let restoreSupervisedTimeout: number | undefined;

  test.afterEach(async ({ page }) => {
    await browserCommand({ type: "set_default_group_by", mode: "none" }).catch(() => undefined);
    if (restoreSupervisedTimeout !== undefined) {
      const cfg = await getConfig<{ supervisedMode?: { default: string; timeoutSeconds: number; tools: string[] } }>(page);
      await putConfig(page, {
        supervisedMode: { ...(cfg.supervisedMode ?? { default: "full", tools: ["bash", "powershell", "write", "edit", "Agent"] }), timeoutSeconds: restoreSupervisedTimeout },
      }).catch(() => undefined);
      restoreSupervisedTimeout = undefined;
    }
  });

  test("#F19 a pending approval in a session out of view: Needs you, lane, one toast; clears on every resolution", async ({ page }) => {
    test.setTimeout(240_000);
    await browserCommand({ type: "set_default_group_by", mode: "status" });

    const { card: first, sessionId: firstId } = await openSupervisedSession(page);
    const second = await spawnFreshGitSession(page);
    const toast = page.getByText(/waiting for tool approval/i);
    const needsYou = page.locator('[data-capsule-segment="needs-you"]').first();
    const laneCard = page.locator(`[data-lane="needs-you"] [data-session-id="${firstId}"]`);

    async function expectAllClear(): Promise<void> {
      await expect.poll(async () => (await readSession(page, firstId))?.awaitingToolApproval ?? false, { timeout: 30_000 }).toBe(false);
      await expect(first.getByText("Needs you")).toHaveCount(0, { timeout: 15_000 });
      await expect(laneCard).toHaveCount(0, { timeout: 15_000 });
      await expect(toast).toHaveCount(0, { timeout: 15_000 });
    }

    async function raiseOutOfView(): Promise<void> {
      await first.click();
      await runScenario(page, "tool-bash-echo");
      await expectPendingCard(page);
      await second.click(); // the operator is now looking at another session
      await expect(first.getByText("Needs you")).toBeVisible({ timeout: 30_000 });
      await expect(needsYou).toContainText("1");
      await expect(laneCard).toHaveCount(1, { timeout: 15_000 });
      await expect(toast).toHaveCount(1, { timeout: 15_000 });
      expect((await readSession(page, firstId))?.awaitingToolApproval).toBe(true);
    }

    // (1) Allow once — reached through the toast action.
    await raiseOutOfView();
    await page.getByTestId("toast-action").first().click();
    await allowOnceBtn(page).click();
    await expect(page.getByText(SUPERVISED_BASH_TAIL)).toBeVisible({ timeout: 30_000 });
    await expectToolRan(page);
    await second.click();
    await expectAllClear();

    // (2) Deny.
    await raiseOutOfView();
    await first.click();
    await denyBtn(page).click();
    await second.click();
    await expectAllClear();

    // (3) Timeout (supervised window narrowed to its 10 s floor; the gate re-reads config live).
    const cfg = await getConfig<{ supervisedMode?: { default: string; timeoutSeconds: number; tools: string[] } }>(page);
    restoreSupervisedTimeout = cfg.supervisedMode?.timeoutSeconds ?? 120;
    await putConfig(page, {
      supervisedMode: { ...(cfg.supervisedMode ?? { default: "full", tools: ["bash", "powershell", "write", "edit", "Agent"] }), timeoutSeconds: 10 },
    });
    await raiseOutOfView();
    await expectAllClear(); // nobody answers: the 10 s window closes
  });
});

test.describe("supervised composer fold (L3)", () => {
  test("#F23 on a narrow viewport the mode control lives in the ⋯ menu with both options", async ({ page }) => {
    // Spawn at the desktop layout (the session list card is a desktop-layout testid), open the
    // session, THEN narrow the viewport so the composer container drops below `@[44rem]`.
    await gotoDashboard(page);
    await ensureFixturePinned(page);
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.getByPlaceholder(/message/i).first().waitFor({ state: "visible", timeout: 60_000 });
    await page.setViewportSize({ width: 375, height: 800 });
    await page.getByPlaceholder(/message/i).first().waitFor({ state: "visible", timeout: 30_000 });

    // Absent from the settings row…
    await expect(page.getByTestId("composer-settings-row").getByTestId("session-mode-chip")).toBeHidden();
    // …present inside ⋯ with both options.
    await page.getByTestId("overflow-button").click();
    const menu = page.getByTestId("overflow-menu");
    await expect(menu.getByTestId("overflow-mode-full")).toBeVisible();
    await expect(menu.getByTestId("overflow-mode-supervised")).toBeVisible();
    await expect(menu.getByTestId("overflow-mode-full")).toHaveAttribute("aria-checked", "true");
  });
});
