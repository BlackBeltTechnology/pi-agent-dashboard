/**
 * L3 — a background subagent created BEFORE the replay window survives a
 * windowed subscribe (test-plan #F4, move-subagents-to-plugin D2/D8).
 *
 * A fake bridge registers a session and forwards producer-0.8.x-shaped
 * `subagent_created` / `subagent_started` / `subagent_entry` frames (stamped
 * `pluginId: "subagents"`, as the server's ownership check requires) AFTER a
 * head's worth of filler `message_end` events, then more than `maxReplayEvents`
 * filler events, so every subagent frame sits in the replay GAP: past the head
 * (the first ~10% of the window, 20..200 events, is always replayed) and before
 * the tail. The browser opens the session cold: only the server's
 * `plugin_event_carry` frame can bring those frames back.
 *
 * Asserts: the dock row shows the producer type + task (never `unknown`) and
 * the subagent view lists every entry from index 0.
 *
 * Skips when the harness runs unwindowed (`maxReplayEvents <= 0`). Ports come
 * from `.pi-test-harness.json` via the Playwright baseURL / helpers.
 * See change: move-subagents-to-plugin.
 */
import { expect, test } from "./fixtures.js";
import { connectComposerBridge, ensureFixturePinned } from "./helpers/composer-bridge.js";

const SUB_ID = "carry-sub-0001";
const TYPE = "carry-explorer";
const TASK = "carry task survives the window";
const ENTRY_COUNT = 6;
const entryText = (i: number) => `carry-entry-${i}`;

test.describe("subagent windowed replay carry (L3)", () => {
  test.setTimeout(180_000);

  test("#F4 early background subagent keeps type, task and full timeline after a windowed open", async ({ page }) => {
    const cfg = (await (await page.request.get("/api/config")).json()) as {
      data?: { memoryLimits?: { maxReplayEvents?: number } };
    };
    const limit = cfg.data?.memoryLimits?.maxReplayEvents ?? 2_000;
    test.skip(limit <= 0, "windowing disabled in this harness; the carry needs a replay window");

    await ensureFixturePinned(page);
    const bridge = await connectComposerBridge(page, "carry");
    try {
      const forward = (eventType: string, data: Record<string, unknown>) =>
        bridge.send({
          type: "event_forward",
          sessionId: bridge.sessionId,
          pluginId: "subagents",
          event: { eventType, timestamp: Date.now(), data },
        });

      const filler = (i: number) =>
        bridge.send({
          type: "event_forward",
          sessionId: bridge.sessionId,
          event: {
            eventType: "message_end",
            timestamp: Date.now(),
            data: { message: { role: i % 2 ? "assistant" : "user", content: [{ type: "text", text: `filler ${i}` }] } },
          },
        });

      // Fill the replay HEAD first (HEAD_MIN 20 .. HEAD_CAP 200 = 10% of the
      // window), so the subagent frames below land in the gap, not the head.
      const headFill = Math.min(200, Math.max(20, Math.floor(limit * 0.1))) + 20;
      for (let i = 0; i < headFill; i++) filler(i);

      // Subagent frames, now past the head and before the tail.
      forward("subagent_created", {
        id: SUB_ID,
        type: TYPE,
        description: TASK,
        details: { subagentType: TYPE, description: TASK, background: true },
      });
      forward("subagent_started", {
        id: SUB_ID,
        details: { subagentType: TYPE, description: TASK, displayName: TYPE, status: "running", background: true },
      });
      for (let i = 0; i < ENTRY_COUNT; i++) {
        forward("subagent_entry", { agentId: SUB_ID, index: i, entry: { kind: "text", text: entryText(i) } });
      }

      // Push every subagent frame out of the replay window.
      for (let i = 0; i < limit + 300; i++) filler(i);
      bridge.send({ type: "session_heartbeat", sessionId: bridge.sessionId, agentRunning: false });

      // Cold open (fresh context, empty IndexedDB) => windowed subscribe.
      const frameTypes: string[] = [];
      page.on("websocket", (ws) =>
        ws.on("framereceived", (f) => {
          try {
            const m = JSON.parse(typeof f.payload === "string" ? f.payload : f.payload.toString("utf8")) as { type?: string };
            if (m.type) frameTypes.push(m.type);
          } catch {
            // non-JSON frame
          }
        }),
      );
      await page.goto(`/session/${bridge.sessionId}`);

      const lane = page.getByTestId("composer-dock-lane-processes");
      await expect(lane).toBeVisible({ timeout: 60_000 });
      if ((await lane.getAttribute("data-open")) !== "true") await lane.locator('[data-dock-toggle="processes"]').click();
      const row = lane.getByTestId("composer-dock-row").filter({ hasText: TASK });
      await expect(row).toHaveCount(1, { timeout: 30_000 });
      await expect(row).toContainText(TYPE);
      await expect(row).not.toContainText(/unknown/i);

      // The window really cut the early frames, and the carry brought them back.
      expect(frameTypes).toContain("history_window");
      expect(frameTypes).toContain("plugin_event_carry");

      // The detail view lists every entry from index 0.
      await row.getByRole("link", { name: /^Open subagent / }).click();
      await expect(page).toHaveURL(/\/session\/[^/]+\/subagent\/[^/]+/);
      for (let i = 0; i < ENTRY_COUNT; i++) {
        await expect(page.getByText(entryText(i), { exact: true })).toBeVisible({ timeout: 30_000 });
      }
    } finally {
      bridge.close();
    }
  });
});
