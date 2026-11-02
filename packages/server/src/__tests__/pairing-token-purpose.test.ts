import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { registerPairingRoutes } from "../routes/pairing-routes.js";
import { stampLegacyHook } from "../test-support/local-credential-stamp.js";
import { simulateTlsSocket, TEST_TLS_HEADER } from "./helpers/channel-fixture.js";

const LOCAL_TOKEN = "purpose-token-0123456789abcdefghijklmnopqrstuvwxyz";
const HTTPS_URL = "https://dash.example.ts.net:8443";
let tmpDir: string;
let app: FastifyInstance;
let reg: PairedDeviceRegistry;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-purpose-"));
  reg = new PairedDeviceRegistry(path.join(tmpDir, "paired.json"));
  app = Fastify();
  simulateTlsSocket(app);
  stampLegacyHook(app, LOCAL_TOKEN);
  registerPairingRoutes(app, {
    networkGuard: createNetworkGuard([], { localToken: LOCAL_TOKEN }),
    identity: {} as never,
    pairing: {} as never,
    registry: reg,
    localToken: LOCAL_TOKEN,
    getTlsListenerUrls: () => [HTTPS_URL],
    hostAdmission: () => ({
      allowedHosts: [],
      publicBaseUrls: [],
      configuredOrigins: [],
      getLiveTunnelOrigins: () => [],
      bindHost: "localhost",
    }),
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const mint = (body: Record<string, unknown>, channel: "tls" | "plain") =>
  app.inject({
    method: "POST",
    url: "/api/paired-devices",
    remoteAddress: channel === "tls" ? "127.0.0.1" : "192.168.1.10",
    headers: { "content-type": "application/json", "x-pi-local-token": LOCAL_TOKEN, ...(channel === "tls" ? { [TEST_TLS_HEADER]: "1" } : {}) },
    payload: body,
  });

describe("operator mint: purpose × channel (test-plan #E5)", () => {
  it("bridge + TLS → pi_tls_ token, tier operate, unexposed", async () => {
    const res = await mint({ label: "remote", purpose: "bridge" }, "tls");
    expect(res.statusCode).toBe(200);
    const { token, device } = res.json().data;
    expect(token).toMatch(/^pi_tls_/);
    expect(device.tier).toBe("operate");
    expect(reg.deviceTrust(device.id)).toBe("eligible");
  });

  it("bridge + plain LAN → 403 bridge_token_requires_https with the HTTPS address, no row", async () => {
    const res = await mint({ label: "remote", purpose: "bridge" }, "plain");
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ success: false, error: "bridge_token_requires_https", httpsUrl: HTTPS_URL });
    expect(reg.list()).toHaveLength(0);
  });

  it("no purpose + TLS → plain token, unexposed", async () => {
    const res = await mint({ label: "mcp", tier: "observe" }, "tls");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.token).not.toMatch(/^pi_tls_/);
    expect(reg.deviceTrust(res.json().data.device.id)).toBe("eligible");
  });

  it("no purpose + plain → plain token, born exposed", async () => {
    const res = await mint({ label: "mcp" }, "plain");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.token).not.toMatch(/^pi_tls_/);
    expect(reg.deviceTrust(res.json().data.device.id)).toBe("exposed");
  });

  it.each([
    ["other purpose", { label: "x", purpose: "other" }],
    ["bridge with tier observe", { label: "x", purpose: "bridge", tier: "observe" }],
  ])("%s → 400, no row", async (_name, body) => {
    const res = await mint(body, "tls");
    expect(res.statusCode).toBe(400);
    expect(reg.list()).toHaveLength(0);
  });
});
