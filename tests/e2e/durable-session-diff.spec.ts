/**
 * L3 — the Diff panel survives a server restart because the diff is sourced
 * from the durable session transcript, not the RAM event store.
 *
 * After `POST /api/restart` the in-memory event store is empty for a session
 * that ran before the restart. Before this change `/api/session-diff` then saw
 * zero owned files and the panel rendered empty; the transcript on disk still
 * holds the Write calls, so the panel must converge on them.
 *
 * Exemplar restart flow: `tests/e2e/ended-session-endedat.spec.ts`.
 * Diff-panel selectors: `tests/e2e/out-of-cwd-session-diffs.spec.ts`.
 * Port comes from `.pi-test-harness.json` via `./lifecycle.js` — never hardcoded.
 *
 * See change: fix-session-diff-durable-source (test-plan #F1).
 */

import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

const A_PATH = "src/e2e-durable-a.ts";
const B_PATH = "src/e2e-durable-b.ts";

async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(
    () => undefined, // the connection dies with the daemon; that is the point
  );
  const deadline = Date.now() + 120_000;
  await new Promise((r) => setTimeout(r, 2_000));
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`);
      if (res.ok) return;
    } catch {
      // still down
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}

test.describe("session diff from the durable transcript (L3)", () => {
  test("F1: the Diff panel converges after a restart", async ({ page }) => {
    test.fixme(true, "https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/683"); // quarantine: see issue #683
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();
    await card.click();

    await sendPrompt(page, "[[faux:tool-write-pair]] write two durable files");

    // Both Writes land — the chip is fed by /api/session-diff.
    const chip = page.getByTestId("changed-files-chip");
    await expect(chip).toBeVisible({ timeout: 60_000 });
    await expect(chip).toContainText("2", { timeout: 60_000 });

    // Restart the SERVER: the RAM event store is now empty for this session.
    await restartDashboard();
    await page.reload({ waitUntil: "domcontentloaded" });

    // The transcript is the only source left → the API must still list both.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/session-diff?sessionId=${sessionId}`);
          const body = await res.json();
          return ((body.data?.files ?? []) as Array<{ path: string }>).map((f) => f.path);
        },
        { timeout: 60_000 },
      )
      .toEqual(expect.arrayContaining([A_PATH, B_PATH]));

    // Re-open the session, open the Diff panel; the tree converges on the two.
    const card2 = page.locator(
      `[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`,
    );
    await card2.waitFor({ state: "visible", timeout: 60_000 });
    await card2.click();

    const chip2 = page.getByTestId("changed-files-chip");
    await chip2.waitFor({ state: "visible", timeout: 30_000 });
    await chip2.click();

    await expect(page.getByTestId("changes-rail-section")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("changes-rail-section")).toContainText("(2)");
    await expect(page.getByText("e2e-durable-a.ts", { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("e2e-durable-b.ts", { exact: false }).first()).toBeVisible({ timeout: 20_000 });

    // Selecting a file renders a non-empty diff tab.
    await page.getByText("e2e-durable-a.ts", { exact: false }).first().click();
    await expect(page.getByRole("tab").filter({ hasText: "diff" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("export const a = 1;").first()).toBeVisible({ timeout: 20_000 });
  });
});
