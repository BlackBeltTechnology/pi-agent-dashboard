/**
 * The dispatch seam inside the REAL dashboard server (`server.ts` wiring of D3): a preview-shaped Host is
 * answered by `previewApp` (opaque 403), an ordinary Host by the dashboard; a preview-shaped upgrade is
 * refused before the dashboard upgrade switch.
 *
 * See change: serve-live-previews-on-capability-origin (D3; task 3.6).
 */
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;
afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

const LABEL = "a".repeat(26);

function get(port: number, host: string, path = "/api/health"): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
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
}

describe("preview dispatch inside the dashboard server", () => {
  it("an unknown label Host gets the opaque preview 403; a normal Host reaches the dashboard", async () => {
    handle = await createTestServer();
    const preview = await get(handle.httpPort, `${LABEL}.localhost:${handle.httpPort}`);
    expect(preview.status).toBe(403);
    expect(JSON.parse(preview.body)).toEqual({ error: "host_not_allowed" });
    expect(preview.headers["access-control-allow-origin"]).toBeUndefined();

    const dash = await get(handle.httpPort, `localhost:${handle.httpPort}`);
    expect(dash.status).toBe(200);
    expect(JSON.parse(dash.body).ok).toBe(true);
  });

  it("the dashboard SPA, API and auth paths are not reachable through a preview Host", async () => {
    handle = await createTestServer();
    for (const p of ["/", "/api/health", "/api/sessions", "/auth/logout"]) {
      const r = await get(handle.httpPort, `${LABEL}.localhost:${handle.httpPort}`, p);
      expect(r.status, p).toBe(403);
      expect(r.body, p).not.toContain("ok");
    }
  });

  it("a preview-shaped upgrade is refused with a bare 403 before the dashboard upgrade switch", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    const out = await new Promise<string>((resolve) => {
      const s = net.connect(port, "127.0.0.1", () =>
        s.write(
          `GET /ws HTTP/1.1\r\nHost: ${LABEL}.localhost:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        ),
      );
      let buf = "";
      s.on("data", (c) => {
        buf += c.toString();
      });
      s.on("close", () => resolve(buf));
      s.on("error", () => resolve(buf));
    });
    expect(out).toContain("403");
  });
});
