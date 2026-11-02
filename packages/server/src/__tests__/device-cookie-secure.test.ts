/**
 * B16r — one `isSecureOrigin` predicate across three cookies (AE19), the device-cookie
 * LAN-exchange peer boundary (AE20) and the forwarding-header carve-out skip (AE79).
 * See change: harden-auth-credentials (D3, A-G21).
 *
 * WHY A SEPARATE FILE FROM `device-cookie.test.ts`: AE19 needs a live-tunnel stub
 * (`vi.mock("../tunnel/tunnel.js")`, file-scoped) plus the OAuth plugin; keeping it out of
 * `device-cookie.test.ts` leaves that file's mock-free cases untouched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tunnel = { urls: [] as string[] };
vi.mock("../tunnel/tunnel.js", async (orig) => ({
  ...(await orig<typeof import("../tunnel/tunnel.js")>()),
  getTunnelUrl: () => tunnel.urls[0] ?? null,
  liveTunnelOrigins: () => tunnel.urls,
}));

const exchange = vi.fn(async () => ({ accessToken: "access-token" }));
vi.mock("../auth/auth.js", async (orig) => ({
  ...(await orig<typeof import("../auth/auth.js")>()),
  exchangeCode: (...a: unknown[]) => (exchange as any)(...a),
  fetchUserInfo: async () => ({ email: "u@example.com", name: "U", username: "u" }),
}));

import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { resolveRedirectBase } from "../auth/auth.js";
import { registerAuthPlugin } from "../auth/auth-plugin.js";
import { DEVICE_COOKIE, registerBearerAuth, registerDeviceSessionRoutes } from "../auth/bearer-auth.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";

const SECRET = "test-secret-32-chars-long-abcdef";
const PORT = 8000;

let tmp: string;
let app: FastifyInstance | null = null;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devcookie-secure-"));
});
afterEach(async () => {
  await app?.close();
  app = null;
  tunnel.urls = [];
  fs.rmSync(tmp, { recursive: true, force: true });
});

const cookiesOf = (res: { headers: Record<string, unknown> }) =>
  ([] as string[]).concat((res.headers["set-cookie"] as string[] | string | undefined) ?? []);
const find = (res: { headers: Record<string, unknown> }, name: string) => cookiesOf(res).find((c) => c.startsWith(`${name}=`));
const secure = (c: string | undefined) => /;\s*Secure/i.test(c ?? "");

/** The same wiring server.ts uses: `isSecure` = resolved base is https. */
async function makeApp(base: string, withOAuth: boolean) {
  const a = Fastify();
  await a.register(fastifyCookie);
  a.decorateRequest("isAuthenticated", false);
  const registry = new PairedDeviceRegistry(path.join(tmp, "paired.json"));
  registerBearerAuth(a, { registry });
  registerDeviceSessionRoutes(a, {
    registry,
    isSecure: () => resolveRedirectBase(PORT, base).base.startsWith("https:"),
  });
  if (withOAuth) {
    await registerAuthPlugin(a, {
      authConfig: { secret: SECRET, providers: { github: { clientId: "cid", clientSecret: "cs" } }, allowedUsers: ["*@example.com"], redirectBaseUrl: base } as AuthConfig,
      port: PORT,
    });
  }
  await a.ready();
  app = a;
  return { a, registry };
}

async function deviceCookie(a: FastifyInstance, registry: PairedDeviceRegistry, peer: string, headers: Record<string, string> = {}) {
  const d = registry.add("d", "pairing", "operate");
  const res = await a.inject({
    method: "POST",
    url: "/api/device-session",
    remoteAddress: peer,
    headers: { authorization: `Bearer ${d.token}`, ...headers },
  });
  expect(res.statusCode).toBe(200);
  return find(res, DEVICE_COOKIE);
}

async function threeCookies(a: FastifyInstance, registry: PairedDeviceRegistry, peer: string, headers: Record<string, string>) {
  const start = await a.inject({ method: "GET", url: "/auth/start/github", remoteAddress: peer, headers });
  const state = new URL(start.headers.location as string).searchParams.get("state")!;
  const stateCookie = find(start, "pi_dash_oauth_state");
  const cb = await a.inject({
    method: "GET",
    url: `/auth/callback/github?code=c&state=${state}`,
    remoteAddress: peer,
    headers: { ...headers, cookie: stateCookie!.split(";")[0]! },
  });
  return { stateCookie, tokenCookie: find(cb, "pi_dash_token"), deviceCookie: await deviceCookie(a, registry, peer, headers) };
}

describe("AE19 one predicate, three cookies", () => {
  it("S1 live https tunnel + loopback peer + tunnel Host (http base) → all three cookies Secure", async () => {
    tunnel.urls = ["https://pi.share.example"];
    const { a, registry } = await makeApp("http://pi.internal", true);
    const c = await threeCookies(a, registry, "127.0.0.1", { host: "pi.share.example" });
    expect(secure(c.stateCookie)).toBe(true);
    expect(secure(c.tokenCookie)).toBe(true);
    expect(secure(c.deviceCookie)).toBe(true);
  });

  it("S2 https base, no tunnel, direct plain-http LAN peer → state + token Secure, device cookie NOT (LAN carve-out)", async () => {
    const { a, registry } = await makeApp("https://pi-robson.share.zrok.io", true);
    const c = await threeCookies(a, registry, "192.168.16.31", {});
    expect(c.tokenCookie).toBeDefined();
    expect(secure(c.stateCookie)).toBe(true);
    expect(secure(c.tokenCookie)).toBe(true);
    expect(secure(c.deviceCookie)).toBe(false);
  });
});

describe("AE20 device cookie LAN carve-out — peer boundary", () => {
  it.each([
    ["127.0.0.1", true],
    ["126.255.255.255", false],
    ["128.0.0.1", false],
    ["192.168.16.204", false],
    ["::ffff:127.0.0.1", true],
    ["::ffff:192.168.16.31", false],
  ])("https base, direct plain http from %s → Secure=%s", async (peer, want) => {
    const { a, registry } = await makeApp("https://pi-robson.share.zrok.io", false);
    expect(secure(await deviceCookie(a, registry, peer))).toBe(want);
  });
});

describe("AE79 the carve-out is skipped when forwarding headers are present", () => {
  it.each([
    ["(a) LAN peer, no forwarding header", "192.168.16.31", {}, false],
    ["(b) peer 172.17.0.2 + X-Forwarded-Proto: https", "172.17.0.2", { "x-forwarded-proto": "https" }, true],
    ["(c) LAN peer + X-Forwarded-For", "192.168.16.31", { "x-forwarded-for": "198.51.100.4" }, true],
    ["(d) LAN peer + Forwarded: proto=https", "192.168.16.31", { forwarded: "proto=https" }, true],
  ])("https base %s → Secure=%s", async (_n, peer, headers, want) => {
    const { a, registry } = await makeApp("https://pi-robson.share.zrok.io", false);
    expect(secure(await deviceCookie(a, registry, peer, headers as Record<string, string>))).toBe(want);
  });
});
