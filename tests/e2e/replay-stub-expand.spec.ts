import { expect, test } from "@playwright/test";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

// Strategy B (reduce-session-replay-traffic): a finalized tool result > 4 KB is
// replayed as a STUB — preview + byteSize + entryId, NO full body. We verify
// this through the real Docker stack at the WIRE level: capture the server's
// `event_replay` frames during a FULL replay and assert the heavy
// tool_execution_end carries the stub shape and omits the body. (The collapsed
// render + on-expand full-fidelity fetch + offline degrade are covered
// deterministically by the ToolCallStep + session-routes unit tests; the JSONL
// route by session-routes-tool-result.test.ts.)
//
// Setup nuance: a FULLY-CACHED session never sees a stub on reload — Strategy A
// makes it delta-subscribe, so the heavy event is never re-replayed. A stub
// appears only on a FULL replay, which a SECOND browser context (empty
// IndexedDB → lastSeq:0) forces.
//
// The faux scenario `tool-bash-large` runs bash producing HEADMARKER + 6000×'X'
// + TAILMARKER (~6 KB). The stub preview is the first 200 chars (no TAILMARKER).

interface ReplayedEvent {
  eventType: string;
  data?: Record<string, unknown>;
}

function toolStubsIn(payload: string): ReplayedEvent[] {
  try {
    const msg = JSON.parse(payload) as { type?: string; events?: { event: ReplayedEvent }[] };
    if (msg.type !== "event_replay" || !Array.isArray(msg.events)) return [];
    return msg.events
      .map((e) => e.event)
      .filter((ev) => ev?.eventType === "tool_execution_end" && ev.data?.stub === true);
  } catch {
    return [];
  }
}

test.describe("Strategy B — heavy tool result replays as a stub", () => {
  test("full replay ships a stub (preview + byteSize + entryId, no full body)", async ({ page, browser }) => {
    // Producer context: drive the >4 KB bash result and let it persist.
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();

    await card.click();
    await sendPrompt(page, "[[faux:tool-bash-large]] go");
    // The closing assistant text marks the turn settled (tool ran + persisted).
    await expect(page.getByText(/large output done/).first()).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(1_000);

    // Consumer context: FRESH IndexedDB → full replay → the heavy result stubs.
    const ctx2 = await browser.newContext({ baseURL: BASE_URL });
    try {
      const page2 = await ctx2.newPage();
      const stubs: ReplayedEvent[] = [];
      page2.on("websocket", (ws) => {
        ws.on("framereceived", (frame) => {
          const payload = typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8");
          stubs.push(...toolStubsIn(payload));
        });
      });

      await page2.goto(`/session/${sessionId}`);

      await expect.poll(() => stubs.length, { timeout: 45_000 }).toBeGreaterThan(0);

      const stub = stubs[0];
      expect(stub.data?.stub).toBe(true);
      expect(stub.data?.byteSize as number).toBeGreaterThan(4_000);
      expect(typeof stub.data?.preview).toBe("string");
      expect(stub.data?.entryId).toBeTruthy();
      // Preview only — the full body (and its TAILMARKER tail) is NOT on the wire.
      expect(stub.data?.result).toBeUndefined();
      expect(String(stub.data?.preview)).not.toContain("TAILMARKER");
    } finally {
      await ctx2.close();
    }
  });
});
