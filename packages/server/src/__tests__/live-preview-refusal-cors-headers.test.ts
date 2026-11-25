/**
 * A refusal never carries CORS headers (D10, D3), inside the REAL dashboard server: the duplicate-cookie 400 (with a loopback
 * Origin and with a preview Origin) and the host-gate 403 (with a preview-shaped Origin) answer with no `Access-Control-Allow-*`
 * and no `Vary: Origin`, so a DNS-rebinding or preview page cannot read the refusal body.
 *
 * See change: serve-live-previews-on-capability-origin (D3, D10; test-plan #X42).
 */
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;
afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

const LABEL = "k7q4zm2x5c6h3v4d5fjqwyabn7";

interface Res {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}
function get(port: number, headers: Record<string, string>, urlPath = "/api/health", accept = "application/json"): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, headers: { accept, ...headers }, setHost: false, agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

const corsHeaders = (h: http.IncomingHttpHeaders): string[] =>
  Object.keys(h).filter((k) => k.startsWith("access-control-"));
const varyOrigin = (h: http.IncomingHttpHeaders): boolean => /(^|,)\s*origin\s*(,|$)/i.test(String(h.vary ?? ""));

describe("T.X42 / #X42 — refusal never carries CORS headers", () => {
  it("control: an admitted loopback request WITH that Origin does get CORS headers (so absence below is meaningful)", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    const ok = await get(port, { host: `localhost:${port}`, origin: `http://localhost:${port}` });
    expect(ok.status).toBe(200);
    expect(ok.headers["access-control-allow-origin"]).toBe(`http://localhost:${port}`);
    expect(varyOrigin(ok.headers)).toBe(true);
  }, 90_000);

  it("duplicate pi_dash_* cookie: 400 with no Access-Control-Allow-* / Vary: Origin, for a loopback Origin and for a preview Origin", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    const cookie = "pi_dash_token=aaa; pi_dash_token=bbb";
    for (const origin of [`http://localhost:${port}`, `http://${LABEL}.localhost:${port}`, `http://${LABEL}.preview.example.com`]) {
      for (const accept of ["application/json", "text/html"]) {
        const r = await get(port, { host: `localhost:${port}`, origin, cookie }, "/api/health", accept);
        expect(r.status, `${origin} ${accept}`).toBe(400);
        expect(corsHeaders(r.headers), `${origin} ${accept}`).toEqual([]);
        expect(varyOrigin(r.headers), `${origin} ${accept}`).toBe(false);
        if (accept === "application/json") expect(JSON.parse(r.body)).toMatchObject({ error: "duplicate_dashboard_cookie" });
      }
    }
  }, 90_000);

  it("host-gate 403 with a preview-shaped Origin (and a loopback one): no Access-Control-Allow-* / Vary: Origin", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    for (const origin of [`http://${LABEL}.localhost:${port}`, `http://${LABEL}.preview.example.com`, "http://192.168.1.5:8101", `http://localhost:${port}`]) {
      for (const accept of ["application/json", "text/html"]) {
        const r = await get(port, { host: "rebind.attacker.example", origin }, "/api/health", accept);
        expect(r.status, `${origin} ${accept}`).toBe(403);
        expect(corsHeaders(r.headers), `${origin} ${accept}`).toEqual([]);
        expect(varyOrigin(r.headers), `${origin} ${accept}`).toBe(false);
      }
    }
    // a refusal of BOTH kinds at once (rebinding Host + duplicate cookie): the host gate wins, still no CORS headers
    const both = await get(port, { host: "rebind.attacker.example", origin: `http://${LABEL}.localhost:${port}`, cookie: "pi_dash_token=a; pi_dash_token=b" });
    expect(both.status).toBe(403);
    expect(corsHeaders(both.headers)).toEqual([]);
    expect(varyOrigin(both.headers)).toBe(false);
  }, 90_000);
});
