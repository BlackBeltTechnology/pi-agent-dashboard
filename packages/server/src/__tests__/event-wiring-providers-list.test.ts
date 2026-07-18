/**
 * End-to-end test: `providers_list` arriving from a (fake) bridge updates
 * the provider-catalogue cache, and `getAuthStatus()` reflects it.
 * Pins the contract that the server emits NO `models_refreshed` broadcast
 * on `providers_list` arrival — the catalogue is a pure read consumer for
 * the Settings UI, the model-selector dropdown lives on the independent
 * `models_list` channel which is per-session-broadcast already.
 * See changes: replace-hardcoded-provider-lists,
 *              fix-providers-list-spurious-models-refreshed,
 *              simplify-model-selection-channels.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";
import { _resetForTests, getLatestCatalogue } from "../package/provider-catalogue-cache.js";
import { getAuthStatus } from "../auth/provider-auth-storage.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connectSession(piPort: number, sessionId: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session_register",
        sessionId,
        cwd: "/tmp",
        source: "cli",
      }));
      ws.send(JSON.stringify({ type: "replay_complete", sessionId }));
      setTimeout(resolve, 60);
    });
  });
  return ws;
}

describe("providers_list — server wiring", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;

  beforeEach(async () => {
    _resetForTests();
    server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    });
    await server.start();
    browserPort = server.httpPort()!;
    piPort = server.piPort()!;
  });

  afterEach(async () => {
    await server.stop();
    _resetForTests();
  });

  it("incoming providers_list updates the cache and is visible via getAuthStatus", async () => {
    const piWs = await connectSession(piPort, "p1");
    expect(getLatestCatalogue()).toEqual([]);

    piWs.send(JSON.stringify({
      type: "providers_list",
      sessionId: "p1",
      providers: [
        { id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: false },
        { id: "fireworks", displayName: "Fireworks", hasOAuth: false, configured: false, envVar: "FIREWORKS_API_KEY" },
      ],
    }));

    await wait(80);

    const cached = getLatestCatalogue();
    expect(cached).toHaveLength(2);
    expect(cached.map((p) => p.id).sort()).toEqual(["deepseek", "fireworks"]);

    const status = getAuthStatus();
    const deepseekRow = status.find((r) => r.id === "deepseek");
    const fireworksRow = status.find((r) => r.id === "fireworks");
    expect(deepseekRow).toBeDefined();
    expect(deepseekRow?.flowType).toBe("api_key");
    expect(fireworksRow?.envVar).toBe("FIREWORKS_API_KEY");

    piWs.close();
  });

  // Regression — see change: simplify-model-selection-channels.
  // The server MUST NOT emit `models_refreshed` on routine providers_list
  // arrivals. The previous implementation broadcast on every push (or, in
  // the interim fix, on content change), which globally wiped browsers'
  // modelsMap and left previously-visited sessions with empty model
  // selectors. Per-session `models_list` updates are now the sole signal
  // for dropdown contents.
  it("never broadcasts models_refreshed on providers_list arrival (any flavour)", async () => {
    const piWs = await connectSession(piPort, "p1");
    const browserWs = new WebSocket(`ws://127.0.0.1:${browserPort}/ws`);
    const browserMessages: any[] = [];
    await new Promise<void>((resolve) => {
      browserWs.on("open", () => resolve());
    });
    browserWs.on("message", (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        browserMessages.push(m);
      } catch { /* ignore */ }
    });
    // Drain initial snapshot/handshake messages.
    await wait(80);
    browserMessages.length = 0;

    const cat1 = [
      { id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: false },
      { id: "fireworks", displayName: "Fireworks", hasOAuth: false, configured: false, envVar: "FIREWORKS_API_KEY" },
    ];
    const cat2 = [
      { id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: false, custom: true },
      { id: "fireworks", displayName: "Fireworks", hasOAuth: false, configured: false, envVar: "FIREWORKS_API_KEY" },
    ];

    // First push — no broadcast.
    piWs.send(JSON.stringify({ type: "providers_list", sessionId: "p1", providers: cat1 }));
    await wait(80);
    expect(browserMessages.filter((m) => m.type === "models_refreshed").length).toBe(0);

    // Identical re-push — no broadcast.
    piWs.send(JSON.stringify({ type: "providers_list", sessionId: "p1", providers: cat1 }));
    await wait(80);
    expect(browserMessages.filter((m) => m.type === "models_refreshed").length).toBe(0);

    // Content change (custom flag flip) — still no broadcast.
    piWs.send(JSON.stringify({ type: "providers_list", sessionId: "p1", providers: cat2 }));
    await wait(80);
    expect(browserMessages.filter((m) => m.type === "models_refreshed").length).toBe(0);

    // New session sending its first push — still no broadcast (this was the
    // exact scenario that defeated the per-session `changed` gate from the
    // previous fix).
    const piWs2 = await connectSession(piPort, "p2");
    piWs2.send(JSON.stringify({ type: "providers_list", sessionId: "p2", providers: cat1 }));
    await wait(80);
    expect(browserMessages.filter((m) => m.type === "models_refreshed").length).toBe(0);

    piWs.close();
    piWs2.close();
    browserWs.close();
  });
});
