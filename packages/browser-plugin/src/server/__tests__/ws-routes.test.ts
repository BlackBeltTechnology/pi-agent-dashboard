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
import { RELAY_TICKET_TTL_MS, RelayTicketStore } from "../relay/relay-ticket.js";
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
  /** The real ticket store, so the single-use / bound-to-(guid, role) behaviour under test is the real one. */
  readonly tickets = new RelayTicketStore();
  readonly live = new Map<string, { claimed: boolean; operator?: boolean }>();
  consumeTicket(guid: string, role: "ext" | "cdp", ticket: string | null | undefined): boolean {
    return this.tickets.consume(guid, role, ticket);
  }
  readonly attachedExt: string[] = [];
  readonly attachedCdp: string[] = [];

  resolve(guid: string): { claimed: boolean; operator?: boolean } | undefined {
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

/** A relay URL carrying a fresh single-use ticket for (guid, role), as the manager issues it. */
function relayUrl(h: Harness, role: "ext" | "cdp", guid: string): string {
  const prefix = role === "ext" ? BROWSER_EXT_PATH : BROWSER_CDP_PATH;
  return `ws://127.0.0.1:${h.port}${prefix}${guid}?ticket=${h.attacher.tickets.mint(guid, role)}`;
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

    const r = await dial(relayUrl(h, "ext", GUID), {
      origin: CHROME_EXTENSION_ORIGIN,
    });
    expect(isOpen(r), JSON.stringify(r)).toBe(true);
    await new Promise((res) => setImmediate(res));
    expect(h.attacher.attachedExt).toEqual([GUID]);
    expect(h.tracked).toHaveLength(1);
  });

  it("ext: an unknown guid 404s and never attaches", async () => {
    const h = await harness();
    const r = await dial(relayUrl(h, "ext", GUID), {
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
    // The segment is not a guid the manager could ever have minted a ticket for (the store is keyed by
    // the PATH segment), so the ticket is minted for exactly what is dialled: the refusal is the guid rules'.
    const seg = suffix.split("/")[0] ?? "";
    const r = await dial(`ws://127.0.0.1:${h.port}/ws/browser-ext/${suffix}?ticket=${h.attacher.tickets.mint(seg, "ext")}`, {
      origin: CHROME_EXTENSION_ORIGIN,
    });
    // No extractable guid (empty / nested) is refused at the ticket check (403); a well-formed segment that
    // is not a live guid is the old 404.
    expect(isStatus(r, suffix === "" || suffix.includes("/") ? 403 : 404), JSON.stringify(r)).toBe(true);
    expect(h.attacher.attachedExt).toEqual([]);
  });

  it("cdp: an Origin-bearing request is refused 403 even for a live guid", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: true });

    const r = await dial(relayUrl(h, "cdp", GUID), {
      origin: "http://localhost:8000",
    });
    expect(isStatus(r, 403), JSON.stringify(r)).toBe(true);
    expect(h.attacher.attachedCdp).toEqual([]);
  });

  it("cdp: a header-less live guid upgrades 101 and attaches as the CDP client", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: true });

    const r = await dial(relayUrl(h, "cdp", GUID));
    expect(isOpen(r), JSON.stringify(r)).toBe(true);
    await new Promise((res) => setImmediate(res));
    expect(h.attacher.attachedCdp).toEqual([GUID]);
    expect(h.tracked).toHaveLength(1);
  });

  it("cdp: an unknown guid 404s", async () => {
    const h = await harness();
    h.attacher.live.set(OTHER_GUID, { claimed: true });
    const r = await dial(relayUrl(h, "cdp", GUID));
    expect(isStatus(r, 404), JSON.stringify(r)).toBe(true);
    expect(h.attacher.attachedCdp).toEqual([]);
  });

  it("cdp: an unclaimed but live guid still admits the CDP client (client may arrive first)", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: false });

    const r = await dial(relayUrl(h, "cdp", GUID));
    expect(isOpen(r), JSON.stringify(r)).toBe(true);
    await new Promise((res) => setImmediate(res));
    expect(h.attacher.attachedCdp).toEqual([GUID]);
  });

  // change: add-operator-browser-relay (D3, test-plan #E17): an operator-targeted
  // guid is never dialled directly — its extension arrives as a link over the carrier.
  it("ext: an operator-targeted guid 404s (looks like an unknown guid) and never attaches (E17)", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: false, operator: true });
    const r = await dial(relayUrl(h, "ext", GUID), {
      origin: CHROME_EXTENSION_ORIGIN,
    });
    expect(isStatus(r, 404), JSON.stringify(r)).toBe(true);
    expect(h.attacher.attachedExt).toEqual([]);
  });

  it("cdp: an operator-targeted guid still admits the agent's CDP client", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: false, operator: true });
    const r = await dial(relayUrl(h, "cdp", GUID));
    expect(isOpen(r), JSON.stringify(r)).toBe(true);
    await new Promise((res) => setImmediate(res));
    expect(h.attacher.attachedCdp).toEqual([GUID]);
  });

  it("ext: a dashboard guid (operator:false) still upgrades", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: false, operator: false });
    const r = await dial(relayUrl(h, "ext", GUID), {
      origin: CHROME_EXTENSION_ORIGIN,
    });
    expect(isOpen(r), JSON.stringify(r)).toBe(true);
  });
});


