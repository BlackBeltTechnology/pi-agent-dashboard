/**
 * Loopback relay shim. The stock Playwright extension dials
 * `ws://127.0.0.1:<port>/ws/browser-ext/<linkId>`; this listener accepts that
 * dial and relays frames to/from the renderer carrier via {@link ShimEvent}s.
 *
 * - One listener on `127.0.0.1:0` for all links; it starts with the first
 *   registered link and stops with the last one (idle → closed).
 * - Accepts an upgrade ONLY for a registered, unclaimed `linkId` carrying
 *   `Origin: chrome-extension://<pinned id>`; one socket per link (single use).
 *   Everything else — wrong Origin, no Origin, unknown path/link, claimed
 *   link, plain HTTP — gets the same 404 (no oracle). The Origin check is not
 *   authentication (a local process can forge it): the `linkId` is the
 *   credential, registered only after the operator allowed the connect, single
 *   use, and expiring unclaimed after 60 s.
 * - A close initiated by the host side (`unregister` / `close` / `closeAll`) emits
 *   no `close` event; only an extension-initiated close does.
 *
 * Imports no electron — unit-tested against a real `ws` pair in
 * `__tests__/shim.test.ts`.
 *
 * See change: add-operator-browser-relay (D9).
 */
import http from "node:http";
import type { Socket } from "node:net";
import type { BrowserHostExtEvent, Unsubscribe } from "@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js";
import { PLAYWRIGHT_EXTENSION_ID } from "@blackbelt-technology/pi-dashboard-shared/chrome-profiles.js";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

const LOOPBACK = "127.0.0.1";
const PINNED_ORIGIN = `chrome-extension://${PLAYWRIGHT_EXTENSION_ID}`;
const PATH_RE = /^\/ws\/browser-ext\/([A-Za-z0-9_-]{1,128})$/;
/** One extension frame ≤ 16 MiB (design D5). */
const MAX_PAYLOAD = 16 * 1024 * 1024;
/** An allowed link nobody dialled is dropped after this long (server handshake window is 60 s). */
const UNCLAIMED_LINK_TTL_MS = 60_000;
const NOT_FOUND = "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";

export interface Shim {
  /** Register `linkId` (call only after the operator allowed it) and return the listener port. */
  register(linkId: string): Promise<number>;
  /** Drop a link and terminate its extension socket (no event). Stops the listener when idle. */
  unregister(linkId: string): void;
  /** Close the link's extension socket with `code` and drop the link (no event). */
  close(linkId: string, code: number): void;
  closeAll(): void;
  /** Text frame to the extension; dropped when the extension is not attached. */
  send(linkId: string, data: string): void;
  has(linkId: string): boolean;
  /** Listener port, or undefined while idle. */
  port(): number | undefined;
  address(): string;
  onEvent(cb: (ev: BrowserHostExtEvent) => void): Unsubscribe;
}

interface Link {
  claimed: boolean;
  socket?: WebSocket;
  /** Set when the host side closed it: suppresses the `close` event. */
  hostClosed: boolean;
  ttl?: ReturnType<typeof setTimeout>;
}

interface Listener {
  server: http.Server;
  port: number;
}

const toText = (data: RawData): string =>
  Buffer.isBuffer(data) ? data.toString("utf8") : Array.isArray(data) ? Buffer.concat(data).toString("utf8") : Buffer.from(data).toString("utf8");

/** WebSocket close codes an endpoint may send (RFC 6455 §7.4.1); others fall back to 1000. */
const sendableCode = (code: number): number => (Number.isInteger(code) && ((code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) || (code >= 3000 && code <= 4999)) ? code : 1000);

