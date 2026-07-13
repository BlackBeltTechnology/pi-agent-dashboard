import { expect, test } from "@playwright/test";
import { SUPERSEDE_HEAL_MARKER } from "../../qa/fixtures/faux-scenarios.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E for change: fix-stuck-tool-card-on-dropped-event (task 5.1).
 *
 * The RECOVERABLE counterpart to superseded-heal.spec.ts. Same server→browser
 * drop, but the authoritative result is NOT evicted — so the client's HTTP
 * reconcile heals the card with the REAL body, and the supersede fallback never
 * fires.
 *
 *   1. The faux `stuck-tool-superseded` scenario streams a bash tool call whose
 *      end frame is dropped on the server→browser hop. The bash tool actually
 *      executes in the pi runtime, so `tool_execution_end` IS recorded in the
 *      server store (bridge→server succeeds) — only the WS fanout frame is lost.
 *   2. `routeWebSocket` DROPS that one `tool_execution_end` frame → the card
 *      stays RUNNING.
 *   3. The reconcile route is left UNTOUCHED (no 404 override), so
 *      `GET /api/sessions/:id/tool-result/:toolCallId` hits the real server and
 *      returns HTTP 200 with the authoritative `echo supersede-probe` output.
 *
 * At `STALE_TOOL_MS` (~25s) the client reconcile fetches the stored result and
 * flips the card to `complete` with the real body — no page refresh. Because
 * recovery succeeds, the supersede badge MUST NOT appear (this is the base
 * change's REST heal, not the follow-up's placeholder fallback).
 *
 * Sub-second reducer/hook transitions are covered deterministically by the unit
 * suites (useStaleToolReconcile.test.ts); this spec proves the browser
 * round-trip over the real REST route.
 */

/**
 * Drop every server→client `tool_execution_end` WS frame, simulating the
 * back-pressure drop on the server→browser hop. Everything else forwards
 * untouched. Must be installed BEFORE the page opens its socket. HTTP is
 * unaffected — so the reconcile route still reaches the server.
 *
 * (Deliberately duplicated from superseded-heal.spec.ts to keep each spec
 * self-contained; the superseded test carries the same helper.)
 */
async function dropToolEndFrames(page: import("@playwright/test").Page): Promise<void> {
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m)); // client→server: verbatim
    server.onMessage((m) => {
      if (typeof m === "string") {
        try {
          const parsed = JSON.parse(m) as {
            type?: string;
            event?: { eventType?: string };
          };
          if (parsed.type === "event" && parsed.event?.eventType === "tool_execution_end") {
            return; // DROP — simulate the server→browser terminal-event drop
          }
        } catch {
          // fall through to forward
        }
      }
      ws.send(m);
    });
  });
}

test.describe("stale running-tool reconcile", () => {
  test("a dropped-terminal stuck card heals from REST (real result, no supersede badge)", async ({ page }) => {
    // Heal lands at STALE_TOOL_MS (~25s); allow headroom.
    test.setTimeout(120_000);

    // Install BEFORE the dashboard opens its socket.
    await dropToolEndFrames(page);
    // NOTE: the reconcile route is intentionally NOT stubbed — it must reach the
    // real server, which still holds the recorded `tool_execution_end`.

    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:stuck-tool-superseded]] go");

    // The bash card renders inside a single-member burst; its terminal frame is
    // dropped, so it starts RUNNING.
    const burst = page.getByTestId("tool-burst-group");
    await expect(burst).toBeVisible({ timeout: 30_000 });
    await expect(burst).toHaveAttribute("data-running", "true");

    // The follow-up reply lands within seconds (not required for this heal —
    // the reconcile recovers from the store regardless — but confirms the turn
    // progressed).
    await expect(page.getByText(SUPERSEDE_HEAL_MARKER).first()).toBeVisible({ timeout: 30_000 });

    // The store still holds the result, so the HTTP reconcile heals the card.
    await expect(burst).toHaveAttribute("data-running", "false", { timeout: 60_000 });

    // Re-expand to inspect the healed member card (burst auto-collapses on flip).
    await page.getByTestId("tool-burst-header").click();
    await expect(page.getByTestId("tool-burst-body")).toBeVisible();

    // The REAL result was recovered: the authoritative echo output renders.
    await expect(page.getByTestId("tool-burst-body")).toContainText("supersede-probe");

    // And because recovery SUCCEEDED, the supersede placeholder never fires.
    await expect(page.getByTestId("tool-superseded-badge")).toHaveCount(0);
  });
});
