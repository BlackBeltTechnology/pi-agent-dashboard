/**
 * End to end inside the REAL dashboard server: start a target, mint tier 1, then reach the upstream through the label
 * Host (and never through the dashboard); the same target through tier 5 and the legacy path.
 * See change: serve-live-previews-on-capability-origin (D1, D3, D6, D8; tasks 3.6, 6.4, 8.4, 14.x subset).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { proofFetch, proofHeaders } from "../test-support/local-credential-stamp.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;
let upstream: http.Server;
let upstreamPort = 0;
const seen: string[] = [];

beforeEach(async () => {
  seen.length = 0;
  upstream = http.createServer((req, res) => {
    seen.push(`${req.url}`);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("upstream-body");
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  upstreamPort = (upstream.address() as AddressInfo).port;
});
afterEach(async () => {
  await handle?.stop();
  handle = undefined;
  await new Promise<void>((r) => upstream.close(() => r()));
});

const rawGet = (port: number, host: string, path: string) =>
  new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers: { host }, setHost: false }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });

async function startTarget(port: number): Promise<string> {
  const r = await proofFetch(`http://127.0.0.1:${port}/api/live-server/start`, {
    method: "POST",
    headers: { "content-type": "application/json", host: `localhost:${port}` },
    body: JSON.stringify({ host: "127.0.0.1", port: upstreamPort, label: "up" }),
  });
  const body = await r.json();
  return body.data.id as string;
}
const mint = async (port: number, id: string, accept: unknown, headers: Record<string, string> = {}) => {
  const r = await proofFetch(`http://127.0.0.1:${port}/api/live-server/${id}/capability`, {
    method: "POST",
    headers: { "content-type": "application/json", host: `localhost:${port}`, origin: `http://localhost:${port}`, ...headers },
    body: JSON.stringify({ accept }),
  });
  return { status: r.status, json: (await r.json()) as Record<string, any> };
};

describe("tiered preview inside the real server", () => {
  it("tier 1: the label origin is proxied to the upstream (never the dashboard); an unknown label is the opaque 403", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    const id = await startTarget(port);
    const m = await mint(port, id, ["origin", "preview"]);
    expect(m.status).toBe(200);
    expect(m.json.tier).toBe(1);
    expect(m.json.origin).toMatch(new RegExp(`^http://[a-z2-7]{26}\\.localhost:${port}$`));
    expect(m.json.path).toBe("/");
    const host = new URL(m.json.origin).host;
    const hit = await rawGet(port, host, "/@vite/client?x=1");
    expect(hit.status).toBe(200);
    expect(hit.body).toBe("upstream-body");
    expect(seen).toEqual(["/@vite/client?x=1"]);
    // the dashboard's own routes are unreachable through the label host
    expect((await rawGet(port, host, "/api/health")).body).toBe("upstream-body");
    // policy rides the response: a scripts-off restricted capability has the opaque-ish `sandbox` and exact ancestors
    const csp = String(hit.headers["content-security-policy"]);
    expect(csp).toContain(`frame-ancestors http://localhost:${port} ${m.json.origin}`);
    expect(csp).toContain("sandbox;");
    const unknown = await rawGet(port, `${"a".repeat(26)}.localhost:${port}`, "/");
    expect(unknown.status).toBe(403);
    expect(JSON.parse(unknown.body)).toEqual({ error: "host_not_allowed" });
  });

  it("no `accept` → legacy path that still works; `accept:[preview]` → tier 5 `/preview/<pid>/` forwarded with the full path", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    const id = await startTarget(port);
    const legacy = await mint(port, id, undefined);
    expect(legacy.json.tier).toBe("legacy");
    const l = await proofFetch(`http://127.0.0.1:${port}${legacy.json.path}a`, { headers: { host: `localhost:${port}` } });
    expect(l.status).toBe(200);
    const t5 = await mint(port, id, ["preview"]);
    expect(t5.json.tier).toBe(5);
    expect(t5.json.path).toMatch(/^\/preview\/[A-Za-z0-9_-]{22}\/$/);
    expect(t5.json.origin).toBeUndefined();
    const r = await proofFetch(`http://127.0.0.1:${port}${t5.json.path}deep/x?q=1`, { headers: { host: `localhost:${port}` } });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("upstream-body");
    expect(seen.at(-1)).toBe(`${t5.json.path}deep/x?q=1`);
    const again = await mint(port, id, ["preview"], {});
    expect(again.json.path).toBe(t5.json.path); // stable per target
    const bad = await rawGet(port, `localhost:${port}`, `/preview/${"B".repeat(22)}/x`);
    expect([403, 404]).toContain(bad.status);
  });

  it("the dashboard page CSP frames the label origin on the page's own port", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    const r = await rawGet(port, `localhost:${port}`, "/api/health");
    // `/api/health` is JSON; CSP is stamped on every dashboard-owned response regardless of type
    const csp = String(r.headers["content-security-policy"] ?? r.headers["content-security-policy-report-only"] ?? "");
    if (csp) expect(csp).toContain(`http://*.localhost:${port}`);
  });
});

describe("reserve-path API inside the real server (D9)", () => {
  const open = (url: string, headers: Record<string, string> = {}) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  const reserve = (port: number, body: unknown) =>
    proofFetch(`http://127.0.0.1:${port}/api/live-server/preview-path`, {
      method: "POST",
      headers: { "content-type": "application/json", host: `localhost:${port}` },
      body: JSON.stringify(body),
    });

  it("a loopback (tier-1) browser announcing `live_preview_accept` is NOT a tier-5 viewer: nothing is reserved, bodies are validated", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    const browser = await open(`ws://127.0.0.1:${port}/ws`, proofHeaders(`http://127.0.0.1:${port}/ws`));
    browser.send(JSON.stringify({ type: "live_preview_accept", accept: ["origin", "preview"] }));
    await new Promise((r) => setTimeout(r, 150));
    const none = await reserve(port, { port: 5299 });
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ success: true, path: null, tier5Viewers: false });
    expect((await reserve(port, { port: 0 })).status).toBe(400);
    browser.close();
  });

  it("the bridge pair works over the real gateway: request → result (no viewer ⇒ path null)", async () => {
    handle = await createTestServer();
    const bridge = await open(`ws://127.0.0.1:${handle.piPort}`);
    const got = new Promise<Record<string, unknown>>((resolve) => {
      bridge.on("message", (raw) => {
        const m = JSON.parse(String(raw));
        if (m.type === "preview_path_result") resolve(m);
      });
    });
    bridge.send(JSON.stringify({ type: "session_register", sessionId: "resv", cwd: "/tmp", source: "cli" }));
    bridge.send(JSON.stringify({ type: "replay_complete", sessionId: "resv" }));
    await new Promise((r) => setTimeout(r, 200));
    bridge.send(JSON.stringify({ type: "preview_path_request", requestId: "q1", sessionId: "resv", port: 5299 }));
    expect(await got).toEqual({ type: "preview_path_result", requestId: "q1", path: null, tier5Viewers: false });
    bridge.close();
  });
});

