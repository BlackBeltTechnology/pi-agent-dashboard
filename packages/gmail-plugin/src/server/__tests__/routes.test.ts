/**
 * L1 route tests (test-plan E8, X5, E29 + tasks 2.3): parallel adds, level
 * lower/raise, alias, revoke (remote down), client upload, secret-free logs.
 * See change: add-gmail-plugin.
 */
import type {
  PluginOAuthCredential,
  PluginOAuthStartOptions,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT, capturingLogger, fakeGoogleFetch, memoryCredentials, TEST_ENDPOINTS } from "../../__tests__/fakes.js";
import { SCOPE } from "../../shared/scopes.js";
import { AccountStore, acctKey, CLIENT_KEY } from "../accounts.js";
import { mountGmailRoutes } from "../routes.js";

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

function account(sub: string, email: string, extra: Record<string, unknown> = {}) {
  return {
    sub,
    email,
    tier: "send",
    scopes: [SCOPE.modify],
    refresh: `REFRESH-${sub}`,
    access: `ACCESS-${sub}`,
    expires: Date.now() + 3_600_000,
    status: "ok",
    addedAt: 1,
    ...extra,
  };
}

async function setup(initial: Record<string, Record<string, unknown>> = {}, revokeStatus = 200) {
  const creds = memoryCredentials({ [CLIENT_KEY]: { ...CLIENT }, ...initial });
  const store = new AccountStore(creds);
  const started: PluginOAuthStartOptions[] = [];
  const oauth = {
    startFlow: vi.fn(async (o: PluginOAuthStartOptions) => {
      started.push(o);
      return { flowId: `flow-${started.length}` };
    }),
  };
  const google = fakeGoogleFetch({ revoke: () => revokeStatus });
  const logger = capturingLogger();
  const app = Fastify();
  apps.push(app);
  let n = 0;
  await mountGmailRoutes(app, {
    store,
    oauth,
    endpoints: TEST_ENDPOINTS,
    networkGuard: async () => {},
    logger,
    fetchImpl: google.fetchImpl,
    newId: () => `uuid${++n}`,
  });
  return { app, creds, store, started, oauth, google, logger };
}

const cred = (sub: string, email: string, extra: Record<string, unknown> = {}): PluginOAuthCredential => ({
  type: "oauth",
  access: `ACCESS-${sub}`,
  refresh: `REFRESH-${sub}`,
  expires: Date.now() + 3_600_000,
  sub,
  email,
  grantedScopes: [SCOPE.readonly],
  tier: "readonly",
  testingHint: false,
  ...extra,
});

