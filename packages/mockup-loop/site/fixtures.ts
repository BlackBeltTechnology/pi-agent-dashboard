// GENERIC network fixtures (framework-free). A mock's `fixtures()` factory runs once
// per pane and per script loop; its handlers answer the app's fetch / XHR /
// WebSocket traffic INSIDE the pane's own document (no service worker: works on a
// plain-HTTP LAN URL). Unhandled requests get 501 and are reported as missing
// fixtures. Interceptors are lazy-loaded optional peers.
// See change: add-mock-site-exact-env (design D3).

export interface FixtureRequest {
  method: string;
  url: URL;
  path: string;
  /** `:name` segments of the matched route. */
  params: Record<string, string>;
  body: string;
  json<T = unknown>(): T;
}
/** A `Response`, or any JSON-serialisable value (sent as 200 application/json). */
export type FixtureReply = Response | unknown;
export interface FixtureSocket {
  send(data: string | object): void;
  close(): void;
  onMessage(cb: (data: string) => void): void;
}
export interface HarFixtures { entries: { method: string; path: string; query?: string; status: number; contentType?: string; body: string }[] }
export interface Fixtures {
  /** Keys `"GET /api/runs/:id"` (or bare `"/api/x"` = any method). */
  http?: Record<string, (req: FixtureRequest) => FixtureReply | Promise<FixtureReply>>;
  /** Keys: WebSocket URL path. */
  ws?: Record<string, (socket: FixtureSocket) => void>;
  /** Captured traffic (`mock-capture` → `fixtures.har.json`), used after `http`. */
  har?: HarFixtures;
  /** Requests allowed to reach the network (URL substring or RegExp). */
  passthrough?: (string | RegExp)[];
}

/** Same-origin dev-server traffic that is never a fixture concern. */
const DEV_PATHS = /^\/(@vite|@fs|@id|@react-refresh|node_modules|__mock)\b/;

/** `:params` of `pattern` against `path`, or null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/"), b = path.split("/");
  if (a.length !== b.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) out[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return out;
}

export type Resolved =
  | { kind: "http"; handler: (req: FixtureRequest) => FixtureReply | Promise<FixtureReply>; params: Record<string, string> }
  | { kind: "har"; entry: HarFixtures["entries"][number] }
  | { kind: "passthrough" }
  | { kind: "missing" };

/** Decide how a request is answered (pure). */
export function resolveRequest(fx: Fixtures, method: string, url: URL, origin: string): Resolved {
  if (url.origin === origin && DEV_PATHS.test(url.pathname)) return { kind: "passthrough" };
  const m = method.toUpperCase();
  for (const [key, handler] of Object.entries(fx.http ?? {})) {
    const sp = key.indexOf(" ");
    const [km, kp] = sp > 0 ? [key.slice(0, sp).toUpperCase(), key.slice(sp + 1).trim()] : ["*", key.trim()];
    if (km !== "*" && km !== m) continue;
    const params = matchPath(kp, url.pathname);
    if (params) return { kind: "http", handler, params };
  }
  const har = (fx.har?.entries ?? []).filter((e) => e.method === m && e.path === url.pathname);
  const entry = har.find((e) => (e.query ?? "") === url.search) ?? har[0];
  if (entry) return { kind: "har", entry };
  if ((fx.passthrough ?? []).some((p) => (typeof p === "string" ? url.href.includes(p) : p.test(url.href)))) return { kind: "passthrough" };
  return { kind: "missing" };
}

/** A fixture reply as a `Response`. */
function toResponse(v: FixtureReply): Response {
  if (v instanceof Response) return v;
  return new Response(JSON.stringify(v ?? null), { status: 200, headers: { "content-type": "application/json" } });
}

export interface InstalledFixtures {
  /** New fixture instance (fresh factory call) for the next loop. */
  reset(): void;
}

/** Install fetch / XHR / WebSocket interception into THIS window (the pane document). */
export async function installFixtures(factory: () => Fixtures, onMissing: (m: { method: string; path: string }) => void): Promise<InstalledFixtures> {
  const [{ FetchInterceptor }, { XMLHttpRequestInterceptor }, { WebSocketInterceptor }] = await Promise.all([
    import("@mswjs/interceptors/fetch"),
    import("@mswjs/interceptors/XMLHttpRequest"),
    import("@mswjs/interceptors/WebSocket"),
  ]);
  let fx = factory();
  const origin = location.origin;
  for (const I of [FetchInterceptor, XMLHttpRequestInterceptor]) {
    const it = new I();
    it.on("request", async ({ request, controller }) => {
      const url = new URL(request.url);
      const r = resolveRequest(fx, request.method, url, origin);
      if (r.kind === "passthrough") return;
      if (r.kind === "missing") {
        onMissing({ method: request.method.toUpperCase(), path: url.pathname });
        controller.respondWith(new Response(`no fixture for ${request.method} ${url.pathname}`, { status: 501 }));
        return;
      }
      if (r.kind === "har") {
        const e = r.entry;
        const empty = e.status === 204 || e.status === 304;
        controller.respondWith(new Response(empty ? null : e.body, { status: e.status, headers: { "content-type": e.contentType ?? "application/json" } }));
        return;
      }
      const body = await request.clone().text();
      const req: FixtureRequest = { method: request.method.toUpperCase(), url, path: url.pathname, params: r.params, body, json: () => JSON.parse(body) };
      controller.respondWith(toResponse(await r.handler(req)));
    });
    it.apply();
  }
  const ws = new WebSocketInterceptor();
  ws.on("connection", ({ client, server, info }) => {
    const url = new URL(client.url);
    const protocols = ([] as string[]).concat(info.protocols ?? []);
    const handler = Object.entries(fx.ws ?? {}).find(([p]) => matchPath(p, url.pathname))?.[1];
    if (handler) {
      handler({
        send: (d) => client.send(typeof d === "string" ? d : JSON.stringify(d)),
        close: () => client.close(),
        onMessage: (cb) => client.addEventListener("message", (e) => cb(String(e.data))),
      });
      return;
    }
    const devSocket = protocols.some((p) => p.startsWith("vite-")) || (url.host === location.host && DEV_PATHS.test(url.pathname));
    if (devSocket || (fx.passthrough ?? []).some((p) => (typeof p === "string" ? url.href.includes(p) : p.test(url.href)))) {
      server.connect();
      return;
    }
    onMissing({ method: "WS", path: url.pathname });
    client.close(4004, "no fixture");
  });
  ws.apply();
  return { reset: () => { fx = factory(); } };
}
