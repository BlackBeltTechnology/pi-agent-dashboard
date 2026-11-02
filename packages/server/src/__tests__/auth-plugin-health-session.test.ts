/**
 * `/api/health` stays public, but a valid dashboard session cookie still marks
 * the caller authenticated there, so the health disclosure predicate
 * (`canDiscloseAccessPosture`: authenticated OR genuinely local) sees a signed-in
 * off-box browser. Before, the health skip ran BEFORE the cookie branch and a
 * signed-in remote operator got only `tls: {enabled, bound}`, which blanks the
 * Gateway "Built-in HTTPS" section (found by the add-acme-dns01-certs L3 specs).
 */
import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { signToken } from "../auth/auth.js";
import { registerAuthPlugin } from "../auth/auth-plugin.js";

const SECRET = "test-secret-32-chars-long-abcdef";
const REMOTE = "203.0.113.5";

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function makeApp(): Promise<FastifyInstance> {
  const a = Fastify();
  await registerAuthPlugin(a, {
    authConfig: { secret: SECRET, providers: { github: { clientId: "cid", clientSecret: "cs" } }, allowedUsers: ["*@example.com", "*@x"] } as AuthConfig,
    port: 8000,
  });
  a.get("/api/health", async (request) => ({
    authenticated: (request as { isAuthenticated?: boolean }).isAuthenticated === true,
    authVia: (request as { authVia?: string }).authVia ?? null,
  }));
  await a.ready();
  return a;
}

const cookie = `pi_dash_token=${signToken({ sub: "a@x", name: "A", username: "a", provider: "github" }, SECRET)}`;

describe("/api/health session tagging", () => {
  it("a valid session cookie marks a remote caller authenticated", async () => {
    app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/health", remoteAddress: REMOTE, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authenticated: true, authVia: "session" });
  });

  it("stays public: no cookie and a forged cookie both get 200, unauthenticated", async () => {
    app = await makeApp();
    for (const headers of [{}, { cookie: "pi_dash_token=forged.jwt.value" }]) {
      const res = await app.inject({ method: "GET", url: "/api/health", remoteAddress: REMOTE, headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ authenticated: false, authVia: null });
    }
  });
});
