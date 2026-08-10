/**
 * Route-level coverage for `DELETE /api/config/auth/providers/:id` (D9).
 *
 * The helper-level contract (raw read/write, secret preservation, idempotence,
 * last-provider refusal) lives in `config-api.test.ts`; this file pins the
 * HTTP surface: the guard, the status codes, the reload side effect, and the
 * lockout state a forced delete actually produces.
 *
 * Test plan rows: G8, G10, G11, G12, S9.
 * Change: config-override-oauth-redirect-base.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { registerAuthPlugin } from "../auth/auth-plugin.js";
import { registerSystemRoutes } from "../routes/system-routes.js";

const TWO_PROVIDERS = {
  port: 8000,
  auth: {
    secret: "test-secret-32-chars-long-abcdef",
    providers: {
      github: { clientId: "gh", clientSecret: "gh-real" },
      google: { clientId: "goo", clientSecret: "goo-real" },
    },
  },
};

let testDir: string;
let configFile: string;
let origHome: string;

function writeConfig(value: unknown) {
  fs.writeFileSync(configFile, JSON.stringify(value));
}

function readConfig(): any {
  return JSON.parse(fs.readFileSync(configFile, "utf-8"));
}

/** Minimal system-routes host. `allow` false = the guard rejects like PUT does. */
function makeApp(opts: { allow?: boolean } = {}): { app: FastifyInstance; reloads: AuthConfig[] } {
  const app = Fastify();
  const reloads: AuthConfig[] = [];
  (app as any)._reloadAuth = async (cfg: AuthConfig) => {
    reloads.push(cfg);
  };
  registerSystemRoutes(app, {
    sessionManager: {} as never,
    preferencesStore: { flush: () => {} } as never,
    metaPersistence: { flushAll: () => {} } as never,
    config: { port: 8000, piPort: 9999, dev: false } as never,
    networkGuard:
      opts.allow === false
        ? (async (_req: any, reply: any) => reply.code(403).send({ error: "forbidden" })) as never
        : (async () => {}) as never,
  } as never);
  return { app, reloads };
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-provider-delete-"));
  fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
  configFile = path.join(testDir, ".pi", "dashboard", "config.json");
  origHome = process.env.HOME!;
  process.env.HOME = testDir;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("DELETE /api/config/auth/providers/:id", () => {
  // #G8
  it("removes the provider and triggers an auth reload", async () => {
    writeConfig(TWO_PROVIDERS);
    const { app, reloads } = makeApp();
    const res = await app.inject({ method: "DELETE", url: "/api/config/auth/providers/github" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ deleted: true, remaining: 1 });
    expect(Object.keys(readConfig().auth.providers)).toEqual(["google"]);
    expect(reloads).toHaveLength(1);
    expect(Object.keys(reloads[0].providers)).toEqual(["google"]);
    await app.close();
  });

  // #G10 — idempotent, and no reload for a no-op.
  it("succeeds with no side effect for an absent provider", async () => {
    writeConfig(TWO_PROVIDERS);
    const before = fs.readFileSync(configFile, "utf-8");
    const { app, reloads } = makeApp();
    const res = await app.inject({ method: "DELETE", url: "/api/config/auth/providers/keycloak" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ deleted: false, remaining: 2 });
    expect(fs.readFileSync(configFile, "utf-8")).toBe(before);
    expect(reloads).toHaveLength(0);
    await app.close();
  });

  // #G11
  it("refuses the last provider without force and states the lockout", async () => {
    writeConfig({ auth: { providers: { github: { clientId: "gh", clientSecret: "s" } } } });
    const { app } = makeApp();
    const res = await app.inject({ method: "DELETE", url: "/api/config/auth/providers/github" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/lock out|does NOT disable auth/i);
    expect(res.json().error).toMatch(/force=true/);
    expect(Object.keys(readConfig().auth.providers)).toEqual(["github"]);
    await app.close();
  });

  it("deletes the last provider with ?force=true", async () => {
    writeConfig({ auth: { providers: { github: { clientId: "gh", clientSecret: "s" } } } });
    const { app } = makeApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/config/auth/providers/github?force=true",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ deleted: true, remaining: 0 });
    expect(readConfig().auth.providers).toEqual({});
    await app.close();
  });

  // #S9 — the destructive verb sits behind the SAME guard as PUT /api/config.
  it("is rejected by the network guard exactly like PUT /api/config", async () => {
    writeConfig(TWO_PROVIDERS);
    const { app } = makeApp({ allow: false });
    const del = await app.inject({ method: "DELETE", url: "/api/config/auth/providers/github" });
    const put = await app.inject({ method: "PUT", url: "/api/config", payload: { port: 8000 } });
    expect(del.statusCode).toBe(403);
    expect(put.statusCode).toBe(403);
    // Nothing was written.
    expect(Object.keys(readConfig().auth.providers)).toEqual(["github", "google"]);
    await app.close();
  });
});

// #G12 — the state a forced delete leaves behind. Deleting down to zero at
// runtime is NOT "auth disabled": the onRequest gate was installed at boot and
// nothing removes it, so every request is still refused while /auth/login has
// no provider to offer. This is the reason the route refuses by default.
describe("G12: force-deleting the last provider leaves auth enforced", () => {
  it("still refuses a gated request and offers no login option", async () => {
    const app = Fastify();
    const authConfig: AuthConfig = {
      secret: "test-secret-32-chars-long-abcdef",
      providers: { github: { clientId: "cid", clientSecret: "csecret" } },
    };
    await registerAuthPlugin(app, { authConfig, port: 8000 });
    // A real gated route, so the assertion cannot pass on a 404 instead.
    app.get("/api/sessions", async () => ({ success: true }));
    await app.ready();

    // A non-loopback peer: a genuinely-local request is exempt by design.
    const REMOTE = "203.0.113.7";

    // Sanity: the gate is live before the delete.
    const before = await app.inject({ method: "GET", url: "/api/sessions", remoteAddress: REMOTE });
    expect(before.statusCode).toBe(401);

    await (app as any)._reloadAuth({ ...authConfig, providers: {} } satisfies AuthConfig);

    const after = await app.inject({ method: "GET", url: "/api/sessions", remoteAddress: REMOTE });
    expect(after.statusCode).toBe(401);

    const login = await app.inject({
      method: "GET",
      url: "/auth/login",
      remoteAddress: REMOTE,
      headers: { accept: "text/html" },
    });
    // No auto-redirect (that needs exactly one provider) and no provider button.
    expect(login.statusCode).toBe(200);
    expect(login.body).not.toMatch(/\/auth\/start\//);
    await app.close();
  });
});

// ── Diagnostics: which redirect base actually won (D10) ─────────────────────
// Test plan rows: S3, S4, S5.
describe("GET /api/auth/diagnostics", () => {
  it("S3: is refused by the guard for an unauthenticated non-loopback caller", async () => {
    writeConfig(TWO_PROVIDERS);
    const { app } = makeApp({ allow: false });
    const res = await app.inject({ method: "GET", url: "/api/auth/diagnostics" });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("S4: reports the resolved base and the winning tier over loopback", async () => {
    writeConfig({
      ...TWO_PROVIDERS,
      auth: { ...TWO_PROVIDERS.auth, redirectBaseUrl: "https://pi.example.com/" },
    });
    const { app } = makeApp();
    (app as any)._reloadAuth = async () => {};
    const res = await app.inject({ method: "GET", url: "/api/auth/diagnostics" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      // Trailing slash stripped — the same normalization the minted URI gets.
      redirectBase: "https://pi.example.com",
      source: "auth.redirectBaseUrl",
      authActive: true,
      providerCount: 2,
    });
    await app.close();
  });

  it("S4: names the localhost tier when nothing overrides it", async () => {
    writeConfig(TWO_PROVIDERS);
    const { app } = makeApp();
    (app as any)._reloadAuth = async () => {};
    expect(await app.inject({ method: "GET", url: "/api/auth/diagnostics" }).then((r) => r.json().data))
      .toMatchObject({ redirectBase: "http://localhost:8000", source: "localhost" });
    await app.close();
  });

  // #S5 — the D6 boot state: no /auth/* route, no _reloadAuth. Reporting a
  // live-looking value there would be boot-frozen and misleading.
  it("S5: reports authActive:false when the plugin never installed a reload hook", async () => {
    writeConfig({ port: 8000 });
    const { app } = makeApp();
    delete (app as any)._reloadAuth;
    const res = await app.inject({ method: "GET", url: "/api/auth/diagnostics" });
    expect(res.json().data).toMatchObject({ authActive: false, providerCount: 0 });
    await app.close();
  });
});
