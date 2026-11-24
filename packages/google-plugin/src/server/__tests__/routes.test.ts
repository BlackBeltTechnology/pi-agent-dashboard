/**
 * REST surface (test-plan A18–A34 upload/removal, B33–B35 callbacks, B54–B58 disclosure, B76 disconnect,
 * picker token; scenario-gate A4/A7/A8/B4/B8/B25). See change: add-google-connect.
 */
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { account, makeHarness, OWN_BB, OWN_SEMMI, ownClient } from "../../__tests__/fakes.js";
import { DISCLOSURE_VERSION } from "../../shared/default-clients.js";
import { SCOPE } from "../../shared/products.js";
import { mountGoogleRoutes } from "../routes.js";
import { acctKey, clientKey } from "../store.js";

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

const REMOTE_HDR = { "x-forwarded-for": "203.0.113.9" };
const P = "/api/plugins/google";

async function setup(o: Parameters<typeof makeHarness>[0] = {}, guardOpen = true, leaseToken?: Parameters<typeof mountGoogleRoutes>[1]["leaseToken"]) {
  const h = makeHarness(o);
  const app = Fastify();
  apps.push(app);
  await mountGoogleRoutes(app, {
    store: h.store,
    clients: h.clients,
    connect: h.connect,
    networkGuard: async (_req, reply) => {
      if (!guardOpen) return reply.code(403).send({ error: "network_denied" });
    },
    logger: h.logger,
    dashboardBase: () => "https://dash.example.com",
    leaseToken,
  });
  return { h, app };
}

const json = (installed: object | undefined, web?: object) => ({
  json: { ...(installed ? { installed } : {}), ...(web ? { web } : {}) },
});
const ID = (n: string) => `${n}.apps.googleusercontent.com`;

describe("GET /state", () => {
  it("is per browser: local gets the desktop built-in, a forwarded request the remote one; no secrets (10.2, 10.7)", async () => {
    const { app } = await setup({ initial: { [clientKey("bb")]: ownClient("bb", "BB") as never, [acctKey("s1")]: account("s1", "a@x.com") as never } });
    const local = (await app.inject({ method: "GET", url: `${P}/state` })).json();
    const remote = (await app.inject({ method: "GET", url: `${P}/state`, headers: REMOTE_HDR })).json();
    expect(local).toMatchObject({ browser: "local", builtin: { available: true, ref: "builtin" }, disclosure: { accepted: false, version: DISCLOSURE_VERSION } });
    expect(remote).toMatchObject({ browser: "remote", builtin: { available: true, ref: "builtin-remote" } });
    expect(local.webRedirectUri).toBe("https://dash.example.com/api/plugins/google/oauth/callback");
    expect(local.accounts[0]).toMatchObject({ sub: "s1", email: "a@x.com", client: "builtin" });
    expect(JSON.stringify(local)).not.toMatch(/SECRET|REFRESH|ACCESS/);
    expect(local.products.find((p: { id: string }) => p.id === "drive").levels).toEqual([
      { id: "files", builtin: true },
      { id: "read", builtin: false },
      { id: "write", builtin: false },
    ]);
  });
  it("management routes sit behind the network guard", async () => {
    const { app } = await setup({}, false);
    expect((await app.inject({ method: "GET", url: `${P}/state` })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `${P}/accounts`, payload: {} })).statusCode).toBe(403);
  });
});

describe("PUT /disclosure (B8)", () => {
  it("body-less; records the server's version; hub-local only", async () => {
    const { app, h } = await setup();
    const denied = await app.inject({ method: "PUT", url: `${P}/disclosure`, headers: REMOTE_HDR });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "origin_denied" });
    expect(await h.store.getDisclosure()).toBeUndefined();
    const ok = await app.inject({ method: "PUT", url: `${P}/disclosure` });
    expect(ok.json()).toEqual({ ok: true, version: DISCLOSURE_VERSION });
    expect(await h.store.getDisclosure()).toMatchObject({ version: DISCLOSURE_VERSION });
  });
});

