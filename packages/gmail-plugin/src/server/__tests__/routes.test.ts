/**
 * L1 route tests for the moved-route stubs (add-google-connect D10; test-plan B137, B138, B141, spec
 * "Gmail settings point to Google accounts"). Every management route of the pre-Google-Connect plugin answers
 * a fixed refusal and stores nothing: `410 {error:"moved"}` while Google Connect is usable, `503
 * {error:"google_connect_unavailable"}` while it is not. `GET /state` tells the settings section which notice
 * to show. The route tests that asserted the old behaviour (client upload, add account, revoke, level, alias,
 * filters, setup, sign-in logs) moved with that behaviour to `packages/google-plugin`.
 */
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT, memoryCredentials } from "../../__tests__/fakes.js";
import { CLIENT_KEY } from "../accounts.js";
import type { GoogleLink } from "../google-link.js";
import { mountGmailRoutes } from "../routes.js";

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

const link = (usable: boolean): GoogleLink & { ensure: ReturnType<typeof vi.fn> } => ({
  ensure: vi.fn(async () => ({ usable, delegating: usable })),
});

async function setup(usable: boolean, networkGuard: Parameters<typeof mountGmailRoutes>[1]["networkGuard"] = async () => {}) {
  const creds = memoryCredentials({ [CLIENT_KEY]: { ...CLIENT }, "acct:s1": { sub: "s1", email: "a@x.com", refresh: "RT" } });
  const before = JSON.stringify(await creds.snapshot());
  const l = link(usable);
  const app = Fastify();
  apps.push(app);
  await mountGmailRoutes(app, { networkGuard, link: l });
  return { app, creds, before, link: l, unchanged: async () => JSON.stringify(await creds.snapshot()) === before };
}

/** Every management route of the pre-migration plugin (method + path) — the whole moved surface. */
const MANAGEMENT: Array<[string, string, unknown?]> = [
  ["PUT", "/api/plugins/gmail/client", { clientId: "x.apps.googleusercontent.com", clientSecret: "S" }],
  ["PUT", "/api/plugins/gmail/setup", { projectId: "p" }],
  ["GET", "/api/plugins/gmail/accounts"],
  ["POST", "/api/plugins/gmail/accounts", { tier: "readonly" }],
  ["PATCH", "/api/plugins/gmail/accounts/s1", { alias: "work" }],
  ["DELETE", "/api/plugins/gmail/accounts/s1"],
  ["POST", "/api/plugins/gmail/accounts/s1/level", { tier: "send" }],
  ["POST", "/api/plugins/gmail/accounts/s1/reauth", {}],
  ["POST", "/api/plugins/gmail/accounts/s1/filters", { enabled: true }],
  ["POST", "/api/plugins/gmail/setup/run", {}],
  ["GET", "/api/plugins/gmail/setup/run/r1"],
  ["POST", "/api/plugins/gmail/setup/run/r1/continue", {}],
  ["POST", "/api/plugins/gmail/setup/run/r1/takeover", {}],
  ["DELETE", "/api/plugins/gmail/setup/run/r1"],
];

describe("B137 — Google Connect usable: management routes answer 410 moved", () => {
  it.each(MANAGEMENT)("%s %s → 410 {error:'moved'}; the Gmail store is untouched", async (method, url, payload) => {
    const s = await setup(true);
    const res = await s.app.inject({ method: method as "GET", url, payload: payload as never });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ error: "moved" });
    expect(await s.unchanged()).toBe(true);
  });

  it("no body shape can make a moved route do work or echo its input", async () => {
    const s = await setup(true);
    const res = await s.app.inject({ method: "POST", url: "/api/plugins/gmail/accounts", payload: { tier: "readonly", email: "leak@x.com", clientSecret: "SECRET-leak" } });
    expect(res.statusCode).toBe(410);
    expect(res.body).not.toContain("leak");
    expect(await s.unchanged()).toBe(true);
  });
});

describe("B138 — Google Connect absent or disabled: management routes answer 503 google_connect_unavailable", () => {
  it.each(MANAGEMENT)("%s %s → 503 {error:'google_connect_unavailable'}; the Gmail store is untouched", async (method, url, payload) => {
    const s = await setup(false);
    const res = await s.app.inject({ method: method as "GET", url, payload: payload as never });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "google_connect_unavailable" });
    expect(await s.unchanged()).toBe(true);
  });
});

describe("GET /state — which notice the settings section shows", () => {
  it("usable → {moved:true}", async () => {
    const s = await setup(true);
    const res = await s.app.inject({ method: "GET", url: "/api/plugins/gmail/state" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ moved: true });
  });
  it("not usable → {moved:false, googleConnect:'unavailable'}", async () => {
    const s = await setup(false);
    const res = await s.app.inject({ method: "GET", url: "/api/plugins/gmail/state" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ moved: false, googleConnect: "unavailable" });
  });
  it("carries no account, client or token data", async () => {
    const s = await setup(true);
    const res = await s.app.inject({ method: "GET", url: "/api/plugins/gmail/state" });
    expect(res.body).not.toMatch(/RT|SECRET|a@x\.com|clientId/);
  });
});

describe("B141 — only account / client / setup routes are moved", () => {
  it("an unrelated path under the plugin prefix is not turned into a 410", async () => {
    const s = await setup(true);
    const res = await s.app.inject({ method: "GET", url: "/api/plugins/gmail/oauth/callback?code=c&state=s" });
    expect(res.statusCode).toBe(404);
  });
  it("GET /state is not a refusal even while accounts are moved", async () => {
    const s = await setup(true);
    expect((await s.app.inject({ method: "GET", url: "/api/plugins/gmail/state" })).statusCode).toBe(200);
  });
});

describe("management routes stay behind the network guard", () => {
  it("a refusing guard stops every moved route and /state before any answer is built", async () => {
    const guard = vi.fn(async (_req: unknown, reply: { code(n: number): { send(b: unknown): unknown } }) => {
      reply.code(403).send({ error: "forbidden" });
    });
    const s = await setup(true, guard as never);
    for (const [method, url, payload] of [...MANAGEMENT, ["GET", "/api/plugins/gmail/state"] as [string, string]]) {
      const res = await s.app.inject({ method: method as "GET", url, payload: payload as never });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    expect(s.link.ensure).not.toHaveBeenCalled();
  });
});
