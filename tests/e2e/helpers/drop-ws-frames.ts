import type { Page } from "@playwright/test";

/**
 * Drop matching server→browser WebSocket frames; forward everything else and
 * every browser→server frame untouched.
 *
 * `page.routeWebSocket` helper for specs that need to simulate the ephemeral
 * frame loss a saturated or reconnecting socket causes. `shouldDrop` receives
 * the parsed JSON envelope (`{ type, event?: { eventType, data } }`); frames
 * that are not JSON are always forwarded. Install BEFORE the page connects
 * (before `spawnFreshGitSession` / navigation).
 *
 * Minimal on purpose: task 8.4 of `decouple-plugins-from-core` plans the shared
 * frame-dropping helper; this exists so the SLDR inspector spec (8.67) is not
 * blocked on it — fold into that helper when it lands.
 */
export async function dropServerFrames(
  page: Page,
  shouldDrop: (frame: { type?: string; event?: { eventType?: string; data?: Record<string, unknown> } }) => boolean,
): Promise<void> {
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (typeof m === "string") {
        try {
          if (shouldDrop(JSON.parse(m))) return; // DROP
        } catch {
          // not JSON: forward
        }
      }
      ws.send(m);
    });
  });
}
