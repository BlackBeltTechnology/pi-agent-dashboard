/**
 * Catalogue invalidation on last-bridge disconnect — full-server proof
 * (D5, test-plan E18 + X14).
 *
 * The catalogue cache used to be ASSIGNED only: `latest === null` meant "no
 * push since server start", so after the first disconnect the availability
 * signal lied forever. The held catalogue is now invalidated when the LAST
 * bridge disconnects — and ONLY then: one session remaining keeps it.
 *
 * X14 pins the consequence: with an api-key credential stored for
 * `openrouter`, the api-key row disappears while the catalogue is unavailable
 * (the stored credential is untouched, only unmanageable from the dashboard)
 * and returns once a catalogue is pushed again.
 *
 * See change: redesign-providers-settings-page (D5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";
import { _resetForTests, getLatestCatalogue } from "../package/provider-catalogue-cache.js";
import { readAuthJson } from "../auth/provider-auth-storage.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await wait(25);
  }
  throw new Error("waitFor: condition never became true");
}

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

const OPENROUTER_CATALOGUE = [
  {
    id: "openrouter",
    displayName: "OpenRouter",
    hasOAuth: false,
    configured: true,
    source: "stored" as const,
    envVar: "OPENROUTER_API_KEY",
  },
];

async function getJson(port: number, urlPath: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  return { status: res.status, body: await res.json() };
}

describe("catalogue availability across bridge disconnects", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;
  const authDir = path.join(os.homedir(), ".pi", "agent");
  const authPath = path.join(authDir, "auth.json");
  let originalAuth: string | null = null;

  beforeEach(async () => {
    _resetForTests();
    fs.mkdirSync(authDir, { recursive: true });
    try { originalAuth = fs.readFileSync(authPath, "utf-8"); } catch { originalAuth = null; }
    // X14 pre-state: an api-key credential is STORED for openrouter.
    fs.writeFileSync(
      authPath,
      JSON.stringify({ openrouter: { type: "api_key", key: "sk-or-123" } }, null, 2) + "\n",
    );
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
    if (originalAuth !== null) fs.writeFileSync(authPath, originalAuth);
    else fs.rmSync(authPath, { force: true });
  });

  it("E18: no push → false; push → true; last bridge disconnects → false", async () => {
    const first = await getJson(browserPort, "/api/provider-auth/catalogue-ready");
    expect(first.body).toEqual({ ready: false });

    const piWs = await connectSession(piPort, "p1");
    piWs.send(JSON.stringify({
      type: "providers_list",
      sessionId: "p1",
      providers: OPENROUTER_CATALOGUE,
    }));
    await waitFor(() => getLatestCatalogue().length > 0);
    const pushed = await getJson(browserPort, "/api/provider-auth/catalogue-ready");
    expect(pushed.body).toEqual({ ready: true });

    piWs.close();
    await waitFor(async () =>
      (await getJson(browserPort, "/api/provider-auth/catalogue-ready")).body.ready === false);
    const afterClose = await getJson(browserPort, "/api/provider-auth/catalogue-ready");
    expect(afterClose.body).toEqual({ ready: false });
  });

  it("one bridge remaining keeps the catalogue ready; only the LAST disconnect invalidates", async () => {
    const ws1 = await connectSession(piPort, "p1");
    const ws2 = await connectSession(piPort, "p2");
    ws1.send(JSON.stringify({ type: "providers_list", sessionId: "p1", providers: OPENROUTER_CATALOGUE }));
    await waitFor(() => getLatestCatalogue().length > 0);

    ws1.close();
    await wait(150);
    const stillOne = await getJson(browserPort, "/api/provider-auth/catalogue-ready");
    expect(stillOne.body).toEqual({ ready: true });

    ws2.close();
    await waitFor(async () =>
      (await getJson(browserPort, "/api/provider-auth/catalogue-ready")).body.ready === false);
  });

  it("X14: the openrouter api-key row disappears while unavailable and returns on the next push", async () => {
    const piWs = await connectSession(piPort, "p1");
    piWs.send(JSON.stringify({ type: "providers_list", sessionId: "p1", providers: OPENROUTER_CATALOGUE }));
    await waitFor(() => getLatestCatalogue().length > 0);

    const before = await getJson(browserPort, "/api/provider-auth/status");
    const rowBefore = before.body.find((r: { id: string }) => r.id === "openrouter");
    expect(rowBefore).toBeDefined();
    expect(rowBefore.flowType).toBe("api_key");
    expect(rowBefore.configured).toBe(true);

    piWs.close();
    await waitFor(async () =>
      (await getJson(browserPort, "/api/provider-auth/catalogue-ready")).body.ready === false);

    // While unavailable: NO api-key row for openrouter — and the stored
    // credential is untouched on disk.
    const during = await getJson(browserPort, "/api/provider-auth/status");
    expect(during.body.find((r: { id: string }) => r.id === "openrouter")).toBeUndefined();
    expect(readAuthJson().openrouter).toEqual({ type: "api_key", key: "sk-or-123" });
    // The response is still a bare array with no envelope (5.4).
    expect(Array.isArray(during.body)).toBe(true);

    // A session pushes a catalogue again → the row returns.
    const ws2 = await connectSession(piPort, "p2");
    ws2.send(JSON.stringify({ type: "providers_list", sessionId: "p2", providers: OPENROUTER_CATALOGUE }));
    await waitFor(async () => {
      const s = await getJson(browserPort, "/api/provider-auth/status");
      return s.body.some((r: { id: string }) => r.id === "openrouter");
    });
    const after = await getJson(browserPort, "/api/provider-auth/status");
    expect(after.body.find((r: { id: string }) => r.id === "openrouter").configured).toBe(true);
  });
});
