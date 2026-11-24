import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

/**
 * A tiny CONTROLLABLE upstream "dev server" for live-preview specs: the thing the dashboard
 * previews. It binds `127.0.0.1` on a free port (the live-server SSRF gate only accepts loopback
 * targets) and serves, by default:
 *
 *   /                  static page (`<h1 id="static">`, writes `localStorage.k = "v"`), then runs
 *                      `upstream.script` — the "page that does arbitrary things": set cookies,
 *                      navigate top/self to the dashboard, nest a dashboard iframe, open a
 *                      WebSocket, fetch the dashboard… The viewer frames the target ROOT, so
 *                      assign `upstream.script` BEFORE opening the viewer.
 *   /run               same page without the static prelude (`<h1 id="run">`)
 *   /hmr               HMR-like page: `<script type=module src="/@vite/client">` + `/src/main.js`
 *                      (the client opens `ws://<host>/` and sets `window.__hmr`)
 *   /@vite/client      the module above (200)
 *   /ws (+ Upgrade)    WebSocket echo (any path)
 *   anything else      404 with body `upstream-404` (so a spec can tell the UPSTREAM answered)
 *
 * Every request is recorded in `requests` (method, url, selected headers) — e.g. to assert which
 * `Origin`/`Host` the dashboard proxy forwarded. `route()` adds or overrides a path.
 *
 * Page results convention: scripts write their outcome to `window.__result` so the spec reads it
 * with `frame.evaluate(() => window.__result)`.
 */
interface RecordedRequest {
  method: string;
  url: string;
  host?: string;
  origin?: string;
  upgrade?: string;
}
type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

export interface Upstream {
  /** Listening port (127.0.0.1). */
  port: number;
  /** `http://127.0.0.1:<port>` — use as the previewed target (`live-url` input / REST `port`). */
  url: string;
  /** Inline script appended to `/` and served by `/run`; assign before opening the viewer. Default: no-op. */
  script: string;
  /** Opt-in: behave like a dev server running under the tier-5 base — serve `/preview/<pid>/<rest>` as `/<rest>`. Default off (404, the full path is forwarded). */
  baseAware: boolean;
  requests: RecordedRequest[];
  /** Serve `body` (string) or call a handler for `path` (exact match, query ignored). */
  route(path: string, body: string | RouteHandler, contentType?: string): void;
  close(): Promise<void>;
}

const html = (body: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>upstream</title></head><body>${body}</body></html>`;

const HMR_CLIENT = `// vite-like client
const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/", "vite-hmr");
window.__hmr = "connecting";
ws.addEventListener("open", () => { window.__hmr = "open"; });
ws.addEventListener("close", () => { window.__hmr = "closed"; });
ws.addEventListener("message", (e) => { window.__hmrLast = String(e.data); });
export {};
`;

export async function startUpstream(): Promise<Upstream> {
  const routes = new Map<string, string | RouteHandler>();
  const types = new Map<string, string>();
  const up: Upstream = {
    port: 0,
    url: "",
    script: "",
    baseAware: false,
    requests: [],
    route(path, body, contentType) {
      routes.set(path, body);
      if (contentType) types.set(path, contentType);
    },
    close: () => new Promise((resolve) => { for (const c of wss.clients) c.terminate(); wss.close(); server.closeAllConnections(); server.close(() => resolve()); }),
  };

  const server = http.createServer((req, res) => {
    let pathname = new URL(req.url ?? "/", "http://x").pathname;
    if (up.baseAware) pathname = pathname.replace(/^\/preview\/[^/]+/, "") || "/";
    up.requests.push({ method: req.method ?? "GET", url: req.url ?? "/", host: req.headers.host, origin: req.headers.origin as string | undefined });
    const custom = routes.get(pathname);
    if (typeof custom === "function") return custom(req, res);
    const send = (status: number, type: string, body: string) => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    if (typeof custom === "string") return send(200, types.get(pathname) ?? "text/html; charset=utf-8", custom);
    switch (pathname) {
      case "/":
        return send(200, "text/html; charset=utf-8", html(`<h1 id="static">static upstream</h1><script>try { localStorage.k = "v"; } catch (e) { window.__lsError = String(e); } window.__origin = location.origin;</script><script>${up.script}</script>`));
      case "/run":
        return send(200, "text/html; charset=utf-8", html(`<h1 id="run">run upstream</h1><script>${up.script}</script>`));
      case "/hmr":
        return send(200, "text/html; charset=utf-8", html(`<h1 id="hmr">hmr upstream</h1><script type="module" src="/@vite/client"></script><script type="module" src="/src/main.js"></script>`));
      case "/@vite/client":
        return send(200, "text/javascript; charset=utf-8", HMR_CLIENT);
      case "/src/main.js":
        return send(200, "text/javascript; charset=utf-8", `document.body.dataset.main = "loaded";`);
      default:
        return send(404, "text/plain; charset=utf-8", "upstream-404");
    }
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    up.requests.push({ method: "GET", url: req.url ?? "/", host: req.headers.host, origin: req.headers.origin as string | undefined, upgrade: String(req.headers.upgrade) });
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("message", (m) => ws.send(String(m)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  up.port = (server.address() as AddressInfo).port;
  up.url = `http://127.0.0.1:${up.port}`;
  return up;
}
