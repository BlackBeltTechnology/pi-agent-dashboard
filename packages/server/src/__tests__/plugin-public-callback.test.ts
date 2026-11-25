/**
 * The plugin OAuth return endpoint is reachable without a dashboard session, but ONLY it, ONLY by GET and
 * only as the exact path (both views of the target). Covers the dashboard login gate and the universal
 * network guard. See change: add-google-connect (D12b).
 */
import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerAuthPlugin } from "../auth/auth-plugin.js";
import { createNetworkGuardHook, PUBLIC_PLUGIN_CALLBACK_PATHS } from "../auth/localhost-guard.js";

const REMOTE = "203.0.113.5";
const CB = "/api/plugins/google/oauth/remote-callback";

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

describe("PUBLIC_PLUGIN_CALLBACK_PATHS", () => {
  it("holds exactly the Google remote callback — no prefixes, no wildcard", () => {
    expect([...PUBLIC_PLUGIN_CALLBACK_PATHS]).toEqual([CB]);
  });
});

describe("dashboard login gate", () => {
  async function makeApp() {
    const a = Fastify();
    await registerAuthPlugin(a, {
      authConfig: { secret: "test-secret-32-chars-long-abcdef", providers: { github: { clientId: "cid", clientSecret: "cs" } }, allowedUsers: ["*@example.com"] } as AuthConfig,
      port: 8000,
    });
    for (const url of [CB, "/api/plugins/google/oauth/callback", "/api/plugins/google/accounts"]) a.all(url, async () => ({ reached: true }));
    await a.ready();
    return a;
  }
  it("lets a sessionless remote GET reach the remote callback", async () => {
    app = await makeApp();
    const r = await app.inject({ method: "GET", url: `${CB}?code=C&state=S`, remoteAddress: REMOTE, headers: { accept: "application/json" } });
    expect(r.statusCode).toBe(200);
  });
  it("still gates everything else: other methods, the own-Web callback, and sibling routes", async () => {
    app = await makeApp();
    const gated = async (method: "GET" | "POST", url: string) =>
      (await app!.inject({ method, url, remoteAddress: REMOTE, headers: { accept: "application/json" } })).statusCode;
    expect(await gated("POST", CB)).toBe(401);
    expect(await gated("GET", "/api/plugins/google/oauth/callback")).toBe(401);
    expect(await gated("GET", "/api/plugins/google/accounts")).toBe(401);
    expect(await gated("GET", `${CB}/../accounts`)).toBe(401);
  });
});

describe("universal network guard", () => {
  async function makeApp() {
    const a = Fastify();
    a.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: [] }));
    for (const url of [CB, "/api/plugins/google/accounts"]) a.all(url, async () => ({ reached: true }));
    await a.ready();
    return a;
  }
  it("admits the callback from an untrusted network (GET/HEAD), nothing else", async () => {
    app = await makeApp();
    const code = async (method: "GET" | "HEAD" | "POST", url: string) => (await app!.inject({ method, url, remoteAddress: REMOTE })).statusCode;
    expect(await code("GET", `${CB}?code=C&state=S`)).toBe(200);
    expect(await code("POST", CB)).toBe(403);
    expect(await code("GET", "/api/plugins/google/accounts")).toBe(403);
    expect(await code("GET", `${CB}/../accounts`)).toBe(403);
  });
});
