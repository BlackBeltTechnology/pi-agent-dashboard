/**
 * The plugin-registered WS route gates on the REAL upgrade handler
 * (test-plan #E4–#E8, #E5 golden regression, #X11 toggle teardown; spec
 * plugin-ws-route "Core gates run before plugin delegation").
 *
 * Boots a real server (createTestServer, the ws-origin-gate.test.ts pattern)
 * and registers fake plugin scopes on the process-wide registry — exactly
 * what a plugin's server entry does during its activation. The thing under
 * test is the ordering inside the upgrade handler, which a unit test cannot
 * observe.
 *
 * See change: add-browser-relay (group 1).
 */

import {
  clearWsRouteRegistry,
  getWsRouteRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket as WsClient } from "ws";
import { WebSocket, WebSocketServer } from "ws";
import { routeScopeForUrl, WsTicketStore } from "../auth/ws-ticket.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;
const wssInstances: WebSocketServer[] = [];

afterEach(async () => {
  if (handle) await handle.stop();
  handle = undefined;
  for (const wss of wssInstances.splice(0)) wss.close();
  clearWsRouteRegistry();
});

type DialResult =
  | { kind: "open" }
  | { kind: "status"; status: number }
  | { kind: "error" };

/** Dial and report HOW it ended: 101, a refusal status, or a transport error. */
function dial(url: string, headers: Record<string, string> = {}): Promise<DialResult> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    let settled = false;
    const done = (r: DialResult) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* best-effort */
      }
      resolve(r);
    };
    ws.on("open", () => done({ kind: "open" }));
    ws.on("unexpected-response", (_req, res) => done({ kind: "status", status: res.statusCode ?? 0 }));
    ws.on("error", () => done({ kind: "error" }));
    setTimeout(() => done({ kind: "error" }), 5000);
  });
}

const isStatus = (r: DialResult, code: number) => r.kind === "status" && r.status === code;
const isOpen = (r: DialResult) => r.kind === "open";

/** Open a socket and keep it open (for teardown assertions). */
function openSocket(url: string, headers: Record<string, string> = {}): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.on("open", () => resolve(ws));
    ws.on("unexpected-response", (_req, res) =>
      reject(new Error(`upgrade refused: HTTP ${res.statusCode}`)),
    );
    ws.on("error", (e) => reject(e));
  });
}

/** Resolve with the close code once the socket closes. */
function closeCode(ws: WsClient): Promise<number> {
  return new Promise((resolve) => ws.on("close", (code) => resolve(code)));
}

/**
 * Register a fake plugin scope on the real registry, simulating a plugin
 * server entry's activation. `handleUpgrade` completes the WS handshake and
 * tracks the socket (as a real plugin must via `meta.trackSocket`).
 */
function registerPluginScope(
  pluginId: string,
  scope: string,
  pathPrefix: string,
  admitOrigins: string[],
  opts: { requirePluginToken?: boolean } = {},
): void {
  const registry = getWsRouteRegistry();
  const wss = new WebSocketServer({ noServer: true });
  wssInstances.push(wss);
  registry.beginActivation(pluginId);
  registry.register(pluginId, scope, {
    pathPrefix,
    admitOrigins,
    handleUpgrade: (request, socket, head, meta) => {
      // Optional fake per-connection credential: `?token=good` (the plugin's
      // own secret — the ONLY credential core never evaluates).
      if (opts.requirePluginToken && !(request.url ?? "").includes("token=good")) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => meta.trackSocket(ws));
    },
  });
  registry.endActivation(pluginId);
}

// The plugin id the toggle test uses — a real discovered plugin (client-only,
// no dependents) so POST /api/plugins/:id/toggle resolves it.
const TOGGLE_PLUGIN_ID = "demo";

