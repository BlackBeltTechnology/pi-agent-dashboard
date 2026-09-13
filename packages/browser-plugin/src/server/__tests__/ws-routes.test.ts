/**
 * Plugin-owned WS routes (change: add-browser-relay, task 2.5; spec
 * browser-relay "Pinned extension connects" / "Web page with its own cdpUrl"
 * and plugin-ws-route "Core gates run before plugin delegation").
 *
 * The CORE gates (host admission, origin admission, genuinely-local peer,
 * ticket/cookie refusal) are proven at the real upgrade handler in
 * `packages/server/src/__tests__/plugin-ws-route.test.ts`. This file pins what
 * is the PLUGIN's own responsibility once the core has delegated: guid
 * extraction + liveness (404), the CDP-scope `Origin` refusal (403), and the
 * successful-upgrade path handing the socket to the right manager method.
 *
 * A real `http.Server` + a real `ws` pair are used so the 101 handshake and
 * the `meta.trackSocket` contract are exercised for real, not mocked.
 */

import type { IncomingMessage } from "node:http";
import { createServer, type Server } from "node:http";
import type { Duplex } from "node:stream";
import type {
  ServerPluginContext,
  WsRouteMeta,
  WsRouteRegistration,
  WsSocketLike,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { RelaySocket } from "../relay/extension-socket.js";
import {
  BROWSER_CDP_PATH,
  BROWSER_CDP_SCOPE,
  BROWSER_EXT_PATH,
  BROWSER_EXT_SCOPE,
  CHROME_EXTENSION_ORIGIN,
  type RelayAttacher,
  registerBrowserWsRoutes,
} from "../ws-routes.js";

const GUID = "a".repeat(32);
const OTHER_GUID = "b".repeat(32);

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

class FakeAttacher implements RelayAttacher {
  readonly live = new Map<string, { claimed: boolean }>();
  readonly attachedExt: string[] = [];
  readonly attachedCdp: string[] = [];

  resolve(guid: string): { claimed: boolean } | undefined {
    return this.live.get(guid);
  }
  attachExtension(guid: string, _ws: RelaySocket): boolean {
    this.attachedExt.push(guid);
    return true;
  }
  attachCdp(guid: string, _ws: RelaySocket): boolean {
    this.attachedCdp.push(guid);
    return true;
  }
}

interface Harness {
  attacher: FakeAttacher;
  tracked: WsSocketLike[];
  port: number;
}

/**
 * Register the plugin routes into a captured ctx, then replay the CORE
 * delegation: on `upgrade`, resolve the scope by prefix and call the plugin's
 * `handleUpgrade` with a real `meta`. Everything before that call is group 1's
 * responsibility and is not re-simulated here.
 */
async function harness(): Promise<Harness> {
  const attacher = new FakeAttacher();
  const routes = new Map<string, WsRouteRegistration>();
  const tracked: WsSocketLike[] = [];
  const ctx = {
    registerWsRoute: (scope: string, opts: WsRouteRegistration) => routes.set(scope, opts),
    logger: { info() {}, warn() {}, error() {} },
  } as unknown as ServerPluginContext;

  registerBrowserWsRoutes(ctx, attacher);
  expect([...routes.keys()].sort()).toEqual([BROWSER_CDP_SCOPE, BROWSER_EXT_SCOPE]);

  const server = createServer();
  servers.push(server);
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (request.url ?? "").split("?")[0];
    const scope = path.startsWith(BROWSER_EXT_PATH)
      ? BROWSER_EXT_SCOPE
      : path.startsWith(BROWSER_CDP_PATH)
        ? BROWSER_CDP_SCOPE
        : null;
    if (!scope) {
      socket.destroy();
      return;
    }
    const registration = routes.get(scope);
    if (!registration) {
      socket.destroy();
      return;
    }
    const meta: WsRouteMeta = {
      pluginId: "browser",
      scope,
      trackSocket: (ws) => tracked.push(ws),
    };
    registration.handleUpgrade(request, socket, head, meta);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { attacher, tracked, port };
}

type DialResult = { kind: "open" } | { kind: "status"; status: number } | { kind: "error" };

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

const isOpen = (r: DialResult) => r.kind === "open";
const isStatus = (r: DialResult, code: number) => r.kind === "status" && r.status === code;

describe("registerBrowserWsRoutes", () => {
  it("registers the ext scope pinned to the extension id and the cdp scope with no pin", async () => {
    const attacher = new FakeAttacher();
    const routes = new Map<string, WsRouteRegistration>();
    const ctx = {
      registerWsRoute: (scope: string, opts: WsRouteRegistration) => routes.set(scope, opts),
      logger: { info() {}, warn() {}, error() {} },
    } as unknown as ServerPluginContext;
    registerBrowserWsRoutes(ctx, attacher);

    expect(routes.get(BROWSER_EXT_SCOPE)?.pathPrefix).toBe("/ws/browser-ext/");
    expect(routes.get(BROWSER_EXT_SCOPE)?.admitOrigins).toEqual([CHROME_EXTENSION_ORIGIN]);
    expect(routes.get(BROWSER_CDP_SCOPE)?.pathPrefix).toBe("/ws/browser-cdp/");
    expect(routes.get(BROWSER_CDP_SCOPE)?.admitOrigins).toEqual([]);
  });

  it("ext: a live guid upgrades 101 and attaches the socket as the extension", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: false });

    const r = await dial(`ws://127.0.0.1:${h.port}/ws/browser-ext/${GUID}`, {
      origin: CHROME_EXTENSION_ORIGIN,
    });
    expect(isOpen(r), JSON.stringify(r)).toBe(true);
    await new Promise((res) => setImmediate(res));
    expect(h.attacher.attachedExt).toEqual([GUID]);
    expect(h.tracked).toHaveLength(1);
  });

  it("ext: an unknown guid 404s and never attaches", async () => {
    const h = await harness();
    const r = await dial(`ws://127.0.0.1:${h.port}/ws/browser-ext/${GUID}`, {
      origin: CHROME_EXTENSION_ORIGIN,
    });
    expect(isStatus(r, 404), JSON.stringify(r)).toBe(true);
    expect(h.attacher.attachedExt).toEqual([]);
  });

  it.each([
    ["empty guid", ""],
    ["malformed guid", "abc"],
    ["33 hex chars", "c".repeat(33)],
    ["nested path", `${GUID}/extra`],
  ])("ext: %s 404s", async (_label, suffix) => {
    const h = await harness();
    const r = await dial(`ws://127.0.0.1:${h.port}/ws/browser-ext/${suffix}`, {
      origin: CHROME_EXTENSION_ORIGIN,
    });
    expect(isStatus(r, 404), JSON.stringify(r)).toBe(true);
    expect(h.attacher.attachedExt).toEqual([]);
  });

  it("cdp: an Origin-bearing request is refused 403 even for a live guid", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: true });

    const r = await dial(`ws://127.0.0.1:${h.port}/ws/browser-cdp/${GUID}`, {
      origin: "http://localhost:8000",
    });
    expect(isStatus(r, 403), JSON.stringify(r)).toBe(true);
    expect(h.attacher.attachedCdp).toEqual([]);
  });

  it("cdp: a header-less live guid upgrades 101 and attaches as the CDP client", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: true });

    const r = await dial(`ws://127.0.0.1:${h.port}/ws/browser-cdp/${GUID}`);
    expect(isOpen(r), JSON.stringify(r)).toBe(true);
    await new Promise((res) => setImmediate(res));
    expect(h.attacher.attachedCdp).toEqual([GUID]);
    expect(h.tracked).toHaveLength(1);
  });

  it("cdp: an unknown guid 404s", async () => {
    const h = await harness();
    h.attacher.live.set(OTHER_GUID, { claimed: true });
    const r = await dial(`ws://127.0.0.1:${h.port}/ws/browser-cdp/${GUID}`);
    expect(isStatus(r, 404), JSON.stringify(r)).toBe(true);
    expect(h.attacher.attachedCdp).toEqual([]);
  });

  it("cdp: an unclaimed but live guid still admits the CDP client (client may arrive first)", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: false });

    const r = await dial(`ws://127.0.0.1:${h.port}/ws/browser-cdp/${GUID}`);
    expect(isOpen(r), JSON.stringify(r)).toBe(true);
    await new Promise((res) => setImmediate(res));
    expect(h.attacher.attachedCdp).toEqual([GUID]);
  });
});