// ─── change: close-container-loopback-impersonation (D10; test-plan #E19, #X6) ──────────────────────────────────
describe("relay tickets (E19)", () => {
  const dialRaw = (h: Harness, role: "ext" | "cdp", guid: string, ticket: string | null, headers: Record<string, string> = {}) => {
    const prefix = role === "ext" ? BROWSER_EXT_PATH : BROWSER_CDP_PATH;
    return dial(`ws://127.0.0.1:${h.port}${prefix}${guid}${ticket === null ? "" : `?ticket=${ticket}`}`, headers);
  };
  const extHeaders = { origin: CHROME_EXTENSION_ORIGIN };

  it("a fresh cdp ticket is admitted once; a replay of the same URL is refused; a CDP attach happens only for the admitted dial", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: true });
    const t = h.attacher.tickets.mint(GUID, "cdp");

    expect(isOpen(await dialRaw(h, "cdp", GUID, t))).toBe(true);
    await new Promise((res) => setImmediate(res));
    expect(h.attacher.attachedCdp).toEqual([GUID]);

    expect(isStatus(await dialRaw(h, "cdp", GUID, t), 403)).toBe(true);
    expect(h.attacher.attachedCdp).toEqual([GUID]); // no second attach
  });

  it("a ticket unused past its 60 s lifetime is refused", async () => {
    let now = 1_000_000;
    const h = await harness();
    // Swap in a clocked store for this attacher.
    (h.attacher as { tickets: RelayTicketStore }).tickets = new RelayTicketStore({ now: () => now });
    h.attacher.live.set(GUID, { claimed: true });
    const t = h.attacher.tickets.mint(GUID, "cdp");
    now += RELAY_TICKET_TTL_MS + 1;
    expect(isStatus(await dialRaw(h, "cdp", GUID, t), 403)).toBe(true);
    expect(h.attacher.attachedCdp).toEqual([]);
  });

  it("a cdp ticket never opens the extension scope (wrong role), and an ext ticket never opens the cdp scope", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: false });
    const cdpTicket = h.attacher.tickets.mint(GUID, "cdp");
    expect(isStatus(await dialRaw(h, "ext", GUID, cdpTicket, extHeaders), 403)).toBe(true);
    const extTicket = h.attacher.tickets.mint(GUID, "ext");
    expect(isStatus(await dialRaw(h, "cdp", GUID, extTicket), 403)).toBe(true);
    // …and neither refusal burned the legitimate other ticket.
    expect(isOpen(await dialRaw(h, "ext", GUID, extTicket, extHeaders))).toBe(true);
    expect(isOpen(await dialRaw(h, "cdp", GUID, cdpTicket))).toBe(true);
    await new Promise((res) => setImmediate(res));
    expect(h.attacher.attachedExt).toEqual([GUID]);
    expect(h.attacher.attachedCdp).toEqual([GUID]);
  });

  it("a ticket for another guid, a missing ticket and a garbage ticket are all refused with attach nowhere", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: true });
    h.attacher.live.set(OTHER_GUID, { claimed: true });
    const other = h.attacher.tickets.mint(OTHER_GUID, "cdp");
    expect(isStatus(await dialRaw(h, "cdp", GUID, other), 403)).toBe(true);
    expect(isStatus(await dialRaw(h, "cdp", GUID, null), 403)).toBe(true);
    expect(isStatus(await dialRaw(h, "cdp", GUID, "not-a-ticket"), 403)).toBe(true);
    expect(h.attacher.attachedCdp).toEqual([]);
  });

  it("an unknown guid and a bad ticket are the SAME refusal (neither is an oracle)", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: true });
    const unknown = await dialRaw(h, "cdp", OTHER_GUID, "whatever");
    const badTicket = await dialRaw(h, "cdp", GUID, "whatever");
    expect(unknown).toEqual(badTicket);
    expect(isStatus(unknown, 403)).toBe(true);
  });

  it("an Origin-bearing request cannot burn the ticket: the legitimate client still gets in afterwards", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: true });
    const t = h.attacher.tickets.mint(GUID, "cdp");
    expect(isStatus(await dialRaw(h, "cdp", GUID, t, { origin: "http://attacker.example" }), 403)).toBe(true);
    expect(isOpen(await dialRaw(h, "cdp", GUID, t))).toBe(true);
  });

  it("both scopes register peerCredential:'plugin' (the core skips only the strict proof requirement)", () => {
    const routes = new Map<string, WsRouteRegistration>();
    const ctx = {
      registerWsRoute: (scope: string, opts: WsRouteRegistration) => routes.set(scope, opts),
      logger: { info() {}, warn() {}, error() {} },
    } as unknown as ServerPluginContext;
    registerBrowserWsRoutes(ctx, new FakeAttacher());
    expect(routes.get(BROWSER_EXT_SCOPE)?.peerCredential).toBe("plugin");
    expect(routes.get(BROWSER_CDP_SCOPE)?.peerCredential).toBe("plugin");
  });
});

describe("a dropped CDP client cannot re-dial the same cdpUrl (X6)", () => {
  it("the ticket is spent after the first attach, so the same URL is refused; a fresh one attaches", async () => {
    const h = await harness();
    h.attacher.live.set(GUID, { claimed: true });
    const url = relayUrl(h, "cdp", GUID);
    expect(isOpen(await dial(url))).toBe(true); // attaches, then the client disconnects
    await new Promise((res) => setImmediate(res));
    expect(isStatus(await dial(url), 403)).toBe(true); // re-dial of the same URL
    expect(isOpen(await dial(relayUrl(h, "cdp", GUID)))).toBe(true); // a fresh `connect` URL attaches
    await new Promise((res) => setImmediate(res));
    expect(h.attacher.attachedCdp).toEqual([GUID, GUID]);
  });
});
