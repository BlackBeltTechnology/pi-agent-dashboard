import { test, expect } from "./fixtures.js";
import { gotoDashboard, spawnFreshGitSession, sendPrompt } from "./helpers/index.js";

// L3 restart-survival — keeper-backed identity reattach (test-plan #F1).
//
// A dashboard-spawned session runs its pi inside a detached RPC keeper. On
// `/api/restart` the old server's SIGTERM handler (`onExitSignal` in cli.ts)
// only flushes and exits — it does NOT call `server.stop()` /
// `shutdownHeadlessProcesses()`, so the keeper (and pi inside it) survives. The
// restarted server reattaches it via `cleanupKeeperOrphans`, refilling `piPid`
// from the keeper's pi-PID sidecar. This spec proves the session converges back
// to dispatchable across the restart and a command reaches THAT session's pi.
//
// Port is NEVER hardcoded: globalSetup resolves `.pi-test-harness.json`
// (`dashboardPort`) into `PW_E2E_PORT`, which the `page` fixture baseURL uses,
// so every relative request below targets the harness-derived port.
//
// See change: fix-keeper-session-identity-and-reattach.

/**
 * Dismiss any leaked modal overlay. The seeded OpenSpec board can leave a
 * `propose-dialog-overlay` that intercepts pointer events on the composer.
 * Press Escape until it is gone. (Same pattern as popover-container-clip.spec.)
 */
async function dismissOverlays(page: import("@playwright/test").Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const overlay = page.getByTestId("propose-dialog-overlay");
    if (!(await overlay.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
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

test.describe("keeper-backed session identity survives a dashboard restart", () => {
  test("#F1 a dispatched command reaches the reattached session's pi", async ({ page }) => {
    await gotoDashboard(page);

    // Dashboard-spawned → runs pi inside a keeper → the reattach path this
    // change repairs. Capture the stable session id so we assert on the SAME
    // session after the restart (not a fresh spawn).
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId, "spawned card must carry a session id").toBeTruthy();
    await card.click();
    await dismissOverlays(page);

    // Prove the session is dispatchable BEFORE the restart: a faux command's
    // interactive widget renders and the composer settles.
    await sendPrompt(page, "[[faux:ask-select]] before");
    await expect(page.getByRole("button", { name: /alpha/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("pending-prompt-failed")).toHaveCount(0);

    const before = await serverIdentity(page);
    expect(before, "server identity must be readable before restart").not.toBeNull();

    // Restart the dashboard server only. The keeper + pi (a detached process
    // tree) stay alive; the restarted server reattaches them.
    await page.request.post("/api/restart", { timeout: 10_000 }).catch(() => {
      // The server tears the socket down mid-response; a transport error here
      // is the expected shape of a successful restart request.
    });

    // Wait for a DIFFERENT server process so the assertions below cannot race a
    // vacuous green against the pre-restart DOM.
    await expect
      .poll(
        async () => {
          const now = await serverIdentity(page);
          return now !== null && (now.pid !== before!.pid || now.startedAt !== before!.startedAt);
        },
        { timeout: 120_000, intervals: [500] },
      )
      .toBe(true);

    // Re-subscribe the browser to the restarted server and let the keeper
    // reattach (discovery → cleanupKeeperOrphans → piPid refilled from sidecar).
    await page.reload();

    const sameCard = page.locator(
      `[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`,
    );
    // The SAME session must come back — proving it survived rather than being
    // replaced by a fresh spawn.
    await expect(sameCard).toBeVisible({ timeout: 90_000 });
    await sameCard.click();
    await dismissOverlays(page);

    // Dispatch AFTER the restart: the command must reach the reattached
    // session's pi (and no other — there is exactly one keeper here, and a
    // mis-mapped dispatch would land on nothing / never render).
    await sendPrompt(page, "[[faux:ask-select]] after");
    await expect(page.getByRole("button", { name: /alpha/i }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("pending-prompt-failed")).toHaveCount(0);
  });
});
