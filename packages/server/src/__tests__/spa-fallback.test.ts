/**
 * SPA fallback tests — validates that client-side routes return index.html.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createServer, type DashboardServer } from "../server.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

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
});
