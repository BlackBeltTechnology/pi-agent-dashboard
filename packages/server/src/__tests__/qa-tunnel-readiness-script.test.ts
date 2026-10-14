/**
 * Self-check of `qa/tests/20-tunnel-readiness-perf.sh` against stub servers:
 * a server whose `/api/tunnel-readiness` route is absent answers 404 JSON
 * `not_found`, and the script must name that as "server predates the readiness
 * endpoint" without the retired "200 text/html" explanation.
 * See change: retro-ux-credential-vault (test-plan X10, design D7, task 2.6).
 */

import { execFile } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../qa/tests/20-tunnel-readiness-perf.sh");

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

async function stub(onReadiness: (res: http.ServerResponse) => void): Promise<number> {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/health") { res.writeHead(200, JSON_HEADERS).end('{"success":true}'); return; }
    if (req.url === "/api/tunnel-readiness") { onReadiness(res); return; }
    res.writeHead(404, JSON_HEADERS).end('{"success":false,"error":"not_found"}');
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

function run(port: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("bash", [script], { env: { ...process.env, PI_QA_PORT: String(port), PI_QA_READINESS_SAMPLES: "3" }, timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` });
    });
  });
}

describe.skipIf(process.platform === "win32")("qa 20-tunnel-readiness-perf.sh", () => {
  it("X10: a missing endpoint (404 JSON not_found) exits 1 naming an older server, with no `200 text/html` wording", async () => {
    const port = await stub((res) => res.writeHead(404, JSON_HEADERS).end('{"success":false,"error":"not_found","message":"No API route for GET /api/tunnel-readiness"}'));
    const { code, out } = await run(port);
    expect(code).toBe(1);
    expect(out).toContain("server predates the readiness endpoint");
    expect(out).not.toMatch(/200 text\/html/);
  });

  it("an older server that answers the missing route with the SPA shell still fails, without the retired wording", async () => {
    const port = await stub((res) => res.writeHead(200, { "content-type": "text/html" }).end("<html></html>"));
    const { code, out } = await run(port);
    expect(code).toBe(1);
    expect(out).toContain("server predates the readiness endpoint");
    expect(out).not.toMatch(/200 text\/html/);
  });

  it("a server that has the endpoint passes the shape gate and the latency budget", async () => {
    const port = await stub((res) => res.writeHead(200, JSON_HEADERS).end('{"success":true,"data":{"providers":[]}}'));
    const { code, out } = await run(port);
    expect(out).toContain("PASS: readiness tick within budget");
    expect(code).toBe(0);
  });
});