describe("PUT /clients (A4, A22)", () => {
  const up = (app: Awaited<ReturnType<typeof setup>>["app"], payload: unknown) => app.inject({ method: "PUT", url: `${P}/clients`, payload: payload as object });
  it("accepts a Desktop and a Web client and returns a secret-free summary", async () => {
    const { app } = await setup();
    const a = await up(app, { ...json({ client_id: ID("a"), client_secret: "S1", project_id: "acme-pi" }), label: "BlackBelt", domains: ["BlackBelt.hu"] });
    expect(a.json()).toMatchObject({ ok: true, created: true, client: { id: "blackbelt", label: "BlackBelt", type: "installed", domains: ["blackbelt.hu"], accounts: 0, projectId: "acme-pi" } });
    const b = await up(app, { ...json(undefined, { client_id: ID("b"), client_secret: "S2" }), label: "Semmi" });
    expect(b.json().client).toMatchObject({ type: "web" });
    expect(a.body + b.body).not.toMatch(/S1|S2/);
  });
  it("refuses each invalid upload with a stable code and stores nothing", async () => {
    const { app, h } = await setup();
    const cases: Array<[unknown, string]> = [
      [{ json: "{nope" }, "not_json"],
      [{ json: {} }, "not_installed"],
      [json({ client_id: ID("a"), client_secret: "s" }, { client_id: ID("b"), client_secret: "s" }), "ambiguous_client"],
      [json({ client_id: "bad", client_secret: "s" }), "bad_client_id"],
      [json({ client_id: ID("a") }), "missing_secret"],
    ];
    for (const [payload, error] of cases) {
      const r = await up(app, payload);
      expect([r.statusCode, r.json().error]).toEqual([400, error]);
    }
    expect(await h.store.listClients()).toEqual([]);
  });
  it("domain_taken → 409 naming the owner; invalid_domain → 400; nothing stored for the refused client", async () => {
    const { app, h } = await setup({ initial: { [clientKey("semmi")]: ownClient("semmi", "Semmi", OWN_SEMMI, { domains: ["semmi.se"] }) as never } });
    const taken = await up(app, { ...json({ client_id: ID("c"), client_secret: "s" }), domains: ["semmi.se"] });
    expect([taken.statusCode, taken.json().error, taken.json().detail]).toEqual([409, "domain_taken", "Semmi"]);
    const bad = await up(app, { ...json({ client_id: ID("c"), client_secret: "s" }), domains: ["nodot"] });
    expect([bad.statusCode, bad.json().error]).toEqual([400, "invalid_domain"]);
    expect(await h.store.listClients()).toHaveLength(1);
  });
  it("a repeated upload of the same Google client id updates it (created:false)", async () => {
    const { app } = await setup();
    await up(app, { ...json({ client_id: ID("a"), client_secret: "S1" }), label: "One" });
    const again = await up(app, { ...json({ client_id: ID("a"), client_secret: "S2" }), label: "Two" });
    expect(again.json()).toMatchObject({ created: false, client: { label: "One" } });
  });
});

describe("PATCH/DELETE /clients/:id (A25, A31–A34)", () => {
  const seeded = { [clientKey("bb")]: ownClient("bb", "BlackBelt", OWN_BB, { domains: ["blackbelt.hu"] }) as never, [acctKey("s1")]: account("s1", "a@blackbelt.hu", { client: "own:bb", clientId: OWN_BB.clientId }) as never };
  it("renaming keeps the id, the domains and the account binding", async () => {
    const { app, h } = await setup({ initial: seeded });
    const r = await app.inject({ method: "PATCH", url: `${P}/clients/bb`, payload: { label: "BB Corp" } });
    expect(r.json().client).toMatchObject({ id: "bb", label: "BB Corp", domains: ["blackbelt.hu"], accounts: 1 });
    expect((await h.store.get("s1"))?.client).toBe("own:bb");
  });
  it("DELETE in use → 409 client_in_use, both records unchanged; unknown → 404; free → removed", async () => {
    const { app, h } = await setup({ initial: { ...seeded, [clientKey("free")]: ownClient("free", "Free", OWN_SEMMI) as never } });
    const used = await app.inject({ method: "DELETE", url: `${P}/clients/bb` });
    expect([used.statusCode, used.json().error]).toEqual([409, "client_in_use"]);
    expect(await h.store.getClient("bb")).toBeDefined();
    expect((await app.inject({ method: "DELETE", url: `${P}/clients/ghost` })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `${P}/clients/free` })).json()).toEqual({ removed: true });
  });
});

