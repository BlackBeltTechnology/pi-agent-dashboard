import type { WebSocketRoute } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { spawnFreshGitSession } from "./helpers/index.js";

// Disabled subagents plugin does not spam the chat — rendered behaviour.
//
// change: decouple-plugins-from-core (test-plan #F4, task 8.33)
//
// A plugin-owned event type (manifest `eventTypes`) that no reducer slice
// consumed folds into ONE group row per type. While the owning plugin is
// unavailable the chat shows that row collapsed ("N <type> events — <plugin>
// plugin unavailable"); the raw payloads appear only on expand. While the
// plugin is available the row renders nothing at all.
//
// Event source: owned `subagent_*` frames are synthesized on the browser's own
// WebSocket (the harness has no scripted way to emit them with the plugin
// off). `subagent_tick` is used rather than `subagent_entry` because core's
// reducer still consumes `subagent_entry` in its own arm until the Phase 3
// extraction (tasks 4.x) hands it to the plugin slice; swap the constant then.
const OWNED_TYPE = "subagent_tick";
const COUNT = 40;
const GROUP_LABEL = new RegExp(`${COUNT} ${OWNED_TYPE} events — .* plugin unavailable`);

test.describe("owned-event group row — unavailable owner", () => {
  test("disabled subagents plugin: one collapsed row, payloads on expand", async ({ page }) => {
    test.setTimeout(300_000);

    // Keep the browser-side socket so frames can be pushed to the page.
    let browserWs: WebSocketRoute | undefined;
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      browserWs = ws;
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => ws.send(m));
    });

    const toggle = (enabled: boolean) =>
      page.request.post("/api/plugins/subagents/toggle", { data: { enabled } });
    // `POST /api/plugins/:id/toggle` answers `restartRequired: true`: `/api/health`
    // reports the plugin disabled only after a server restart, so the toggle is
    // followed by one (the real activation path, not a shortcut).
    const restartServer = () => page.request.post("/api/restart", { timeout: 10_000 }).catch(() => {});
    // After a restart `/api/health` answers before the static client is fully served; wait until the
    // entry document and every script it references load, so the next spawn does not race the boot.
    const clientServed = async () => {
      const html = await page.request.get("/").catch(() => null);
      if (!html?.ok()) return false;
      const urls = [...(await html.text()).matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
      const rs = await Promise.all(urls.map((u) => page.request.get(u).catch(() => null)));
      return rs.every((r) => r?.ok());
    };
    const subagentsEnabled = async () => {
      const res = await page.request.get("/api/health").catch(() => null);
      if (!res?.ok()) return undefined;
      const h = (await res.json()) as { plugins?: { id: string; enabled?: boolean }[] };
      return h.plugins?.find((p) => p.id === "subagents")?.enabled;
    };

    try {
      expect((await toggle(false)).ok()).toBeTruthy();
      await restartServer();
      await expect.poll(subagentsEnabled, { timeout: 120_000, intervals: [1_000] }).toBe(false);
      await expect.poll(clientServed, { timeout: 60_000, intervals: [1_000] }).toBe(true);

      const card = await spawnFreshGitSession(page);
      await card.click();
      const sessionId = await card.getAttribute("data-session-id");
      expect(sessionId).toBeTruthy();

      // Reload the chat so `/api/health` reports the plugin disabled before
      // the events arrive, then wait for the reconnect.
      await page.reload();
      await expect.poll(() => browserWs !== undefined, { timeout: 30_000 }).toBe(true);
      await page.locator(`[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`).click();
      // The subscribe replay must have landed before the synthetic frames, or it resets them away.
      await expect(page.getByTestId("chat-scroll-container")).toBeVisible({ timeout: 30_000 });

      for (let i = 1; i <= COUNT; i++) {
        browserWs?.send(
          JSON.stringify({
            type: "event",
            sessionId,
            seq: 1_000_000 + i,
            event: { eventType: OWNED_TYPE, timestamp: Date.now(), data: { i } },
          }),
        );
      }

      // One collapsed row naming the count and the plugin — not 40 JSON blocks.
      const row = page.getByRole("button", { name: GROUP_LABEL });
      await expect(row).toHaveCount(1, { timeout: 30_000 });
      await expect(row).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator("pre", { hasText: '"i"' })).toHaveCount(0);

      // Expanding shows the raw payloads.
      await row.click();
      await expect(row).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("pre", { hasText: '"i"' })).toHaveCount(COUNT);
    } finally {
      // Restore state for suite independence.
      await toggle(true).catch(() => undefined);
      await restartServer();
      await expect.poll(subagentsEnabled, { timeout: 120_000, intervals: [1_000] }).toBe(true).catch(() => undefined);
    }
  });
});
