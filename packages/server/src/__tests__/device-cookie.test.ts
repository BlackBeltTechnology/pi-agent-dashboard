/**
 * Device bearer → httpOnly cookie exchange (B4). See change:
 * harden-trust-and-credential-boundaries (D5; T-E31..E35, X8, X13).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEVICE_COOKIE, registerBearerAuth, registerDeviceSessionRoutes } from "../auth/bearer-auth.js";
import { createNetworkGuardHook } from "../auth/localhost-guard.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";

let tmp: string;
let reg: PairedDeviceRegistry;
let app: FastifyInstance;
const REMOTE = "203.0.113.9";

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devcookie-"));
  reg = new PairedDeviceRegistry(path.join(tmp, "paired.json"));
  app = Fastify();
  await app.register(fastifyCookie);
  app.decorateRequest("isAuthenticated", false);
  registerBearerAuth(app, { registry: reg });
  registerDeviceSessionRoutes(app, { registry: reg, isSecure: () => false });
  app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [] }));
  app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: [] }));
  app.get("/api/sessions", async (r) => ({ id: (r as any).principalDeviceId ?? null, via: (r as any).authVia ?? null }));
  app.post("/api/restart", async () => ({ ok: true }));
  app.get("/mcp", async (r) => ({ authed: (r as any).isAuthenticated === true }));
  await app.ready();
});
afterEach(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const req = (method: "GET" | "POST" | "DELETE", url: string, headers: Record<string, string> = {}) =>
  app.inject({ method, url, remoteAddress: REMOTE, headers });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const cookie = (t: string) => ({ cookie: `${DEVICE_COOKIE}=${t}` });
const setCookie = (res: { headers: Record<string, unknown> }) =>
  ([] as string[]).concat((res.headers["set-cookie"] as string[] | string | undefined) ?? []).find((c) => c.startsWith(`${DEVICE_COOKIE}=`));

describe("exchange route (E31)", () => {
  it.each(["observe", "operate"] as const)("a %s device gets the cookie", async (tier) => {
    const d = reg.add("d", tier);
    const res = await req("POST", "/api/device-session", bearer(d.token));
    expect(res.statusCode).toBe(200);
    const c = setCookie(res)!;
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).toMatch(/Path=\/api\//);
    expect(c).toMatch(/Max-Age=34560000/);
  });
  it("no bearer → 401", async () => {
    // From loopback the guard admits, so the handler's own 401 is observable
    // (a remote caller is stopped earlier by the network guard, 403).
    const res = await app.inject({ method: "POST", url: "/api/device-session", remoteAddress: "127.0.0.1" });
    expect(res.statusCode).toBe(401);
    expect((await req("POST", "/api/device-session")).statusCode).toBe(403);
  });
  it("cookie alone cannot mint another cookie", async () => {
    const d = reg.add("d");
    const res = await req("POST", "/api/device-session", cookie(d.token));
    expect(res.statusCode).toBe(401);
    expect(setCookie(res)).toBeUndefined();
  });
});

describe("cookie admission (E32, E33, E34, X8, X13)", () => {
  it("E32/X8 cookie-only observe device: GET ok as device; operate route insufficient_scope", async () => {
    const d = reg.add("d", "observe");
    const ok = await req("GET", "/api/sessions", cookie(d.token));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ id: d.device.id, via: "device" });
    const no = await req("POST", "/api/restart", cookie(d.token));
    expect(no.statusCode).toBe(403);
    expect(no.json().error).toBe("insufficient_scope");
  });
  it("X8 no cookie → unchanged denial", async () => {
    expect((await req("GET", "/api/sessions")).statusCode).toBe(403);
  });
  it("E33 cookie is not used outside /api/", async () => {
    const d = reg.add("d");
    const res = await req("GET", "/mcp", cookie(d.token));
    expect(res.json().authed).toBe(false);
  });
  it("E34 Authorization header wins over the cookie", async () => {
    const a = reg.add("A");
    const b = reg.add("B");
    const res = await req("GET", "/api/sessions", { ...bearer(a.token), ...cookie(b.token) });
    expect(res.json().id).toBe(a.device.id);
  });
  it("X13 revoked device's cookie → denied", async () => {
    const d = reg.add("d");
    expect((await req("GET", "/api/sessions", cookie(d.token))).statusCode).toBe(200);
    reg.revoke(d.device.id);
    expect((await req("GET", "/api/sessions", cookie(d.token))).statusCode).toBe(403);
  });
});

describe("logout (E35)", () => {
  it("DELETE clears the cookie at Path=/api/", async () => {
    const d = reg.add("d");
    const res = await req("DELETE", "/api/device-session", cookie(d.token));
    const c = setCookie(res)!;
    expect(c).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    expect(c).toMatch(/Path=\/api\//);
  });
});