describe("accounts", () => {
  it("POST /accounts starts a flow through the connect service and maps refusals to HTTP", async () => {
    const { app, h } = await setup({ builtIn: { local: null, remote: null } });
    const none = await app.inject({ method: "POST", url: `${P}/accounts`, payload: { products: { calendar: "read" } } });
    expect([none.statusCode, none.json().error, none.json().clients]).toEqual([400, "client_required", []]);
    const empty = await app.inject({ method: "POST", url: `${P}/accounts`, payload: { products: {} } });
    expect([empty.statusCode, empty.json().error]).toEqual([400, "no_products"]);
    expect(h.started).toHaveLength(0);
  });
  it("POST /accounts with a usable client returns the flow id and path (no status/ok leak)", async () => {
    const { app } = await setup({ initial: { [clientKey("bb")]: ownClient("bb", "BB") as never } });
    const r = await app.inject({ method: "POST", url: `${P}/accounts`, payload: { products: { gmail: "readonly" }, client: "own:bb" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, flowId: "flow-1", path: "local", client: "own:bb" });
  });
  it("a forwarded request is a REMOTE browser: Desktop client → paste", async () => {
    const { app } = await setup({ initial: { [clientKey("bb")]: ownClient("bb", "BB") as never } });
    const r = await app.inject({ method: "POST", url: `${P}/accounts`, headers: REMOTE_HDR, payload: { products: { gmail: "readonly" }, client: "own:bb" } });
    expect(r.json().path).toBe("paste");
  });
  it("POST /accounts/:sub/products: lowering applies at once and returns the account; bad body → 400", async () => {
    const { app } = await setup({ initial: { [acctKey("s1")]: account("s1", "a@x.com", { scopes: [SCOPE.gmailModify], products: { gmail: { level: "send" } } }) as never } });
    const r = await app.inject({ method: "POST", url: `${P}/accounts/s1/products`, payload: { products: { gmail: { level: "readonly" } } } });
    expect(r.json()).toMatchObject({ ok: true, applied: true, account: { products: { gmail: { level: "readonly" } } } });
    expect((await app.inject({ method: "POST", url: `${P}/accounts/s1/products`, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `${P}/accounts/ghost/products`, payload: { products: { gmail: null } } })).statusCode).toBe(404);
  });
  it("PATCH alias: ok, taken → 409, invalid → 400, unknown → 404", async () => {
    const { app } = await setup({ initial: { [acctKey("s1")]: account("s1", "a@x.com", { alias: "work" }) as never, [acctKey("s2")]: account("s2", "b@x.com") as never } });
    expect((await app.inject({ method: "PATCH", url: `${P}/accounts/s2`, payload: { alias: "home" } })).json().account.alias).toBe("home");
    expect((await app.inject({ method: "PATCH", url: `${P}/accounts/s2`, payload: { alias: "WORK" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "PATCH", url: `${P}/accounts/s2`, payload: { alias: "no good" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `${P}/accounts/ghost`, payload: { alias: "x" } })).statusCode).toBe(404);
  });
  it("DELETE removes locally; ?revoke=true also revokes at Google; unknown → 404 (B76)", async () => {
    const { app, h } = await setup({ initial: { [acctKey("s1")]: account("s1", "a@x.com") as never, [acctKey("s2")]: account("s2", "b@x.com") as never } });
    expect((await app.inject({ method: "DELETE", url: `${P}/accounts/s1` })).json()).toEqual({ ok: true, removed: true, remoteRevoked: null });
    expect(h.google.revokes).toEqual([]);
    expect((await app.inject({ method: "DELETE", url: `${P}/accounts/s2?revoke=true` })).json()).toEqual({ ok: true, removed: true, remoteRevoked: true });
    expect(h.google.revokes).toEqual(["REFRESH-s2"]);
    expect((await app.inject({ method: "DELETE", url: `${P}/accounts/s2` })).statusCode).toBe(404);
  });
});

describe("OAuth callbacks (B33–B35)", () => {
  it("reachable WITHOUT the network guard, but only for a pending state; unknown state → 400 invalid_state, nothing changes", async () => {
    const { app, h } = await setup({}, false);
    for (const url of [`${P}/oauth/callback?code=C&state=forged`, `${P}/oauth/remote-callback?code=C&state=forged`, `${P}/oauth/remote-callback?code=C`, `${P}/oauth/remote-callback`]) {
      const r = await app.inject({ method: "GET", url });
      expect([r.statusCode, r.json()]).toEqual([400, { error: "invalid_state" }]);
    }
    expect(await h.store.list()).toEqual([]);
  });
  it("a pending state is accepted once; the page is static, no-store and no-referrer, and never echoes the code", async () => {
    const { app, h } = await setup({}, false);
    const f = h.pending.create({ origin: "https://dash.example.com" });
    const ok = await app.inject({ method: "GET", url: `${P}/oauth/remote-callback?code=SECRETCODE&state=${encodeURIComponent(f.state)}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toMatch(/text\/html/);
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(ok.headers["referrer-policy"]).toBe("no-referrer");
    expect(ok.body).not.toContain("SECRETCODE");
    await expect(f.result).resolves.toEqual({ code: "SECRETCODE" });
    expect((await app.inject({ method: "GET", url: `${P}/oauth/remote-callback?code=SECRETCODE&state=${encodeURIComponent(f.state)}` })).statusCode).toBe(400);
  });
  it("Google's error reaches the waiting flow; the own-Web callback behaves the same", async () => {
    const { app, h } = await setup();
    const f = h.pending.create({});
    expect((await app.inject({ method: "GET", url: `${P}/oauth/callback?error=access_denied&state=${f.state}` })).statusCode).toBe(200);
    await expect(f.result).resolves.toEqual({ error: "access_denied" });
  });
});

describe("POST /picker-token (D9)", () => {
  const seeded = { [acctKey("s1")]: account("s1", "a@x.com", { scopes: [SCOPE.driveFile], products: { drive: { level: "files" } } }) as never };
  const lease = () => vi.fn(async () => ({ accessToken: "PICKER-TOKEN", expiresAt: 5 }));
  it("hands a token to a local browser for a built-in account with Drive on", async () => {
    const leaseToken = lease();
    const { app } = await setup({ initial: seeded }, true, leaseToken);
    const r = await app.inject({ method: "POST", url: `${P}/picker-token`, payload: { account: "a@x.com" } });
    expect(r.json()).toEqual({ accessToken: "PICKER-TOKEN", expiresAt: 5 });
    expect(leaseToken).toHaveBeenCalledWith("s1");
  });
  it("refuses a remote browser, an own-client account, an account without Drive, and a missing body — without leasing", async () => {
    const leaseToken = lease();
    const { app } = await setup(
      { initial: { ...seeded, [acctKey("s2")]: account("s2", "b@x.com", { client: "own:bb", products: { drive: { level: "files" } } }) as never, [acctKey("s3")]: account("s3", "c@x.com") as never } },
      true,
      leaseToken,
    );
    const post = (payload: object, headers = {}) => app.inject({ method: "POST", url: `${P}/picker-token`, payload, headers });
    expect((await post({ account: "a@x.com" }, REMOTE_HDR)).json()).toEqual({ error: "picker_unavailable" });
    expect((await post({ account: "b@x.com" })).json()).toEqual({ error: "picker_unavailable" });
    expect((await post({ account: "c@x.com" })).json()).toEqual({ error: "picker_unavailable" });
    expect((await post({})).statusCode).toBe(400);
    expect((await post({ account: "ghost@x.com" })).statusCode).toBe(404);
    expect(leaseToken).not.toHaveBeenCalled();
  });
});
