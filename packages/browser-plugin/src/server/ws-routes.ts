/**
 * Plugin-owned WebSocket routes for the browser relay (change:
 * add-browser-relay, task 2.5; design D1/D2).
 *
 * Two scopes on the main HTTP listener:
 *
 *  - `browser-ext` (`/ws/browser-ext/<guid>`) — the pinned Playwright Chrome
 *    Extension dials in. `admitOrigins` pins the extension id exactly, so no
 *    page origin can present here (the core policy is not consulted).
 *  - `browser-cdp` (`/ws/browser-cdp/<guid>`) — the agent's CDP client dials in
 *    (Playwright `connectOverCDP` sends no custom headers). The core keeps the
 *    dashboard origin policy (empty `admitOrigins`), and this handler ADDITION-
 *    ALLY refuses any request carrying an `Origin` header: web content always
 *    sends one, a CDP client never does, so a page that somehow obtained the
 *    `cdpUrl` cannot open it.
 *
 * The CORE upgrade gate owns host admission, origin admission and the genuinely
 * local peer requirement (spec plugin-ws-route) and only calls `handleUpgrade`
 * once those pass. Here we own the last mile: extract the guid, check it is live
 * (404 otherwise), apply the cdp `Origin` refusal, complete the handshake, and
 * hand the socket to the relay manager's `attach*`. `meta.trackSocket` must be
 * called or a later plugin disable could not close the socket.
 *
 * The guid is the ONLY credential on these routes — no cookie, local token,
 * ticket or trusted-CIDR bypass is evaluated for a plugin scope (spec
 * browser-relay "Both endpoints").
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { WebSocketServer } from "ws";
import type { RelaySocket } from "./relay/extension-socket.js";

export const BROWSER_EXT_SCOPE = "browser-ext";
export const BROWSER_CDP_SCOPE = "browser-cdp";
export const BROWSER_EXT_PATH = "/ws/browser-ext/";
export const BROWSER_CDP_PATH = "/ws/browser-cdp/";

/** The Playwright Chrome Extension id the ext route admits. */
export const CHROME_EXTENSION_ORIGIN = "chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm";

/**
 * The manager surface the routes need. Narrow on purpose so the routes can be
 * tested without a live `RelayManager`; `RelayManager` satisfies it structurally.
 */
export interface RelayAttacher {
  /** Live guid → its entry, or undefined (unknown / expired / malformed). */
  resolve(guid: string): { claimed: boolean } | undefined;
  /** Attach an accepted extension socket. Returns false only for an unknown guid. */
  attachExtension(guid: string, ws: RelaySocket): boolean;
  /** Attach an accepted CDP client socket. Returns false only for an unknown guid. */
  attachCdp(guid: string, ws: RelaySocket): boolean;
}

/** The single path segment after `prefix`, or null (empty / nested / wrong prefix). */
function guidFromPath(url: string | undefined, prefix: string): string | null {
  const path = (url ?? "").split("?")[0];
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  if (rest.length === 0 || rest.includes("/")) return null;
  return rest;
}

/** A deliberate HTTP refusal (not a bare TCP destroy) so a client can tell why. */
function refuse(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\n\r\n`);
  socket.destroy();
}

/**
 * Register both relay scopes on `ctx`. MUST be called during the plugin's
 * server-entry activation (the loader opens the window; `registerWsRoute`
 * throws outside it).
 */
export function registerBrowserWsRoutes(ctx: ServerPluginContext, manager: RelayAttacher): void {
  // `noServer`: the core upgrade handler already owns the HTTP listener and has
  // done the handshake admission; these servers only complete the WS handshake.
  const extWss = new WebSocketServer({ noServer: true });
  const cdpWss = new WebSocketServer({ noServer: true });

  ctx.registerWsRoute(BROWSER_EXT_SCOPE, {
    pathPrefix: BROWSER_EXT_PATH,
    admitOrigins: [CHROME_EXTENSION_ORIGIN],
    handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer, meta) => {
      const guid = guidFromPath(request.url, BROWSER_EXT_PATH);
      if (!guid || !manager.resolve(guid)) {
        refuse(socket, 404, "Not Found");
        return;
      }
      extWss.handleUpgrade(request, socket, head, (ws) => {
        meta.trackSocket(ws);
        // The guid may have expired between `resolve` and this async callback;
        // `attachExtension` returns false then, and the socket must not linger
        // upgraded-but-orphaned.
        if (!manager.attachExtension(guid, ws)) ws.close(1000, "unknown guid");
      });
    },
  });

  ctx.registerWsRoute(BROWSER_CDP_SCOPE, {
    pathPrefix: BROWSER_CDP_PATH,
    admitOrigins: [],
    handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer, meta) => {
      // Web content always attaches an Origin; a CDP client never does. Refuse
      // the former before any guid work so a leaked cdpUrl is useless to a page.
      if (request.headers.origin !== undefined) {
        refuse(socket, 403, "Forbidden");
        return;
      }
      const guid = guidFromPath(request.url, BROWSER_CDP_PATH);
      if (!guid || !manager.resolve(guid)) {
        refuse(socket, 404, "Not Found");
        return;
      }
      cdpWss.handleUpgrade(request, socket, head, (ws) => {
        meta.trackSocket(ws);
        if (!manager.attachCdp(guid, ws)) ws.close(1000, "unknown guid");
      });
    },
  });
}
