/**
 * SPA fallback tests — validates that client-side routes return index.html and
 * that an unmatched `/api` path is a JSON 404 in every mode (production, dev with
 * a Vite stub, no client build).
 * See change: retro-ux-credential-vault (test-plan E11, E12).
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type DashboardServer } from "../server.js";

// A switch for the "no client build" mode; everything else sees the real resolver.
const clientDist = vi.hoisted(() => ({ noBuild: false }));
vi.mock("../lib/client-dist.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/client-dist.js")>();
  return {
    ...actual,
    resolveStaticClientDir: (...args: Parameters<typeof actual.resolveStaticClientDir>) =>
      clientDist.noBuild ? null : actual.resolveStaticClientDir(...args),
  };
});

/** A raw GET: the path reaches the server exactly as written (no client-side normalisation). */
function rawGet(port: number, rawPath: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: rawPath, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks).toString("utf-8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const serverConfig = { port: 0, piPort: 0, host: "127.0.0.1", autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false } as const;

/** Spellings of an unmatched /api path that reach the not-found handler in every mode (E11). */
const API_MISSES = ["/api/does-not-exist", "/api", "/%61pi/x"];
/** Dot-segment spelling: @fastify/static fails closed (403) on it before the not-found handler whenever a client build is served. */
const DOTTED_MISS = "/x/../api/y";
/** Unparseable by the network guard: refused (403) by the guard itself, before routing, in every mode. */
const GUARD_REFUSED_MISS = "//api/x";

type Raw = { status: number; type: string; body: string };

function expectJsonNotFound(res: Raw, label: string): void {
  expect(res.status, label).toBe(404);
  expect(res.type, label).toContain("application/json");
  expect(JSON.parse(res.body), label).toMatchObject({ success: false, error: "not_found" });
  expect(res.body, label).not.toContain("<html");
}

/** Refused before the not-found handler, but never the SPA shell and never proxied. */
function expectRefusedNotSpa(res: Raw, label: string): void {
  expect(res.status, label).toBe(403);
  expect(res.type, label).toContain("application/json");
  expect(res.body, label).not.toContain("<html");
}

let httpPort: number;
let piPort: number;
let server: DashboardServer;

// Ensure dist/client/index.html exists for the test
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, "../../../dist/client");
const indexPath = path.join(clientDir, "index.html");
let createdDir = false;

describe("SPA fallback", () => {
  beforeAll(async () => {
    // Create minimal dist/client/index.html if it doesn't exist
    if (!fs.existsSync(indexPath)) {
      fs.mkdirSync(clientDir, { recursive: true });
      fs.writeFileSync(indexPath, "<!doctype html><html><body>SPA</body></html>");
      createdDir = true;
    }

    server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: false, // production mode enables static serving + SPA fallback
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    });
    await server.start();
    httpPort = server.httpPort()!;
    piPort = server.piPort()!;
  });

  afterAll(async () => {
    if (server) await server.stop();
    if (createdDir) {
      fs.rmSync(indexPath);
    }
  });

  it("returns index.html for /session/:id route", async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/session/abc-123`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("html");
  });

  it("returns index.html for unknown client routes", async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/some/unknown/path`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("html");
  });

  it("still serves API routes normally", async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/api/sessions`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("E11 production: every unmatched /api spelling is a JSON 404; the documented limit and the SPA are unchanged", async () => {
    for (const p of API_MISSES) expectJsonNotFound(await rawGet(httpPort, p), p);
    expectRefusedNotSpa(await rawGet(httpPort, DOTTED_MISS), DOTTED_MISS);
    expectRefusedNotSpa(await rawGet(httpPort, GUARD_REFUSED_MISS), GUARD_REFUSED_MISS);
    // `decodeURI` leaves %2F encoded, so this is outside /api/ in both guard views: SPA shell (documented limit).
    const encoded = await rawGet(httpPort, "/api%2Fx");
    expect(encoded.status).toBe(200);
    expect(encoded.type).toContain("text/html");
    const spa = await rawGet(httpPort, "/session/abc-123");
    expect(spa.status).toBe(200);
    expect(spa.body).toContain("html");
    const health = await rawGet(httpPort, "/api/health");
    expect(health.status).toBe(200);
    expect(health.type).toContain("application/json");
  });

  it("an unmatched /api path is a JSON 404 for every method, and names the path (≤ 200 chars, no query)", async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/api/nope?token=secret-abc`, { method: "POST" });
    expect(res.status).toBe(404);
    const json = await res.json() as { message: string };
    expect(json.message).toBe("No API route for POST /api/nope");
    const long = await rawGet(httpPort, `/api/${"a".repeat(500)}`);
    expect(JSON.parse(long.body).message.length).toBeLessThanOrEqual("No API route for GET ".length + 200);
  });
});

describe("SPA fallback — no client build", () => {
  let noBuildServer: DashboardServer;
  beforeAll(async () => {
    clientDist.noBuild = true;
    noBuildServer = await createServer({ ...serverConfig, dev: false });
    await noBuildServer.start();
  });
  afterAll(async () => {
    clientDist.noBuild = false;
    await noBuildServer?.stop();
  });

  it("E11 no build: /api misses are a JSON 404; other paths keep the no-build error", async () => {
    const port = noBuildServer.httpPort()!;
    for (const p of [...API_MISSES, DOTTED_MISS]) expectJsonNotFound(await rawGet(port, p), p);
    expectRefusedNotSpa(await rawGet(port, GUARD_REFUSED_MISS), GUARD_REFUSED_MISS);
    const other = await rawGet(port, "/session/abc-123");
    expect(other.status).toBe(500);
    expect(other.body).toContain("No client build found");
  });
});

describe("SPA fallback — development mode", () => {
  let devServer: DashboardServer;
  let vite: http.Server | undefined;
  let viteRequests = 0;

  beforeAll(async () => {
    // The dev server probes these ports for Vite. Take the first free one with a counting stub.
    for (const port of [3000, 5173, 5174]) {
      const candidate = http.createServer((_req, res) => { viteRequests++; res.end("vite-stub"); });
      const bound = await new Promise<boolean>((resolve) => {
        candidate.once("error", () => resolve(false));
        candidate.listen(port, () => resolve(true));
      });
      if (bound) { vite = candidate; break; }
    }
    devServer = await createServer({ ...serverConfig, dev: true });
    await devServer.start();
  });
  afterAll(async () => {
    await devServer?.stop();
    await new Promise<void>((resolve) => (vite ? vite.close(() => resolve()) : resolve()));
  });

  it("E11/E12 dev: /api misses are a JSON 404 and never reach Vite", async (ctx) => {
    if (!vite) return ctx.skip(); // 3000, 5173 and 5174 are all taken on this machine (a real Vite is probably running)
    const port = devServer.httpPort()!;
    // Control: a client path IS proxied to the stub, so the stub is really in the loop.
    // Another service on a higher-precedence Vite port answers first: the stub is not in the loop, so skip.
    const control = (await rawGet(port, "/session/abc-123")).body;
    if (control !== "vite-stub") return ctx.skip();
    viteRequests = 0;
    for (const p of API_MISSES) expectJsonNotFound(await rawGet(port, p), p);
    expectRefusedNotSpa(await rawGet(port, DOTTED_MISS), DOTTED_MISS);
    expectRefusedNotSpa(await rawGet(port, GUARD_REFUSED_MISS), GUARD_REFUSED_MISS);
    expect(viteRequests).toBe(0);
  });
});