// ─── #E4 — origin admission table (pinned vs empty) ────────────────────────
describe("#E4 plugin-scope origin admission", () => {
  it("pinned scope: only the listed Origin passes (localhost:5173 and absent → 403)", async () => {
    handle = await createTestServer();
    registerPluginScope("demo", "test-ext", "/ws/test-ext/", ["chrome-extension://abc"]);
    const base = `ws://127.0.0.1:${handle.httpPort}`;

    expect(isOpen(await dial(`${base}/ws/test-ext/abc`, { origin: "chrome-extension://abc" }))).toBe(true);
    expect(isStatus(await dial(`${base}/ws/test-ext/abc`, { origin: "chrome-extension://xyz" }), 403)).toBe(true);
    // A loopback page origin the dashboard policy WOULD admit — refused here.
    expect(isStatus(await dial(`${base}/ws/test-ext/abc`, { origin: "http://localhost:5173" }), 403)).toBe(true);
    // Absent Origin cannot equal a listed entry (browsers cannot omit it).
    expect(isStatus(await dial(`${base}/ws/test-ext/abc`), 403)).toBe(true);
  }, 30000);

  it("empty scope: the dashboard origin policy applies byte-identical", async () => {
    handle = await createTestServer();
    registerPluginScope("demo", "test-open", "/ws/test-open/", []);
    const base = `ws://127.0.0.1:${handle.httpPort}`;

    // Core policy admits absent (non-browser) and loopback origins…
    expect(isOpen(await dial(`${base}/ws/test-open/abc`))).toBe(true);
    expect(isOpen(await dial(`${base}/ws/test-open/abc`, { origin: "http://localhost:5173" }))).toBe(true);
    // …and refuses extension + attacker origins exactly as /ws would.
    expect(isStatus(await dial(`${base}/ws/test-open/abc`, { origin: "chrome-extension://abc" }), 403)).toBe(true);
    expect(isStatus(await dial(`${base}/ws/test-open/abc`, { origin: "http://attacker.example" }), 403)).toBe(true);
  }, 30000);

  it("a core scope is unaffected by a pinned Origin (spec: pinned origin on /ws)", async () => {
    handle = await createTestServer();
    registerPluginScope("demo", "test-ext2", "/ws/test-ext2/", ["chrome-extension://abc"]);
    const base = `ws://127.0.0.1:${handle.httpPort}`;

    // The same Origin the plugin admits is REFUSED on the core /ws route —
    // the core policy runs unchanged there.
    expect(isStatus(await dial(`${base}/ws`, { origin: "chrome-extension://abc" }), 403)).toBe(true);
  }, 30000);
});

// ─── #E5 — core scopes are unchanged while a plugin scope is registered ────
describe("#E5 core-scope golden regression", () => {
  it("routeScopeForUrl core mappings and the live /ws gate are byte-identical", async () => {
    handle = await createTestServer();
    registerPluginScope("demo", "test-ext", "/ws/test-ext/", ["chrome-extension://abc"]);
    const base = `ws://127.0.0.1:${handle.httpPort}`;

    // The existing ws-ticket.test.ts fixture rows, with a plugin scope live.
    expect(routeScopeForUrl("/ws?ticket=x")).toBe("browser");
    expect(routeScopeForUrl("/ws/terminal/abc")).toBe("terminal");
    expect(routeScopeForUrl("/live/1")).toBe("live");
    expect(routeScopeForUrl("/ws/bridge")).toBe("bridge");
    expect(routeScopeForUrl("/api/health")).toBe(null);
    expect(routeScopeForUrl("/ws/test-ext/abc?ticket=x")).toBe("test-ext");

    // The live core gate behaves exactly as before: a local client opens /ws,
    // an attacker Origin is refused there.
    expect(isOpen(await dial(`${base}/ws`))).toBe(true);
    expect(isStatus(await dial(`${base}/ws`, { origin: "http://attacker.example" }), 403)).toBe(true);
  }, 30000);
});

// ─── #E6 — tickets never apply to plugin scopes ────────────────────────────
describe("#E6 ticket refusal on plugin scopes", () => {
  it("POST /api/ws-ticket refuses to mint for a plugin scope (400)", async () => {
    handle = await createTestServer();
    registerPluginScope("demo", "test-ext", "/ws/test-ext/", ["chrome-extension://abc"]);

    const res = await fetch(`http://127.0.0.1:${handle.httpPort}/api/ws-ticket`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "test-ext" }),
    });
    expect(res.status).toBe(400);
  }, 30000);

  it("WsTicketStore.consume is false for a plugin scope name (runtime)", () => {
    const store = new WsTicketStore();
    const t = store.mint("browser");
    // Type-level this call is rejected (`test-ext` is not a CoreWsRouteScope);
    // the runtime check holds too: a core ticket never authorizes a plugin scope.
    expect(store.consume(t, "test-ext" as never)).toBe(false);
  });

  it("neither a dashboard cookie nor a ticket substitutes for the plugin credential", async () => {
    handle = await createTestServer();
    registerPluginScope("demo", "cred-ext", "/ws/cred-ext/", [], { requirePluginToken: true });
    const base = `ws://127.0.0.1:${handle.httpPort}`;

    const store = new WsTicketStore();
    const ticket = store.mint("browser");

    // Cookie holder without the plugin secret → handleUpgrade refuses it.
    const cookie = await dial(`${base}/ws/cred-ext/abc`, {
      cookie: "pi_session=some-valid-looking-session-cookie",
    });
    expect(cookie.kind).not.toBe("open");

    // A valid core ticket does not substitute either.
    const withTicket = await dial(`${base}/ws/cred-ext/abc?ticket=${ticket}`);
    expect(withTicket.kind).not.toBe("open");

    // The plugin's own credential opens it.
    expect(isOpen(await dial(`${base}/ws/cred-ext/abc?token=good`))).toBe(true);
  }, 30000);
});

