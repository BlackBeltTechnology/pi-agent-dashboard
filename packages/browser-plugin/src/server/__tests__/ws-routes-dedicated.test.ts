/**
 * The dedicated `cdpUrl` over the plugin's real WS routes (change:
 * add-dedicated-agent-browser, test-plan #R12 + the `attachCdp` wiring of task 4.1).
 *
 * A dedicated instance shares the relay's `browser-cdp` scope, so the CORE
 * upgrade gate (host admission → origin admission → genuinely-local peer; proven
 * for every plugin scope in `packages/server/src/__tests__/plugin-ws-route.test.ts`)
 * guards its `cdpUrl` exactly as it guards a relay one. This file replays that
 * delegation with a stand-in peer check: it pins that the dedicated guid adds NO
 * second scope and no gate bypass, and that the plugin's own last mile attaches the
 * socket to the `DedicatedInstance`.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import type { ServerPluginContext, WsRouteMeta, WsRouteRegistration } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BROWSER_CDP_SCOPE, BROWSER_EXT_SCOPE, registerBrowserWsRoutes } from "../ws-routes.js";
import { type DedicatedRig, makeDedicatedRig, silent } from "./dedicated-manager-rig.js";

const servers: Server[] = [];
const rigs: DedicatedRig[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const r of rigs.splice(0)) r.cleanup();
});

const isLoopback = (addr: string | undefined): boolean => addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";

interface Host {
  rig: DedicatedRig;
  port: number;
  routes: Map<string, WsRouteRegistration>;
  tracked: unknown[];
  gateRefusals: number;
  cdpUrl: string;
  guid: string;
  /** Pretend the TCP peer is this address (the real gate reads the socket's remote address). */
  peer: { address: string | undefined };
}

async function host(): Promise<Host> {
  const rig = makeDedicatedRig();
  rigs.push(rig);
  const routes = new Map<string, WsRouteRegistration>();
  const ctx = {
    registerWsRoute: (scope: string, opts: WsRouteRegistration) => routes.set(scope, opts),
    logger: silent,
  } as unknown as ServerPluginContext;
  registerBrowserWsRoutes(ctx, rig.manager);

  const conn = await rig.manager.connectDedicated({ client: "t" });
  if (!conn.ok) throw new Error("connect failed");
  const state: Host = { rig, port: 0, routes, tracked: [], gateRefusals: 0, cdpUrl: conn.cdpUrl, guid: conn.cdpUrl.split("/").pop() as string, peer: { address: undefined } };

  const server = createServer();
  servers.push(server);
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    // CORE GATE stand-in: the peer must be genuinely local before the plugin sees the upgrade.
    const peer = state.peer.address ?? request.socket.remoteAddress;
    if (!isLoopback(peer)) {
      state.gateRefusals += 1;
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const path = (request.url ?? "").split("?")[0];
    const scope = path.startsWith("/ws/browser-cdp/") ? BROWSER_CDP_SCOPE : path.startsWith("/ws/browser-ext/") ? BROWSER_EXT_SCOPE : null;
    const registration = scope ? routes.get(scope) : undefined;
    if (!scope || !registration) {
      socket.destroy();
      return;
    }
    const meta: WsRouteMeta = { pluginId: "browser", scope, trackSocket: (ws) => state.tracked.push(ws) };
    registration.handleUpgrade(request, socket, head, meta);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.port = (server.address() as { port: number }).port;
  return state;
}

type Dial = { kind: "open" } | { kind: "status"; status: number } | { kind: "error" };
function dial(url: string, headers: Record<string, string> = {}): Promise<Dial> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    let done = false;
    const finish = (r: Dial) => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        /* best effort */
      }
      resolve(r);
    };
    ws.on("open", () => finish({ kind: "open" }));
    ws.on("unexpected-response", (_req, res) => finish({ kind: "status", status: res.statusCode ?? 0 }));
    ws.on("error", () => finish({ kind: "error" }));
    setTimeout(() => finish({ kind: "error" }), 5000);
  });
}

const urlOf = (h: Host, scopePath: string) => `ws://127.0.0.1:${h.port}${scopePath}${h.guid}`;

describe("#R12 the dedicated cdpUrl is loopback-only, as for the relay", () => {
  it("shares the relay's browser-cdp scope: no extra WS scope is registered for @dedicated", async () => {
    const h = await host();
    expect([...h.routes.keys()].sort()).toEqual([BROWSER_CDP_SCOPE, BROWSER_EXT_SCOPE]);
    expect(h.routes.get(BROWSER_CDP_SCOPE)?.admitOrigins).toEqual([]); // the core origin policy stays in force
    expect(h.cdpUrl).toContain("/ws/browser-cdp/");
  });

  it("a non-loopback peer is refused at the gate and never reaches the instance", async () => {
    const h = await host();
    h.peer.address = "203.0.113.9";
    const r = await dial(urlOf(h, "/ws/browser-cdp/"));
    expect(r).toEqual({ kind: "status", status: 403 });
    expect(h.gateRefusals).toBe(1);
    expect(h.tracked).toHaveLength(0);
    expect(h.rig.manager.liveDedicated()?.hasCdpClient).toBe(false);
  });

  it("a loopback, Origin-less client upgrades and is attached to the DedicatedInstance", async () => {
    const h = await host();
    const r = await dial(urlOf(h, "/ws/browser-cdp/"));
    expect(r).toEqual({ kind: "open" });
    await new Promise((res) => setTimeout(res, 50));
    expect(h.tracked).toHaveLength(1);
    // the instance saw a CDP client (the socket may already have closed again after `dial`)
    expect(h.rig.children[0].methods()).toEqual(expect.arrayContaining(["Target.setDiscoverTargets", "Target.setAutoAttach"]));
  });

  it("an Origin-bearing request (a web page that learned the cdpUrl) is refused 403 and attaches nothing", async () => {
    const h = await host();
    const r = await dial(urlOf(h, "/ws/browser-cdp/"), { origin: "http://localhost:8000" });
    expect(r).toEqual({ kind: "status", status: 403 });
    expect(h.rig.manager.liveDedicated()?.hasCdpClient).toBe(false);
  });

  it("the dedicated guid is 404 on the extension scope (nothing ever dials it)", async () => {
    const h = await host();
    const r = await dial(urlOf(h, "/ws/browser-ext/"), { origin: "chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm" });
    expect(r).toEqual({ kind: "status", status: 404 });
  });
});
