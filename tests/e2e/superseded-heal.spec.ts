import { expect, test } from "@playwright/test";
import { SUPERSEDE_HEAL_MARKER } from "../../qa/fixtures/faux-scenarios.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E for change: fix-stuck-tool-card-superseded-heal (task 7.1).
 *
 * Reproduces the unhealed permanent-spinner case end-to-end, then asserts the
 * client supersede heal finalizes the card without a manual refresh:
 *
 *   1. The faux `stuck-tool-superseded` scenario streams a bash tool call
 *      (inference #1) then a plain-text reply (inference #2 → a LATER assistant
 *      `message_start`, the completion proof).
 *   2. `routeWebSocket` DROPS the tool's `tool_execution_end` frame on the
 *      server→browser hop — the exact silent drop the base change targets.
 *   3. `page.route` 404s the reconcile route — the store-eviction case where the
 *      authoritative result is unrecoverable, so the base HTTP reconcile can
 *      never heal it.
 *
 * With recovery impossible BUT a later inference proving completion, only the
 * supersede heal can finalize the card. The card must flip to `complete` and
 * render the `recovered` badge — no page reload.
 *
 * The reconcile cadence (STALE_TOOL_MS 25s + two 404 re-arms) means the heal
 * lands ≈ 45s in; the sub-second reducer/hook transitions are covered
 * deterministically by the unit suites (event-reducer.superseded-heal.test.ts,
 * useStaleToolReconcile.test.ts). This spec proves the real browser round-trip.
 */

/**
 * Drop every server→client `tool_execution_end` WS frame (there is exactly one
 * in this scenario), simulating the back-pressure drop on the server→browser
 * hop. Everything else forwards untouched. Must be installed BEFORE the page
 * opens its socket — call before any navigation. HTTP is unaffected.
 */
async function dropToolEndFrames(page: import("@playwright/test").Page): Promise<void> {
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m)); // client→server: verbatim
    server.onMessage((m) => {
      // Live events reach the browser as `{ type: "event", sessionId, seq,
      // event: DashboardEvent }` (useMessageHandler `case "event"`). Drop the
      // single `tool_execution_end` frame; everything else (incl. non-JSON /
      // binary pings) forwards unchanged.
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

test.describe("supersede terminal heal", () => {
  test("an unrecoverable-but-superseded stuck card heals + badges without a refresh", async ({ page }) => {
    // The heal is intentionally conservative (~45s reconcile cadence).
    test.setTimeout(150_000);

    // Install BEFORE the dashboard opens its socket / issues fetches.
    await dropToolEndFrames(page);
    // Force the reconcile route to 404 — the authoritative result is evicted.
    await page.route("**/api/sessions/*/tool-result/*", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "evicted" }),
      }),
    );

    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:stuck-tool-superseded]] go");

    // The bash card renders inside a single-member burst; its terminal frame is
    // dropped, so it stays RUNNING (auto-expanded burst).
    const burst = page.getByTestId("tool-burst-group");
    await expect(burst).toBeVisible({ timeout: 30_000 });
    await expect(burst).toHaveAttribute("data-running", "true");

    // The later-inference reply (inference #2) lands within seconds — this is
    // the completion proof the heal keys off.
    await expect(page.getByText(SUPERSEDE_HEAL_MARKER).first()).toBeVisible({ timeout: 30_000 });

    // Recovery is impossible (dropped frame + 404), so the ONLY way this stuck
    // card can leave `running` is the supersede heal. Wait for the flip.
    await expect(burst).toHaveAttribute("data-running", "false", { timeout: 90_000 });

    // The burst auto-collapses on the running→done flip (unmounting the body);
    // re-expand to inspect the healed member card.
    await page.getByTestId("tool-burst-header").click();
    await expect(page.getByTestId("tool-burst-body")).toBeVisible();

    // The heal is visible + honest: the `recovered` badge renders (never a
    // silent bodyless success).
    await expect(page.getByTestId("tool-superseded-badge")).toBeVisible();
  });
});