// ─── #E7 — loopback Host BVA ───────────────────────────────────────────────
describe("#E7 loopback Host header", () => {
  it.each([
    ["127.0.0.1:8000"],
    ["[::1]:8000"],
    ["localhost:8000"],
    ["localhost"],
  ])("admits loopback Host %s", async (host) => {
    handle = await createTestServer();
    registerPluginScope("demo", "test-ext", "/ws/test-ext/", ["chrome-extension://abc"]);
    const r = await dial(`ws://127.0.0.1:${handle.httpPort}/ws/test-ext/abc`, {
      host,
      origin: "chrome-extension://abc",
    });
    expect(isOpen(r), `${host} → ${JSON.stringify(r)}`).toBe(true);
  }, 30000);

  it.each([
    ["share.zrok.io"],
    ["127.0.0.1.evil"],
    ["192.168.1.5:8000"],
  ])("rejects non-loopback Host %s with 403 + [ws-gate] log", async (host) => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    handle = await createTestServer();
    registerPluginScope("demo", "test-ext", "/ws/test-ext/", ["chrome-extension://abc"]);
    try {
      const r = await dial(`ws://127.0.0.1:${handle.httpPort}/ws/test-ext/abc`, {
        host,
        origin: "chrome-extension://abc",
      });
      expect(isStatus(r, 403), `${host} → ${JSON.stringify(r)}`).toBe(true);

      const line = errors.find((l) => l.includes("[ws-gate]") && l.includes(`scope=test-ext`));
      expect(line, "a [ws-gate] line names the scope").toBeDefined();
      expect(line).toContain("peer=127.0.0.1");
    } finally {
      spy.mockRestore();
    }
  }, 30000);
});

// ─── #E8 — forwarding headers, each singly ─────────────────────────────────
describe("#E8 proxy-forwarding headers on a plugin scope", () => {
  it.each([
    ["x-forwarded-for", "203.0.113.9"],
    ["x-forwarded-host", "evil.example"],
    ["x-forwarded-proto", "https"],
    ["x-forwarded-server", "proxy.internal"],
    ["x-forwarded-port", "443"],
    ["x-real-ip", "203.0.113.9"],
    ["forwarded", "for=203.0.113.9"],
    ["via", "1.1 zrok"],
  ])("rejects a dial carrying %s", async (name, value) => {
    handle = await createTestServer();
    registerPluginScope("demo", "test-ext", "/ws/test-ext/", ["chrome-extension://abc"]);
    const r = await dial(`ws://127.0.0.1:${handle.httpPort}/ws/test-ext/abc`, {
      origin: "chrome-extension://abc",
      [name]: value,
    });
    expect(isStatus(r, 403), `${name} → ${JSON.stringify(r)}`).toBe(true);
  }, 30000);

  it("admits the same dial with none of them", async () => {
    handle = await createTestServer();
    registerPluginScope("demo", "test-ext", "/ws/test-ext/", ["chrome-extension://abc"]);
    expect(isOpen(await dial(`ws://127.0.0.1:${handle.httpPort}/ws/test-ext/abc`, {
      origin: "chrome-extension://abc",
    }))).toBe(true);
  }, 30000);
});

// ─── #X11 — plugin toggled off tears down live routes ──────────────────────
describe("#X11 plugin toggled off", () => {
  it("closes open sockets with 1001 within 1 s and 404s later upgrades", async () => {
    handle = await createTestServer();
    registerPluginScope(TOGGLE_PLUGIN_ID, "x11-ext", "/ws/x11-ext/", []);
    registerPluginScope(TOGGLE_PLUGIN_ID, "x11-cdp", "/ws/x11-cdp/", []);
    const base = `ws://127.0.0.1:${handle.httpPort}`;

    const ext = await openSocket(`${base}/ws/x11-ext/a`);
    const cdp = await openSocket(`${base}/ws/x11-cdp/a`);
    const extClosed = closeCode(ext);
    const cdpClosed = closeCode(cdp);

    const startedAt = Date.now();
    const res = await fetch(`http://127.0.0.1:${handle.httpPort}/api/plugins/${TOGGLE_PLUGIN_ID}/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);

    expect(await extClosed).toBe(1001);
    expect(await cdpClosed).toBe(1001);
    expect(Date.now() - startedAt).toBeLessThan(1000);

    // Subsequent upgrades to the torn-down prefixes are a deliberate 404.
    expect(isStatus(await dial(`${base}/ws/x11-ext/a`), 404)).toBe(true);
    expect(isStatus(await dial(`${base}/ws/x11-cdp/a`), 404)).toBe(true);

    // Restore the fixture plugin's config for the rest of this file's HOME.
    await fetch(`http://127.0.0.1:${handle.httpPort}/api/plugins/${TOGGLE_PLUGIN_ID}/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
  }, 30000);
});