describe("E8 — parallel adds", () => {
  it("two add flows get distinct keys and both persist", async () => {
    const { app, started, store } = await setup();
    const [r1, r2] = await Promise.all([
      app.inject({ method: "POST", url: "/api/plugins/gmail/accounts", payload: { tier: "readonly" } }),
      app.inject({ method: "POST", url: "/api/plugins/gmail/accounts", payload: { tier: "readonly" } }),
    ]);
    expect(r1.json().flowId).toBeDefined();
    expect(r2.json().flowId).toBeDefined();
    expect(started.map((s) => s.key).sort()).toEqual(["add-uuid1", "add-uuid2"]);
    await started[0]?.persist(cred("s1", "a@x.com"));
    await started[1]?.persist(cred("s2", "b@x.com"));
    expect((await store.list()).map((a) => a.sub).sort()).toEqual(["s1", "s2"]);
  });

  it("no client configured → 409 no_client", async () => {
    const { app, creds } = await setup();
    creds.data.delete(CLIENT_KEY);
    const r = await app.inject({ method: "POST", url: "/api/plugins/gmail/accounts", payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("no_client");
  });
});

describe("level change", () => {
  it("lowering applies immediately without a flow", async () => {
    const { app, started, creds } = await setup({ [acctKey("s1")]: account("s1", "a@x.com") });
    const r = await app.inject({ method: "POST", url: "/api/plugins/gmail/accounts/s1/level", payload: { tier: "draft" } });
    expect(r.json()).toMatchObject({ applied: true, account: { tier: "draft" } });
    expect(started).toHaveLength(0);
    expect(creds.data.get(acctKey("s1"))?.tier).toBe("draft");
  });

  it("raising starts a re-consent flow keyed reauth-<sub> with login_hint", async () => {
    const { app, started } = await setup({
      [acctKey("s1")]: account("s1", "a@x.com", { tier: "readonly", scopes: [SCOPE.readonly] }),
    });
    const r = await app.inject({ method: "POST", url: "/api/plugins/gmail/accounts/s1/level", payload: { tier: "send" } });
    expect(r.json().flowId).toBe("flow-1");
    expect(started[0]?.key).toBe("reauth-s1");
  });

  it("a grant whose scopes do not cover the requested level is refused (scope_missing), nothing stored", async () => {
    const { app, started, store } = await setup();
    await app.inject({ method: "POST", url: "/api/plugins/gmail/accounts", payload: { tier: "send" } });
    await expect(started[0]?.persist(cred("s9", "z@x.com", { tier: "send", grantedScopes: [SCOPE.readonly] }))).rejects.toMatchObject({
      code: "scope_missing",
    });
    expect(await store.list()).toHaveLength(0);
  });

  it("re-auth persisting a different account is refused", async () => {
    const { app, started } = await setup({ [acctKey("s1")]: account("s1", "a@x.com") });
    await app.inject({ method: "POST", url: "/api/plugins/gmail/accounts/s1/reauth" });
    await expect(started[0]?.persist(cred("other", "o@x.com"))).rejects.toMatchObject({ code: "account_mismatch" });
  });
});

describe("alias", () => {
  it("sets a unique alias; duplicate → 409 alias_taken", async () => {
    const { app } = await setup({ [acctKey("s1")]: account("s1", "a@x.com", { alias: "work" }), [acctKey("s2")]: account("s2", "b@x.com") });
    const dup = await app.inject({ method: "PATCH", url: "/api/plugins/gmail/accounts/s2", payload: { alias: "work" } });
    expect(dup.statusCode).toBe(409);
    const ok = await app.inject({ method: "PATCH", url: "/api/plugins/gmail/accounts/s2", payload: { alias: "home" } });
    expect(ok.json().account.alias).toBe("home");
  });
});

describe("X5 — revoke offline", () => {
  it("deletes locally and reports remoteRevoked:false", async () => {
    const { app, creds, google } = await setup({ [acctKey("s1")]: account("s1", "a@x.com") }, 503);
    const r = await app.inject({ method: "DELETE", url: "/api/plugins/gmail/accounts/s1" });
    expect(r.json()).toEqual({ removed: true, remoteRevoked: false });
    expect(creds.data.has(acctKey("s1"))).toBe(false);
    expect(google.revokes).toEqual(["REFRESH-s1"]);
  });
  it("remote ok → remoteRevoked:true", async () => {
    const { app } = await setup({ [acctKey("s1")]: account("s1", "a@x.com") });
    const r = await app.inject({ method: "DELETE", url: "/api/plugins/gmail/accounts/s1" });
    expect(r.json()).toEqual({ removed: true, remoteRevoked: true });
  });
});

describe("client upload + state", () => {
  it("accepts a Desktop client and never returns the secret", async () => {
    const { app, creds } = await setup();
    creds.data.delete(CLIENT_KEY);
    const bad = await app.inject({ method: "PUT", url: "/api/plugins/gmail/client", payload: { json: { web: { client_id: "x" } } } });
    expect(bad.json()).toEqual({ error: "web_client", step: 4 });
    const ok = await app.inject({
      method: "PUT",
      url: "/api/plugins/gmail/client",
      payload: { json: { installed: { client_id: "x.apps.googleusercontent.com", client_secret: "SECRET-up", project_id: "my-proj-1" } } },
    });
    expect(ok.json()).toMatchObject({ ok: true, projectId: "my-proj-1" });
    const state = await app.inject({ method: "GET", url: "/api/plugins/gmail/state" });
    expect(state.body).not.toContain("SECRET");
    expect(state.json().client).toMatchObject({ configured: true, clientId: "x.apps.googleusercontent.com" });
  });

  it("refuses replacing the client while accounts are connected (409 client_in_use)", async () => {
    const { app, creds } = await setup({ [acctKey("s1")]: account("s1", "a@x.com") });
    const r = await app.inject({
      method: "PUT",
      url: "/api/plugins/gmail/client",
      payload: { json: { installed: { client_id: "other.apps.googleusercontent.com", client_secret: "s2" } } },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ error: "client_in_use", step: 5 });
    expect(creds.data.get(CLIENT_KEY)?.clientId).toBe(CLIENT.clientId);
  });

  it("refuses a same-id client with a different secret while accounts are connected", async () => {
    const { app } = await setup({ [acctKey("s1")]: account("s1", "a@x.com") });
    const r = await app.inject({
      method: "PUT",
      url: "/api/plugins/gmail/client",
      payload: { json: { installed: { client_id: CLIENT.clientId, client_secret: "rotated" } } },
    });
    expect(r.json()).toEqual({ error: "client_in_use", step: 5 });
  });

  it("state lists accounts without tokens", async () => {
    const { app } = await setup({ [acctKey("s1")]: account("s1", "a@x.com") });
    const state = await app.inject({ method: "GET", url: "/api/plugins/gmail/state" });
    expect(state.json().accounts).toEqual([{ sub: "s1", email: "a@x.com", tier: "send", status: "ok", addedAt: 1 }]);
    expect(state.body).not.toMatch(/ACCESS-|REFRESH-/);
  });
});

describe("E29 — sign-in + revoke logs are secret-free", () => {
  it("never logs tokens, client secret or codes", async () => {
    const { app, started, logger } = await setup();
    await app.inject({ method: "POST", url: "/api/plugins/gmail/accounts", payload: { tier: "readonly" } });
    await started[0]?.persist(cred("s1", "a@x.com"));
    await app.inject({ method: "DELETE", url: "/api/plugins/gmail/accounts/s1" });
    const log = logger.lines.join("\n");
    expect(log).toContain("a@x.com");
    expect(log).not.toMatch(/ACCESS-|REFRESH-|SECRET-client/);
  });
});
