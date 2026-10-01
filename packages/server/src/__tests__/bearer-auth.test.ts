import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COOKIE_NAME, signToken } from "../auth/auth.js";
import { validateWsUpgrade } from "../auth/auth-plugin.js";
import Fastify from "fastify";
import { parseBearerHeader, registerBearerAuth } from "../auth/bearer-auth.js";
import { createNetworkGuardHook } from "../auth/localhost-guard.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { WsTicketStore } from "../auth/ws-ticket.js";

const SECRET = "test-secret-for-bearer";
let tmpDir: string;
let reg: PairedDeviceRegistry;
let token: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bearer-"));
  reg = new PairedDeviceRegistry(path.join(tmpDir, "paired.json"));
  token = reg.add("dev").token;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("bearer header parsing", () => {
  it("extracts a Bearer token (case-insensitive), else null", () => {
    expect(parseBearerHeader("Bearer abc123")).toBe("abc123");
    expect(parseBearerHeader("bearer  xyz ")).toBe("xyz");
    expect(parseBearerHeader("Basic abc")).toBe(null);
    expect(parseBearerHeader(undefined)).toBe(null);
  });
});

describe("validateWsUpgrade — ticket branch is additive (Task 3.3/3.5)", () => {
  it("loopback still bypasses without any credential (unchanged)", () => {
    expect(validateWsUpgrade(undefined, "127.0.0.1", SECRET)).toBe(true);
    expect(validateWsUpgrade(undefined, "::1", SECRET)).toBe(true);
  });

  it("valid cookie still authorizes external requests (unchanged)", () => {
    const cookie = `${COOKIE_NAME}=${signToken({ sub: "u@e.com", name: "U", username: "u", provider: "github" }, SECRET)}`;
    expect(validateWsUpgrade(cookie, "1.2.3.4", SECRET)).toBe(true);
  });

  it("external request with NO credential is still rejected (unchanged)", () => {
    const store = new WsTicketStore();
    const consumeTicket = (t: string, s: any) => store.consume(t, s);
    expect(validateWsUpgrade(undefined, "1.2.3.4", SECRET, [], { scope: "browser", consumeTicket })).toBe(false);
  });

  it("valid single-use ticket authorizes an external request; durable bearer never rides WS", () => {
    const store = new WsTicketStore();
    const consumeTicket = (t: string, s: any) => store.consume(t, s);
    const ticket = store.mint("browser");
    expect(validateWsUpgrade(undefined, "1.2.3.4", SECRET, [], { ticket, scope: "browser", consumeTicket })).toBe(true);
    // Single-use: replaying the same ticket fails.
    expect(validateWsUpgrade(undefined, "1.2.3.4", SECRET, [], { ticket, scope: "browser", consumeTicket })).toBe(false);
  });

  it("a durable bearer token presented as a ticket is rejected", () => {
    const store = new WsTicketStore();
    const consumeTicket = (t: string, s: any) => store.consume(t, s);
    // token is a durable bearer, never minted as a ticket.
    expect(validateWsUpgrade(undefined, "1.2.3.4", SECRET, [], { ticket: token, scope: "browser", consumeTicket })).toBe(false);
  });
});

// test-plan #E7 — a paired device reaching the dashboard THROUGH a tunnel
// (relayed loopback) is admitted by its bearer, not by a loopback trusted
// entry; the device-tier gate is therefore still evaluated.
// See change: fix-trusted-network-tunnel-bypass.
describe("E7 paired device over a tunnel", () => {
  it("admits the relayed-loopback request on the bearer alone, with the tier gate live", async () => {
    const operate = reg.add("phone", "manual", "operate").token;
    const observe = reg.add("ro", "manual", "observe").token;
    const app = Fastify();
    app.decorateRequest("isAuthenticated", false);
    registerBearerAuth(app, { registry: reg });
    app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => ["127.0.0.1"], logRefusal: () => {} }));
    app.addHook(
      "onRequest",
      createNetworkGuardHook({ trustedNetworks: ["127.0.0.1"], logDenial: () => {} }),
    );
    app.get("/api/sessions", async (req) => ({ authVia: (req as any).authVia }));
    app.post("/api/restart", async () => ({ ok: true }));
    await app.ready();
    const relayed = { remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.9" } };
    try {
      const noCred = await app.inject({ method: "GET", url: "/api/sessions", ...relayed });
      expect(noCred.statusCode).toBe(403);

      const ok = await app.inject({
        method: "GET",
        url: "/api/sessions",
        remoteAddress: relayed.remoteAddress,
        headers: { ...relayed.headers, authorization: `Bearer ${operate}` },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ authVia: "device" });

      // Tier gate evaluated: the loopback entry no longer exempts the relay.
      const aboveTier = await app.inject({
        method: "POST",
        url: "/api/restart",
        remoteAddress: relayed.remoteAddress,
        headers: { ...relayed.headers, authorization: `Bearer ${observe}` },
      });
      expect(aboveTier.statusCode).toBe(403);
      expect(aboveTier.json()).toMatchObject({ error: "insufficient_scope" });
    } finally {
      await app.close();
    }
  });
});
