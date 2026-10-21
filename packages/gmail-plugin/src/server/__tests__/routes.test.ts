/**
 * L1 route tests (test-plan E8, X5, E29 + tasks 2.3): parallel adds, level
 * lower/raise, alias, revoke (remote down), client upload, secret-free logs.
 * See change: add-gmail-plugin.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PluginFlowStartError,
  type PluginLoginInteraction,
  type PluginOAuthCredential,
  type PluginOAuthStartOptions,
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

interface SetupOptions {
  /** Replaces the default recording `startFlow` fake. */
  startFlow?: (o: PluginOAuthStartOptions) => Promise<{ flowId: string }>;
  createCallback?: Parameters<typeof mountGmailRoutes>[1]["createCallback"];
  /** Initial `plugins.gmail` config for the setup routes. */
  pluginConfig?: Record<string, unknown>;
}

async function setup(initial: Record<string, Record<string, unknown>> = {}, revokeStatus = 200, opts: SetupOptions = {}) {
  const creds = memoryCredentials({ [CLIENT_KEY]: { ...CLIENT }, ...initial });
  const store = new AccountStore(creds);
  const started: PluginOAuthStartOptions[] = [];
  const oauth = {
    startFlow: vi.fn(async (o: PluginOAuthStartOptions) => {
      started.push(o);
      if (opts.startFlow) return opts.startFlow(o);
      return { flowId: `flow-${started.length}` };
    }),
  };
  const google = fakeGoogleFetch({ revoke: () => revokeStatus });
  const logger = capturingLogger();
  const app = Fastify();
  apps.push(app);
  let n = 0;
  const pluginConfig: Record<string, unknown> = { ...(opts.pluginConfig ?? {}) };
  const configUpdates: Array<Record<string, unknown>> = [];
  await mountGmailRoutes(app, {
    store,
    oauth,
    endpoints: TEST_ENDPOINTS,
    networkGuard: async () => {},
    logger,
    fetchImpl: google.fetchImpl,
    createCallback: opts.createCallback,
    newId: () => `uuid${++n}`,
    config: {
      get: () => ({ ...pluginConfig }),
      update: async (partial) => {
        configUpdates.push(partial);
        Object.assign(pluginConfig, partial);
      },
    },
  });
  return { app, creds, store, started, oauth, google, logger, pluginConfig, configUpdates };
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

// ── improve-gmail-settings-ux — design D3 ────────────────────────────────────

/** Interaction whose paste prompt never answers (rejects on abort). */
function idleInteraction(): PluginLoginInteraction {
  const ac = new AbortController();
  return {
    signal: ac.signal,
    prompt: (p) =>
      new Promise<string>((_, reject) => p.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    notify: () => {},
  };
}

/** Loopback callback fake whose `waitForCode` rejects with `err`. */
function failingCallback(err: unknown) {
  return (async () => ({
    redirectUri: "http://127.0.0.1:5555/",
    state: "S".repeat(43),
    waitForCode: () => Promise.reject(err),
    close: () => {},
    server: {} as never,
  })) as never;
}

const failLines = (warns: string[]) => warns.filter((l) => l.startsWith("[gmail] sign-in failed:"));

describe("test-plan #X1–#X5 — failed sign-ins are logged once, input-free", () => {
  it("#X1 a Google error redirect logs one warn and keeps the flow error code", async () => {
    const { app, started, logger } = await setup({}, 200, { createCallback: failingCallback({ code: "access_denied" }) });
    await app.inject({ method: "POST", url: "/api/plugins/gmail/accounts", payload: { tier: "readonly" } });
    await expect(started[0]?.loginFlow.login(idleInteraction())).rejects.toMatchObject({ code: "access_denied" });
    expect(failLines(logger.warns)).toEqual(["[gmail] sign-in failed: access_denied"]);
  });

  it("#X2 persist failures log one warn each (account_mismatch, scope_missing)", async () => {
    const { app, started, logger } = await setup({ [acctKey("s1")]: account("s1", "a@x.com") });
    await app.inject({ method: "POST", url: "/api/plugins/gmail/accounts/s1/reauth" });
    await expect(started[0]?.persist(cred("other", "o@x.com"))).rejects.toMatchObject({ code: "account_mismatch" });
    await app.inject({ method: "POST", url: "/api/plugins/gmail/accounts", payload: { tier: "send" } });
    await expect(started[1]?.persist(cred("s9", "z@x.com", { tier: "send" }))).rejects.toMatchObject({ code: "scope_missing" });
    expect(failLines(logger.warns)).toEqual([
      "[gmail] sign-in failed: account_mismatch",
      "[gmail] sign-in failed: scope_missing",
    ]);
  });

  it("#X3 a login failing before its first event is logged exactly once", async () => {
    const { app, logger } = await setup({}, 200, {
      createCallback: (async () => {
        throw new Error("listen EADDRINUSE");
      }) as never,
      // Host behaviour: a login that throws before its first event → PluginFlowStartError("login_failed").
      startFlow: async (o) => {
        await o.loginFlow.login(idleInteraction()).catch(() => {
          throw new PluginFlowStartError("login_failed", "login failed");
        });
        return { flowId: "never" };
      },
    });
    const r = await app.inject({ method: "POST", url: "/api/plugins/gmail/accounts", payload: { tier: "readonly" } });
    expect(r.statusCode).toBe(502);
    expect(failLines(logger.warns)).toHaveLength(1);
  });

  it.each([
    [{ code: "evil_123" }],
    [{ code: "ya29.token" }],
    [{ code: 42 }],
    [new Error("boom")],
    [Object.assign(new Error("redirect https://x?code=abc for a@x.com SECRET-client-xyz"), { code: "https://x?code=abc" })],
  ])("#X4 %j logs the generic code and nothing from the input", async (err) => {
    const viaLogin = await setup({}, 200, { createCallback: failingCallback(err) });
    await viaLogin.app.inject({ method: "POST", url: "/api/plugins/gmail/accounts", payload: {} });
    await viaLogin.started[0]?.loginFlow.login(idleInteraction()).catch(() => {});
    const viaStart = await setup({}, 200, { startFlow: async () => Promise.reject(err) });
    await viaStart.app.inject({ method: "POST", url: "/api/plugins/gmail/accounts", payload: {} });
    for (const { logger } of [viaLogin, viaStart]) {
      const lines = failLines(logger.warns);
      // login: the callback rejection is re-coded by google-oauth (callback_failed) — still input-free.
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^\[gmail\] sign-in failed: [a-z_]+$/);
      const all = logger.lines.join("\n");
      for (const bad of ["ya29", "code=abc", "https://", "@", CLIENT.clientSecret, "evil", "boom"]) expect(all).not.toContain(bad);
    }
    expect(failLines(viaStart.logger.warns)).toEqual(["[gmail] sign-in failed: sign_in_failed"]);
  });

  it("#X5 a start timeout logs one warn and replies 502 start_timeout", async () => {
    const { app, logger } = await setup({}, 200, {
      startFlow: async () => {
        throw new PluginFlowStartError("start_timeout", "timed out");
      },
    });
    const r = await app.inject({ method: "POST", url: "/api/plugins/gmail/accounts", payload: {} });
    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({ error: "start_timeout" });
    expect(failLines(logger.warns)).toEqual(["[gmail] sign-in failed: start_timeout"]);
  });
});

/** Run a started flow's login far enough to capture the authorization URL it announces. */
async function authUrlOf(o: PluginOAuthStartOptions): Promise<URL> {
  const events: Array<{ type: string; url?: string }> = [];
  const ix: PluginLoginInteraction = { ...idleInteraction(), notify: (e) => events.push(e as never) };
  await o.loginFlow.login(ix).catch(() => {});
  const url = events.find((e) => e.type === "auth_url")?.url;
  if (!url) throw new Error("no auth_url announced");
  return new URL(url);
}
const scopesOf = (u: URL): string[] => (u.searchParams.get("scope") ?? "").split(" ");
const loginFails = { createCallback: failingCallback({ code: "access_denied" }) };

describe("test-plan #E6 — PUT /setup", () => {
  const put = (app: Awaited<ReturnType<typeof setup>>["app"], payload: unknown) =>
    app.inject({ method: "PUT", url: "/api/plugins/gmail/setup", payload: payload as never });

  it("rejects a display name / bad owner and leaves config untouched", async () => {
    const { app, configUpdates, logger } = await setup();
    const a = await put(app, { projectId: "PiDashboard" });
    expect(a.statusCode).toBe(400);
    expect(a.json().error).toBe("invalid_project_id");
    const b = await put(app, { ownerAccount: "robson@" });
    expect(b.statusCode).toBe(400);
    expect(b.json().error).toBe("invalid_owner_account");
    // both invalid → project id reported first, nothing written
    const c = await put(app, { projectId: "PiDashboard", ownerAccount: "robson@" });
    expect(c.json().error).toBe("invalid_project_id");
    expect(configUpdates).toEqual([]);
    expect(logger.lines.filter((l) => l.includes("setup saved"))).toEqual([]);
  });

  it("an empty string clears a saved value", async () => {
    const { app, pluginConfig } = await setup({}, 200, { pluginConfig: { projectId: "pidashboard-510015", ownerAccount: "a@b.co" } });
    const r = await put(app, { projectId: "" });
    expect(r.statusCode).toBe(200);
    expect(pluginConfig.projectId).toBeUndefined();
    expect(pluginConfig.ownerAccount).toBe("a@b.co");
  });

  it("saves the normalized pair, echoes it, and logs exactly one value-free line", async () => {
    const { app, configUpdates, logger } = await setup();
    const r = await put(app, { projectId: "  pidashboard-510015 ", ownerAccount: " Robson@Semmi.SE " });
    expect(r.statusCode).toBe(200);
    expect(configUpdates).toEqual([{ projectId: "pidashboard-510015", ownerAccount: "robson@semmi.se" }]);
    expect(r.json().setup).toEqual({ projectId: "pidashboard-510015", ownerAccount: "robson@semmi.se" });
    expect(logger.lines.filter((l) => l.includes("setup saved"))).toEqual(["[gmail] setup saved"]);
  });

  it("interleaved single-key writes both survive", async () => {
    const { app, pluginConfig } = await setup();
    await Promise.all([put(app, { projectId: "pidashboard-510015" }), put(app, { ownerAccount: "a@b.co" })]);
    expect(pluginConfig).toMatchObject({ projectId: "pidashboard-510015", ownerAccount: "a@b.co" });
  });
});

describe("test-plan #E6 — the plugin config schema declares the saved keys", () => {
  it("projectId and ownerAccount are optional strings, so the generic config route accepts them", () => {
    const schema = JSON.parse(readFileSync(join(__dirname, "..", "..", "configSchema.json"), "utf8")) as {
      properties: Record<string, { type: string }>;
      required?: string[];
    };
    expect(schema.properties.projectId?.type).toBe("string");
    expect(schema.properties.ownerAccount?.type).toBe("string");
    expect(schema.required ?? []).toEqual([]);
  });
});

describe("test-plan #E7 — GET /state carries setup", () => {
  it("returns the saved values with no client configured", async () => {
    const { app, creds } = await setup({}, 200, { pluginConfig: { projectId: "pidashboard-510015", ownerAccount: "a@b.co" } });
    creds.data.delete(CLIENT_KEY);
    const r = await app.inject({ method: "GET", url: "/api/plugins/gmail/state" });
    expect(r.json().setup).toEqual({ projectId: "pidashboard-510015", ownerAccount: "a@b.co" });
    expect(r.json().client).toEqual({ configured: false });
  });
});

describe("test-plan #E17 — level route", () => {
  const level = (app: Awaited<ReturnType<typeof setup>>["app"], tier: string) =>
    app.inject({ method: "POST", url: "/api/plugins/gmail/accounts/s1/level", payload: { tier } });

  it("lowering a reauth_required account applies with no flow and keeps the status", async () => {
    const { app, started, creds } = await setup({ [acctKey("s1")]: account("s1", "a@x.com", { status: "reauth_required" }) });
    const r = await level(app, "readonly");
    expect(r.json()).toMatchObject({ applied: true, account: { tier: "readonly", status: "reauth_required" } });
    expect(started).toHaveLength(0);
    expect(creds.data.get(acctKey("s1"))?.status).toBe("reauth_required");
  });

  it("lowering with filters on is immediate without settings.basic", async () => {
    const { app, started } = await setup({ [acctKey("s1")]: account("s1", "a@x.com", { filters: true }) });
    expect((await level(app, "draft")).json()).toMatchObject({ applied: true, account: { tier: "draft", filters: true } });
    expect(started).toHaveLength(0);
  });

  it("a covering raise is immediate and keeps filters", async () => {
    const { app, started } = await setup({
      [acctKey("s1")]: account("s1", "a@x.com", { tier: "readonly", scopes: [SCOPE.modify, SCOPE.settingsBasic], filters: true }),
    });
    expect((await level(app, "send")).json()).toMatchObject({ applied: true, account: { tier: "send", filters: true } });
    expect(started).toHaveLength(0);
  });

  it("a raise whose grant lacks settings.basic re-consents with it iff filters are on", async () => {
    const on = await setup({ [acctKey("s1")]: account("s1", "a@x.com", { tier: "draft", scopes: [SCOPE.modify], filters: true }) }, 200, loginFails);
    expect((await level(on.app, "send")).json().flowId).toBeDefined();
    expect(scopesOf(await authUrlOf(on.started[0] as PluginOAuthStartOptions))).toContain(SCOPE.settingsBasic);

    const off = await setup({ [acctKey("s1")]: account("s1", "a@x.com", { tier: "readonly", scopes: [SCOPE.readonly] }) }, 200, loginFails);
    expect((await level(off.app, "send")).json().flowId).toBeDefined();
    expect(scopesOf(await authUrlOf(off.started[0] as PluginOAuthStartOptions))).not.toContain(SCOPE.settingsBasic);
  });

  it("a raise that returns without settings.basic stores nothing (filters on)", async () => {
    const { app, started, creds } = await setup({
      [acctKey("s1")]: account("s1", "a@x.com", { tier: "draft", scopes: [SCOPE.readonly, SCOPE.compose], filters: true }),
    });
    await level(app, "send");
    const before = structuredClone(creds.data.get(acctKey("s1")));
    await expect(started[0]?.persist(cred("s1", "a@x.com", { tier: "send", grantedScopes: [SCOPE.modify] }))).rejects.toMatchObject({ code: "scope_missing" });
    expect(creds.data.get(acctKey("s1"))).toEqual(before);
  });
});

describe("test-plan #E18 — POST /accounts/:sub/filters", () => {
  const toggle = (app: Awaited<ReturnType<typeof setup>>["app"], enabled: unknown) =>
    app.inject({ method: "POST", url: "/api/plugins/gmail/accounts/s1/filters", payload: { enabled } as never });

  it("false is immediate", async () => {
    const { app, started, creds } = await setup({ [acctKey("s1")]: account("s1", "a@x.com", { filters: true }) });
    expect((await toggle(app, false)).json()).toMatchObject({ applied: true });
    expect(started).toHaveLength(0);
    expect(creds.data.get(acctKey("s1"))?.filters).toBeUndefined();
  });

  it("true with a covering grant is immediate", async () => {
    const { app, started } = await setup({ [acctKey("s1")]: account("s1", "a@x.com", { scopes: [SCOPE.modify, SCOPE.settingsBasic] }) });
    expect((await toggle(app, true)).json()).toMatchObject({ applied: true, account: { filters: true } });
    expect(started).toHaveLength(0);
  });

  it("true without the filter scope starts a flow requesting it; a grant lacking it → scope_missing, record unchanged", async () => {
    const { app, started, creds } = await setup({ [acctKey("s1")]: account("s1", "a@x.com") }, 200, loginFails);
    expect((await toggle(app, true)).json().flowId).toBeDefined();
    expect(scopesOf(await authUrlOf(started[0] as PluginOAuthStartOptions))).toContain(SCOPE.settingsBasic);
    const before = structuredClone(creds.data.get(acctKey("s1")));
    await expect(started[0]?.persist(cred("s1", "a@x.com", { tier: "send", grantedScopes: [SCOPE.modify] }))).rejects.toMatchObject({ code: "scope_missing" });
    expect(creds.data.get(acctKey("s1"))).toEqual(before);
    await started[0]?.persist(cred("s1", "a@x.com", { tier: "send", grantedScopes: [SCOPE.modify, SCOPE.settingsBasic] }));
    expect(creds.data.get(acctKey("s1"))?.filters).toBe(true);
  });

  it("rejects a non-boolean body and an unknown account", async () => {
    const { app } = await setup({ [acctKey("s1")]: account("s1", "a@x.com") });
    expect((await toggle(app, "yes")).statusCode).toBe(400);
    const r = await app.inject({ method: "POST", url: "/api/plugins/gmail/accounts/nope/filters", payload: { enabled: true } });
    expect(r.statusCode).toBe(404);
  });
});

describe("test-plan #E19 — re-auth keeps the filter permission", () => {
  it("requests settings.basic again; a grant without it is scope_missing and the record is unchanged", async () => {
    const { app, started, creds } = await setup(
      { [acctKey("s1")]: account("s1", "a@x.com", { filters: true, scopes: [SCOPE.modify, SCOPE.settingsBasic], status: "reauth_required" }) },
      200,
      loginFails,
    );
    await app.inject({ method: "POST", url: "/api/plugins/gmail/accounts/s1/reauth" });
    expect(scopesOf(await authUrlOf(started[0] as PluginOAuthStartOptions))).toContain(SCOPE.settingsBasic);
    const before = structuredClone(creds.data.get(acctKey("s1")));
    await expect(started[0]?.persist(cred("s1", "a@x.com", { tier: "send", grantedScopes: [SCOPE.modify] }))).rejects.toMatchObject({ code: "scope_missing" });
    expect(creds.data.get(acctKey("s1"))).toEqual(before);
    expect(creds.data.get(acctKey("s1"))?.status).toBe("reauth_required");
  });
});
