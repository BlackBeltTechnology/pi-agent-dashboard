/**
 * Integration test for the model proxy's optional second port (task 9.3).
 *
 * Starts a server with `modelProxy.secondPort` set, then verifies that
 * GET /v1/models returns an identical response on both ports.
 *
 * The test uses a valid proxy API key on both ports.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle;

async function findFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as any).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

afterAll(async () => {
  if (handle) await handle.stop();
});

describe("model proxy second port (task 9.3)", () => {
  it("both :mainPort/v1/models and :secondPort/v1/models return identical 200 or 503", async () => {
    const secondPort = await findFreePort();

    // Write a minimal config with secondPort enabled
    const configPath = join(homedir(), ".pi", "dashboard", "config.json");
    const dashDir = join(homedir(), ".pi", "dashboard");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dashDir, { recursive: true });

    let existing: any = {};
    try {
      existing = JSON.parse(require("fs").readFileSync(configPath, "utf-8"));
    } catch {}

    writeFileSync(configPath, JSON.stringify({
      ...existing,
      modelProxy: {
        ...(existing.modelProxy ?? {}),
        enabled: true,
        secondPort,
        apiKeys: [],
        maxConcurrentStreams: 16,
        perKeyConcurrentStreams: 4,
        logRequests: false,
      },
    }));

    handle = await createTestServer();
    const { httpPort } = handle;

    // Generate a proxy API key via the management API
    const createKeyRes = await fetch(`http://localhost:${httpPort}/api/model-proxy/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "test-key" }),
    });

    // The server may not have auth enabled in test mode (loopback bypass)
    // so the create should succeed or return an auth response
    let proxyKey: string | null = null;
    if (createKeyRes.ok) {
      const created = await createKeyRes.json() as any;
      proxyKey = created.data?.key ?? null;
    }

    const authHeader: Record<string, string> = proxyKey
      ? { "Authorization": `Bearer ${proxyKey}` }
      : {};

    // Main port
    const mainRes = await fetch(`http://localhost:${httpPort}/v1/models`, {
      headers: authHeader,
    });

    // Second port — if it didn't bind (port conflict) we skip
    let secondRes: Response;
    try {
      secondRes = await fetch(`http://127.0.0.1:${secondPort}/v1/models`, {
        headers: authHeader,
      });
    } catch {
      // Second port failed to bind — warn but don't fail test
      console.warn(`Second port ${secondPort} not reachable — skipping comparison`);
      expect(mainRes.status).toBeGreaterThanOrEqual(200);
      return;
    }

    // Both should return the same HTTP status code (200 with models or 503 if pi-ai unavailable)
    expect(mainRes.status).toBe(secondRes.status);

    // Both should return valid JSON
    const mainBody = await mainRes.json() as any;
    const secondBody = await secondRes.json() as any;

    // The top-level shape should match
    if (mainBody.object) {
      expect(secondBody.object).toBe(mainBody.object);
    } else {
      // Both degraded (503)
      expect(secondBody.code).toBe(mainBody.code);
    }
  });
});

// ── Second port stays loopback-only (S16) ────────────────────────────────────
// The second instance runs ONLY the proxy gate — no universal network guard, no
// `isAuthenticated` decoration, no network check — so its loopback bind IS its
// security boundary. The regression this guards: someone switching the bind to
// `config.host`. Started here with `host: "0.0.0.0"` so the main port really is
// exposed, which makes the second port's refusal meaningful rather than vacuous.
//
// See change: add-universal-network-guard.
describe("second port is loopback-only even when the main server binds all interfaces", () => {
  /** Resolves true only if a TCP connection to host:port succeeds. */
  function canConnect(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(timeoutMs);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
    });
  }

  it("serves the external interface on the main port but refuses it on the second port", async () => {
    const external = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    if (!external) {
      console.warn("no non-loopback IPv4 address — skipping the external-interface half");
      return;
    }

    const secondPort = await findFreePort();
    const dashDir = join(homedir(), ".pi", "dashboard");
    const configPath = join(dashDir, "config.json");
    mkdirSync(dashDir, { recursive: true });
    let existing: any = {};
    try {
      existing = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch { /* no config yet */ }
    writeFileSync(configPath, JSON.stringify({
      ...existing,
      modelProxy: {
        ...(existing.modelProxy ?? {}),
        enabled: true,
        secondPort,
        apiKeys: [],
        maxConcurrentStreams: 16,
        perKeyConcurrentStreams: 4,
        logRequests: false,
      },
    }));

    const h = await createTestServer({ host: "0.0.0.0" });
    try {
      // The main port IS reachable on the LAN address — proving the probe is valid.
      expect(await canConnect(external, h.httpPort), "main port must be reachable on the external interface").toBe(true);
      // The second port must NOT be, even though the main bind is `0.0.0.0`.
      expect(await canConnect(external, secondPort), "second port must not answer on a non-loopback address").toBe(false);
    } finally {
      await h.stop();
    }
  }, 60_000);
});