export function createShim(opts: { log?: (line: string) => void; linkTtlMs?: number } = {}): Shim {
  const log = opts.log ?? (() => {});
  const ttl = opts.linkTtlMs ?? UNCLAIMED_LINK_TTL_MS;
  const links = new Map<string, Link>();
  const subscribers = new Set<(ev: BrowserHostExtEvent) => void>();
  let listening: Promise<Listener> | undefined;
  let boundPort: number | undefined;

  const emit = (ev: BrowserHostExtEvent): void => {
    for (const cb of subscribers) {
      try {
        cb(ev);
      } catch {
        /* a subscriber must not break the relay */
      }
    }
  };

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

  const reject = (socket: Socket): void => {
    socket.end(NOT_FOUND);
    socket.destroy();
  };

  const onUpgrade = (req: http.IncomingMessage, socket: Socket, head: Buffer): void => {
    socket.on("error", () => {});
    const pathname = (req.url ?? "").split("?")[0] ?? "";
    const linkId = PATH_RE.exec(pathname)?.[1];
    const link = linkId ? links.get(linkId) : undefined;
    if (!linkId || !link || link.claimed || req.headers.origin !== PINNED_ORIGIN) {
      reject(socket);
      return;
    }
    link.claimed = true; // synchronously: a racing second dial loses
    if (link.ttl) clearTimeout(link.ttl);
    wss.handleUpgrade(req, socket, head, (ws) => {
      link.socket = ws;
      ws.on("message", (data) => emit({ kind: "data", linkId, data: toText(data) }));
      ws.on("error", () => {});
      ws.on("close", (code) => {
        if (links.get(linkId) === link) {
          links.delete(linkId);
          if (!link.hostClosed) emit({ kind: "close", linkId, code });
          stopIfIdle();
        }
      });
      if (link.hostClosed) {
        ws.terminate();
        return;
      }
      emit({ kind: "open", linkId });
    });
  };

  const ensureListening = (): Promise<Listener> => {
    listening ??= new Promise<Listener>((resolve, reject) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(404, { Connection: "close", "Content-Length": "0" });
        res.end();
      });
      server.on("upgrade", onUpgrade);
      server.once("error", (e) => {
        listening = undefined;
        reject(e);
      });
      server.listen(0, LOOPBACK, () => {
        const addr = server.address();
        boundPort = typeof addr === "object" && addr ? addr.port : undefined;
        if (boundPort === undefined) reject(new Error("shim: no port"));
        else resolve({ server, port: boundPort });
      });
    });
    return listening;
  };

  function stopIfIdle(): void {
    if (links.size > 0 || !listening) return;
    const closing = listening;
    listening = undefined;
    boundPort = undefined;
    closing.then(({ server }) => {
      server.close();
      server.closeAllConnections();
    }, () => {});
  }

  const drop = (linkId: string, how: (ws: WebSocket) => void): void => {
    const link = links.get(linkId);
    if (!link) return;
    link.hostClosed = true;
    if (link.ttl) clearTimeout(link.ttl);
    links.delete(linkId);
    if (link.socket) how(link.socket);
    stopIfIdle();
  };

  return {
    async register(linkId) {
      if (!PATH_RE.test(`/ws/browser-ext/${linkId}`)) throw new Error("invalid linkId");
      if (links.has(linkId)) throw new Error("link already registered");
      const link: Link = { claimed: false, hostClosed: false };
      links.set(linkId, link);
      link.ttl = setTimeout(() => {
        if (!link.claimed) drop(linkId, () => {});
      }, ttl);
      link.ttl.unref?.();
      try {
        return (await ensureListening()).port;
      } catch (e) {
        drop(linkId, () => {});
        log(`[browser-host] shim listen failed: ${(e as Error).message}`);
        throw e;
      }
    },
    unregister: (linkId) => drop(linkId, (ws) => ws.terminate()),
    close: (linkId, code) => drop(linkId, (ws) => ws.close(sendableCode(code))),
    closeAll() {
      for (const id of [...links.keys()]) drop(id, (ws) => ws.terminate());
    },
    send(linkId, data) {
      const ws = links.get(linkId)?.socket;
      if (ws && ws.readyState === ws.OPEN) ws.send(data);
    },
    has: (linkId) => links.has(linkId),
    port: () => boundPort,
    address: () => LOOPBACK,
    onEvent(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  };
}

/**
 * `chrome-extension://<id>/connect.html?mcpRelayUrl=…&client=…&protocolVersion=2[&token=…]`
 * — the same URL the browser plugin's `buildConnectUrl` builds, replicated here
 * (Electron does not import the plugin). `token` is appended locally only.
 */
export function buildOperatorConnectUrl(opts: { port: number; linkId: string; token?: string | null }): string {
  const url = new URL(`chrome-extension://${PLAYWRIGHT_EXTENSION_ID}/connect.html`);
  url.searchParams.set("mcpRelayUrl", `ws://${LOOPBACK}:${opts.port}/ws/browser-ext/${opts.linkId}`);
  url.searchParams.set("client", JSON.stringify({ name: "pi-dashboard" }));
  url.searchParams.set("protocolVersion", "2");
  if (typeof opts.token === "string" && opts.token.length > 0) url.searchParams.set("token", opts.token);
  return url.toString();
}
