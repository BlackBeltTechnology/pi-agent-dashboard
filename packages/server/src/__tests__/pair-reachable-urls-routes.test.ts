/**
 * E28 (test-plan expand-mcp-tiered-surface) — `GET /api/pair/reachable-urls`.
 *
 * Merges the public URLs the pairing payload already exposes (tunnel +
 * configured public) with this host's loopback + LAN endpoints, deduped, so a
 * `claude mcp add` snippet minted in Settings works from the machine that will
 * run the agent. See change: expand-mcp-tiered-surface (D8).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the host endpoint enumeration so the assertion is deterministic.
vi.mock("../tunnel/tunnel-endpoints.js", () => ({
  localEndpoints: vi.fn(() => [
    { kind: "local", url: "http://localhost:8000", tls: false },
    { kind: "lan", url: "http://192.168.1.4:8000", tls: false },
  ]),
}));

import { createNetworkGuard } from "../auth/localhost-guard.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { registerPairingRoutes } from "../routes/pairing-routes.js";

let tmpDir: string;
const openApps: FastifyInstance[] = [];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pair-urls-"));
});

afterEach(() => {
  for (const app of openApps.splice(0)) void app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function mkApp(getReachableUrls: () => string[]): Promise<FastifyInstance> {
  const app = Fastify();
  openApps.push(app);
  registerPairingRoutes(app, {
    networkGuard: createNetworkGuard([]),
    identity: {} as never,
    pairing: { reachableUrls: getReachableUrls } as never,
    registry: new PairedDeviceRegistry(path.join(tmpDir, "paired.json")),
    hostAdmission: () => ({
      allowedHosts: [],
      publicBaseUrls: [],
      configuredOrigins: [],
      getLiveTunnelOrigins: () => [],
      bindHost: "localhost",
    }),
    getReachableUrls,
    getPort: () => 8000,
  });
  await app.ready();
  return app;
}

describe("E28 — reachable-urls merge", () => {
  it("lists the public tunnel first, then loopback + LAN, deduped", async () => {
    const app = await mkApp(() => ["https://x.share.zrok.io"]);
    const res = await app.inject({
      method: "GET",
      url: "/api/pair/reachable-urls",
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([
      "https://x.share.zrok.io",
      "http://localhost:8000",
      "http://192.168.1.4:8000",
    ]);
  });

  it("drops duplicates between the public list and the local list", async () => {
    const app = await mkApp(() => ["https://x.share.zrok.io", "http://localhost:8000"]);
    const res = await app.inject({
      method: "GET",
      url: "/api/pair/reachable-urls",
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as string[];
    expect(data.filter((u) => u === "http://localhost:8000")).toHaveLength(1);
    expect(data).toHaveLength(3);
  });

  it("strips a trailing slash", async () => {
    const app = await mkApp(() => ["https://x.share.zrok.io/"]);
    const res = await app.inject({
      method: "GET",
      url: "/api/pair/reachable-urls",
      remoteAddress: "127.0.0.1",
    });
    expect(res.json().data[0]).toBe("https://x.share.zrok.io");
  });
});
