import { test, expect } from "@playwright/test";
import { spawnFreshGitSession, sendPrompt } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

// Strategy B (reduce-session-replay-traffic), reconciled onto develop's
// adopt-pi-071-072-073-features tool-output mechanism. On a FULL replay the
// server pre-truncates a heavy (> 200-line) tool result to the display form
// (`«N earlier lines hidden»` + last 200 lines) to trim replay bytes; the store
// keeps the full body for develop's "Show full output" route.
//
// Verified at the WIRE level (robust to DOM): capture the server's
// `event_replay` frames during a full replay in a fresh browser context and
// assert the heavy tool_execution_end result is the truncated marker form, NOT
// the full 500-line body. (The collapsed render + "Show full output" fetch are
// develop's, covered by its tests.)
//
// A fully-cached session never full-replays (Strategy A delta-subscribes), so a
// SECOND browser context (empty IndexedDB → lastSeq:0) forces the full replay.
// Faux scenario `tool-bash-large` runs `seq 1 500 | sed 's/^/HEADMARKER-/'`.

const MARKER = "«";

function toolResultsIn(payload: string): string[] {
  try {
    const msg = JSON.parse(payload) as { type?: string; events?: { event: { eventType?: string; data?: { result?: unknown } } }[] };
    if (msg.type !== "event_replay" || !Array.isArray(msg.events)) return [];
    return msg.events
      .filter((e) => e.event?.eventType === "tool_execution_end" && typeof e.event.data?.result === "string")
      .map((e) => e.event.data!.result as string);
  } catch {
    return [];
  }
}

test.describe("Strategy B — replay pre-truncates heavy tool results", () => {
  test("full replay ships the truncated display form, not the full body", async ({ page, browser }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();

    await card.click();
    await sendPrompt(page, "[[faux:tool-bash-large]] go");
    await expect(page.getByText(/large output done/).first()).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(1_000);

    const ctx2 = await browser.newContext({ baseURL: BASE_URL });
    try {
      const page2 = await ctx2.newPage();
      const results: string[] = [];
      page2.on("websocket", (ws) => {
        ws.on("framereceived", (frame) => {
          const payload = typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8");
          results.push(...toolResultsIn(payload));
        });
      });

      await page2.goto(`/session/${sessionId}`);
      await expect.poll(() => results.length, { timeout: 45_000 }).toBeGreaterThan(0);

      const r = results[0];
      // Truncated display form on the wire…
      expect(r.startsWith(`${MARKER}`)).toBe(true);
      expect(r).toContain("earlier lines hidden»");
      // …last 200 lines kept (tail), head dropped → fewer than 500 lines on wire.
      expect(r).toContain("HEADMARKER-500");
      expect(r).not.toContain("HEADMARKER-1\n");
      expect(r.split("\n").length).toBeLessThanOrEqual(201);
    } finally {
      await ctx2.close();
    }
  });
});
