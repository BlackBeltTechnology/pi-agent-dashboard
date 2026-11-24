/**
 * REST + callback contract (test-plan A24, A37–A40, B15, B34–B37, B47, B51, B56, B57, B59, B60, B71–B76):
 * dashboard base precedence, the setup entry point per browser, the project-id warning, who counts as a
 * local browser, callbacks accepted only for the dashboard's own pending flows, the disclosure gate over HTTP,
 * and disconnect. See change: add-google-connect.
 *
 * @structural-pin host wiring of getDashboardBaseUrl lives in packages/server/src/server.ts (a plugin test must not import the server); the wiring text IS the contract, behaviour is covered by server auth-redirect-base.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginLoginInteraction } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { account, LOCAL, makeHarness, OWN_BB, OWN_SEMMI, ownClient, REMOTE } from "../../__tests__/fakes.js";
import { consoleLinks, gcloudCommands } from "../../client/wizard.js";
import { DISCLOSURE_VERSION } from "../../shared/default-clients.js";
import { SCOPE } from "../../shared/products.js";
import { GOOGLE_APIS, projectMismatch } from "../../shared/setup.js";
import { createLegacyImporter, type LegacyGmailAccount } from "../import.js";
import { mountGoogleRoutes } from "../routes.js";
import { acctKey, clientKey, IMPORTED_GMAIL_KEY } from "../store.js";

type H = ReturnType<typeof makeHarness>;

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const a of apps.splice(0)) await a.close();
});

const P = "/api/plugins/google";
const FWD = { "x-forwarded-for": "203.0.113.9" };
const cal = [SCOPE.calendarReadonly];

async function setup(o: Parameters<typeof makeHarness>[0] = {}, extra: { guardOpen?: boolean; browser?: unknown } = {}) {
  const h = makeHarness(o);
  const app = Fastify();
  apps.push(app);
  await mountGoogleRoutes(app, {
    store: h.store,
    clients: h.clients,
    connect: h.connect,
    networkGuard: async (_req, reply) => {
      if (extra.guardOpen === false) return reply.code(403).send({ error: "network_denied" });
    },
    logger: h.logger,
    dashboardBase: () => ("base" in (o ?? {}) ? o.base : "https://dash.example.com"),
    getBrowserService: extra.browser ? () => extra.browser as never : undefined,
  });
  return { h, app };
}

/** Start a login and leave it waiting for its code: the dialog open on Google's page. */
async function begin(h: H, i = h.started.length - 1) {
  const s = h.started[i];
  if (!s) throw new Error("no flow started");
  const events: Array<{ type: string; url?: string }> = [];
  const ac = new AbortController();
  const ix = { signal: ac.signal, prompt: vi.fn(() => new Promise<string>(() => {})), notify: (e: unknown) => events.push(e as never) } as unknown as PluginLoginInteraction;
  const login = s.loginFlow.login(ix);
  const settled = { done: false };
  login.then(
    () => (settled.done = true),
    () => (settled.done = true),
  );
  for (let n = 0; n < 500 && !events.some((e) => e.type === "auth_url"); n++) await new Promise((r) => setImmediate(r));
  const url = new URL(events.find((e) => e.type === "auth_url")?.url as string);
  const state = url.searchParams.get("state") as string;
  return {
    url,
    state,
    ac,
    login,
    settled,
    /** Google returns `code`: deliver it for THIS flow's state, then persist like the host does. */
    async finish(who: { sub: string; email: string }) {
      h.reply.sub = who.sub;
      h.reply.email = who.email;
      h.reply.claims = { nonce: url.searchParams.get("nonce"), aud: url.searchParams.get("client_id") };
      const delivered = h.connect.deliver(state, { code: "CODE" });
      if (!delivered.ok) return delivered;
      await s.persist(await login);
      return delivered;
    },
  };
}
const exchanges = (h: H) => h.google.calls.filter((c) => c.grant === "authorization_code");
const webClient = (id = "w") => ({ [clientKey(id)]: ownClient(id, "Web", OWN_BB, { type: "web" }) as never });

describe("A24 / #B45 — the dashboard base follows the dashboard-login precedence", () => {
  const bases = [
    ["auth.redirectBaseUrl set", "https://dash.example.com"],
    ["unset, tunnel active", "https://abc.trycloudflare.com"],
    ["unset, no tunnel → localhost", "http://localhost:8000"],
  ] as const;

  it.each(bases)("%s → the own Web client's redirect URI is <base>/api/plugins/google/oauth/callback", async (_n, base) => {
    const { h, app } = await setup({ initial: webClient(), base, google: { scope: cal } });
    const state = (await app.inject({ method: "GET", url: `${P}/state` })).json();
    expect(state.webRedirectUri).toBe(`${base}${P}/oauth/callback`);
    expect(await h.connect.startConnect({ products: { calendar: "read" }, client: "own:w", browser: "remote" })).toMatchObject({ ok: true, path: "web" });
    expect((await begin(h)).url.searchParams.get("redirect_uri")).toBe(`${base}${P}/oauth/callback`);
  });

  it.each(["https://pi.blackbelt.hu", "https://pi.blackbelt.hu/"])("#B45 auth.redirectBaseUrl %s → redirect_uri is exactly <base>/api/plugins/google/oauth/callback (never a double slash)", async (base) => {
    const { h } = await setup({ initial: webClient(), base, google: { scope: cal } });
    expect(await h.connect.startConnect({ products: { calendar: "read" }, client: "own:w", browser: "remote" })).toMatchObject({ ok: true, path: "web" });
    const uri = (await begin(h)).url.searchParams.get("redirect_uri") as string;
    expect(uri).toBe("https://pi.blackbelt.hu/api/plugins/google/oauth/callback");
    expect(uri.replace("https://", "")).not.toContain("//");
  });

  it("a trailing slash on the base does not double up", async () => {
    const { app } = await setup({ base: "https://dash.example.com/" });
    expect((await app.inject({ method: "GET", url: `${P}/state` })).json().webRedirectUri).toBe(`https://dash.example.com${P}/oauth/callback`);
  });

  it("the host seam IS the dashboard-login resolver (redirectBaseUrl → tunnel → localhost)", () => {
    const server = readFileSync(join(__dirname, "../../../../server/src/server.ts"), "utf8");
    expect(server).toMatch(/getDashboardBaseUrl: \(\) => resolveRedirectBase\(config\.port, config\.authConfig\?\.redirectBaseUrl\)\.base/);
    const auth = readFileSync(join(__dirname, "../../../../server/src/auth/auth.ts"), "utf8");
    expect(auth).toMatch(/const raw = baseOverride \|\| tunnel \|\| `http:\/\/localhost:\$\{port\}`;/);
  });
});

describe("A37 — 'Add organisation sign-in': automatic setup only for a local browser; the guided wizard for both", () => {
  const browser = { status: async () => ({ enabled: true, available: true, downloadsDir: "/tmp/dl" }) };

  it("local: autoSetup available; remote: refused as remote_dashboard", async () => {
    const { app } = await setup({}, { browser });
    const local = (await app.inject({ method: "GET", url: `${P}/state` })).json();
    const remote = (await app.inject({ method: "GET", url: `${P}/state`, headers: FWD })).json();
    expect(local.autoSetup).toMatchObject({ available: true, local: true });
    expect(remote.autoSetup).toMatchObject({ available: false, reason: "remote_dashboard", local: false });
  });

  it("the guided path (state data + client upload) works from both browsers", async () => {
    const { app } = await setup({}, { browser });
    for (const headers of [{}, FWD]) {
      const state = await app.inject({ method: "GET", url: `${P}/state`, headers });
      expect(state.statusCode).toBe(200);
      expect(state.json().webRedirectUri).toBe(`https://dash.example.com${P}/oauth/callback`);
      const id = `c${Object.keys(headers).length}`;
      const up = await app.inject({ method: "PUT", url: `${P}/clients`, headers, payload: { json: { installed: { client_id: `${id}.apps.googleusercontent.com`, client_secret: "S", project_id: "acme-pi" } }, label: id } });
      expect(up.statusCode).toBe(200);
    }
  });

  it("automatic setup cannot be started from a remote browser", async () => {
    const { app } = await setup({}, { browser });
    const r = await app.inject({ method: "POST", url: `${P}/setup/run`, headers: FWD, payload: { mode: "internal", projectId: "acme-pi" } });
    expect(r.statusCode).toBe(403);
  });
});

describe("A38–A40 — setup covers every product and every client", () => {
  const up = (projectId: string, over: Record<string, unknown> = {}) => ({
    json: { installed: { client_id: `${projectId}.apps.googleusercontent.com`, client_secret: "S", project_id: projectId } },
    ...over,
  });

  it("A38: client 'BlackBelt' exists for bbelt-pi; a new client for semmi-pi with JSON project semmi-pi → stored, no mismatch", async () => {
    const { app, h } = await setup({ initial: { [clientKey("bb")]: ownClient("bb", "BlackBelt", OWN_BB, { projectId: "bbelt-pi" }) as never } });
    const r = await app.inject({ method: "PUT", url: `${P}/clients`, payload: up("semmi-pi", { label: "Semmi", expectedProjectId: "semmi-pi" }) });
    expect(r.statusCode).toBe(200);
    expect(r.json().projectMismatch).toBeUndefined();
    expect(r.json()).toMatchObject({ ok: true, created: true });
    expect((await h.store.listClients()).map((c) => c.id).sort()).toEqual(["bb", "semmi"]);
    expect(projectMismatch("semmi-pi", "semmi-pi")).toBeNull();
  });

  it("A39: wizard for semmi-pi, JSON of bbelt-pi → the mismatch names semmi-pi (the client being set up); the upload is accepted (A6)", async () => {
    const { app, h } = await setup({ initial: { [clientKey("bb")]: ownClient("bb", "BlackBelt", OWN_BB, { projectId: "bbelt-pi" }) as never } });
    const r = await app.inject({ method: "PUT", url: `${P}/clients`, payload: up("bbelt-pi", { label: "Semmi", expectedProjectId: "semmi-pi" }) });
    expect(r.statusCode).toBe(200);
    expect(r.json().projectMismatch).toEqual({ expected: "semmi-pi", uploaded: "bbelt-pi" });
    expect(JSON.stringify(r.json().projectMismatch)).not.toContain("BlackBelt");
    expect(await h.store.listClients()).toHaveLength(2); // A6: a warning, the upload is accepted
  });

  it("A39: without a wizard project, or without a project in the JSON, nothing is reported", async () => {
    expect(projectMismatch(undefined, "bbelt-pi")).toBeNull();
    expect(projectMismatch("semmi-pi", undefined)).toBeNull();
    expect(projectMismatch("  semmi-pi ", "semmi-pi")).toBeNull();
    expect(projectMismatch(42, "bbelt-pi")).toBeNull();
  });

  it("A40: the Console links and the gcloud command name acme-pi and cover all eight product APIs", () => {
    expect([...GOOGLE_APIS]).toEqual(["gmail.googleapis.com", "calendar-json.googleapis.com", "drive.googleapis.com", "docs.googleapis.com", "sheets.googleapis.com", "slides.googleapis.com", "tasks.googleapis.com", "people.googleapis.com"]);
    const links = consoleLinks("acme-pi");
    expect(links.enableApis).toContain("project=acme-pi");
    for (const api of GOOGLE_APIS) expect(decodeURIComponent(links.enableApis ?? "")).toContain(api);
    const cmd = gcloudCommands("acme-pi").enable ?? "";
    expect(cmd).toContain("--project acme-pi");
    for (const api of GOOGLE_APIS) expect(cmd).toContain(api);
  });
});

describe("B15 — only a genuinely local browser gets the loopback redirect", () => {
  const rows: Array<[string, string, Record<string, string>, boolean]> = [
    ["127.0.0.1", "127.0.0.1", {}, true],
    ["::1", "::1", {}, true],
    ["::ffff:127.0.0.1", "::ffff:127.0.0.1", {}, true],
    ["127.0.0.1 + X-Forwarded-For", "127.0.0.1", { "x-forwarded-for": "203.0.113.9" }, false],
    ["127.0.0.1 + X-Forwarded-Host", "127.0.0.1", { "x-forwarded-host": "dash.example.com" }, false],
    ["127.0.0.1 + Forwarded", "127.0.0.1", { forwarded: "for=203.0.113.9" }, false],
    ["127.0.0.1 + Via", "127.0.0.1", { via: "1.1 proxy" }, false],
    ["LAN 192.168.1.5", "192.168.1.5", {}, false],
  ];
  it.each(rows)("%s → loopback: %s", async (_n, remoteAddress, headers, loopback) => {
    const { h, app } = await setup({ google: { scope: cal } });
    await h.connect.acceptDisclosure();
    const r = await app.inject({ method: "POST", url: `${P}/accounts`, remoteAddress, headers, payload: { products: { calendar: "read" } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().path).toBe(loopback ? "local" : "return");
    const redirect = (await begin(h)).url.searchParams.get("redirect_uri") as string;
    expect(/^http:\/\/127\.0\.0\.1:/.test(redirect)).toBe(loopback);
  });
});

describe("B34 — a returned code is accepted only for a state the dashboard issued", () => {
  it("no pending flow, no dashboard session → 400 invalid_state (not the login gate); nothing stored, no exchange; the waiting sign-in is unchanged", async () => {
    const { h, app } = await setup({ initial: webClient(), google: { scope: cal } }, { guardOpen: false });
    await h.connect.startConnect({ products: { calendar: "read" }, client: "own:w", browser: "remote" });
    const f = await begin(h);
    const bogus = await app.inject({ method: "GET", url: `${P}/oauth/remote-callback?code=C&state=not-issued-by-us` });
    expect(bogus.statusCode).toBe(400);
    expect(bogus.json()).toEqual({ error: "invalid_state" });
    expect(await h.store.list()).toEqual([]);
    expect(exchanges(h)).toHaveLength(0);
    expect(f.settled.done).toBe(false);
    // the management routes ARE behind the guard in the same app
    expect((await app.inject({ method: "GET", url: `${P}/state` })).statusCode).toBe(403);
    // and the waiting flow can still complete with its own state
    const ok = await app.inject({ method: "GET", url: `${P}/oauth/callback?code=C&state=${encodeURIComponent(f.state)}` });
    expect(ok.statusCode).toBe(200);
    // #B21: the window the dialog opened closes itself; the text stays for a window the browser will not close.
    expect(ok.body).toContain("window.close()");
    expect(ok.body).toContain("You can close this window");
  });
});

describe("B35 / B36 / B37 — only the dashboard's own, live flows complete", () => {
  it("B35: a state of another flow, a random one or an expired one is refused; F1 stays pending and completes with S1; F2 untouched", async () => {
    const { h } = await setup({ google: { scope: cal } });
    await h.connect.acceptDisclosure();
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" });
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" });
    const f1 = await begin(h, 0);
    const f2 = await begin(h, 1);
    for (const state of ["random-state", `${"x".repeat(43)}~https://dash.example.com`, "", f1.state.replace(/.$/, (c) => (c === "A" ? "B" : "A"))]) {
      expect(h.connect.deliver(state, { code: "C" })).toMatchObject({ ok: false, error: "invalid_state" });
    }
    expect(f1.settled.done).toBe(false);
    expect(f2.settled.done).toBe(false);
    expect(await f1.finish({ sub: "s1", email: "a@x.com" })).toMatchObject({ ok: true });
    expect(f2.settled.done).toBe(false);
    expect((await h.store.list()).map((a) => a.sub)).toEqual(["s1"]);
  });

  it("B36: two parallel built-in flows never cross: each state completes only its own flow and identity", async () => {
    const { h } = await setup({ google: { scope: cal } });
    await h.connect.acceptDisclosure();
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" });
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" });
    const f1 = await begin(h, 0);
    const f2 = await begin(h, 1);
    expect(f1.state).not.toBe(f2.state);
    await f2.finish({ sub: "s2", email: "two@x.com" });
    expect(f1.settled.done).toBe(false);
    expect((await h.store.list()).map((a) => [a.sub, a.email])).toEqual([["s2", "two@x.com"]]);
    expect(h.connect.deliver(f2.state, { code: "C" })).toMatchObject({ ok: false, error: "invalid_state" });
    await f1.finish({ sub: "s1", email: "one@x.com" });
    expect((await h.store.list()).map((a) => [a.sub, a.email]).sort()).toEqual([["s1", "one@x.com"], ["s2", "two@x.com"]]);
  });

  it("B37: a cancelled flow (dialog closed) refuses a later valid message; nothing stored", async () => {
    const { h } = await setup({ google: { scope: cal } });
    await h.connect.acceptDisclosure();
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" });
    const f = await begin(h);
    f.ac.abort();
    await expect(f.login).rejects.toBeTruthy();
    expect(h.connect.deliver(f.state, { code: "CODE" })).toMatchObject({ ok: false, error: "invalid_state" });
    expect(await h.store.list()).toEqual([]);
    expect(exchanges(h)).toHaveLength(0);
  });

  it("B37: a flow older than the 300 s lifetime refuses a later valid message; the dialog gets `timeout`; nothing stored", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { h } = await setup({ google: { scope: cal } });
    await h.connect.acceptDisclosure();
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" });
    const f = await begin(h);
    const rejected = expect(f.login).rejects.toMatchObject({ code: "timeout" });
    vi.advanceTimersByTime(299_000);
    expect(f.settled.done).toBe(false);
    vi.advanceTimersByTime(2_000);
    await rejected;
    expect(h.connect.deliver(f.state, { code: "CODE" })).toMatchObject({ ok: false, error: "invalid_state" });
    expect(await h.store.list()).toEqual([]);
  });
});

describe("B47 — callbacks on an own Web client", () => {
  it("unknown state → 400; missing code → the sign-in fails; error=access_denied → the sign-in ends; nothing stored", async () => {
    const { h, app } = await setup({ initial: webClient(), google: { scope: cal } });
    await h.connect.startConnect({ products: { calendar: "read" }, client: "own:w", browser: "remote" });
    const unknown = await begin(h, 0);
    expect((await app.inject({ method: "GET", url: `${P}/oauth/callback?code=C&state=nope` })).statusCode).toBe(400);
    expect(unknown.settled.done).toBe(false);
    const noCode = await app.inject({ method: "GET", url: `${P}/oauth/callback?state=${encodeURIComponent(unknown.state)}` });
    expect(noCode.statusCode).toBe(200); // the state was ours; the flow itself refuses a reply without a code
    await expect(unknown.login).rejects.toMatchObject({ code: "invalid_redirect" });

    await h.connect.startConnect({ products: { calendar: "read" }, client: "own:w", browser: "remote" });
    const denied = await begin(h, 1);
    await app.inject({ method: "GET", url: `${P}/oauth/callback?error=access_denied&state=${encodeURIComponent(denied.state)}` });
    await expect(denied.login).rejects.toMatchObject({ code: "access_denied" });
    expect(await h.store.list()).toEqual([]);
    expect(exchanges(h)).toHaveLength(0);
  });

  it("an own `installed` client from a remote browser is offered the paste path, never the Web callback", async () => {
    const { app } = await setup({ initial: { [clientKey("bb")]: ownClient("bb", "BB") as never } });
    const r = await app.inject({ method: "POST", url: `${P}/accounts`, headers: FWD, payload: { products: { calendar: "read" }, client: "own:bb" } });
    expect(r.json()).toMatchObject({ ok: true, path: "paste" });
  });
});

describe("B51 / B56 / B57 / B59 / B60 — the disclosure gate over HTTP", () => {
  const connectBuiltin = (app: Awaited<ReturnType<typeof setup>>["app"], headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: `${P}/accounts`, headers, payload: { products: { calendar: "read" } } });

  it("B51: Continue with Google records {version, acceptedAt: now} BEFORE the flow starts; Continue with an own client records nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
    const { h, app } = await setup({ initial: { [clientKey("bb")]: ownClient("bb", "BB") as never } });
    const own = await app.inject({ method: "POST", url: `${P}/accounts`, payload: { products: { calendar: "read" }, client: "own:bb" } });
    expect(own.statusCode).toBe(200);
    expect(await h.store.getDisclosure()).toBeUndefined();
    expect((await connectBuiltin(app)).statusCode).toBe(409); // not yet accepted
    expect((await app.inject({ method: "PUT", url: `${P}/disclosure` })).statusCode).toBe(200);
    expect(await h.store.getDisclosure()).toEqual({ version: DISCLOSURE_VERSION, acceptedAt: Date.parse("2026-03-01T12:00:00Z") });
    const started = h.started.length;
    expect((await connectBuiltin(app)).statusCode).toBe(200);
    expect(h.started.length).toBe(started + 1);
  });

  it.each([
    ["none", undefined, false],
    ["V-1", DISCLOSURE_VERSION - 1, false],
    ["V", DISCLOSURE_VERSION, true],
    ["V+1 (future: counts as accepted, B8)", DISCLOSURE_VERSION + 1, true],
  ])("B56: stored version %s → built-in connect and product consent %s", async (_n, version, proceeds) => {
    const { h, app } = await setup({ initial: { [acctKey("s1")]: account("s1", "a@x.com", { scopes: [SCOPE.gmailReadonly], products: { gmail: { level: "readonly" } } }) as never } });
    if (version !== undefined) await h.store.acceptDisclosure(version);
    const connect = await connectBuiltin(app);
    const consent = await app.inject({ method: "POST", url: `${P}/accounts/s1/products`, payload: { products: { calendar: { level: "read" } } } });
    if (proceeds) {
      expect(connect.statusCode).toBe(200);
      expect(consent.statusCode).toBe(200);
    } else {
      for (const r of [connect, consent]) {
        expect(r.statusCode).toBe(409);
        expect(r.json()).toMatchObject({ error: "disclosure_required" });
      }
      expect(h.started).toHaveLength(0);
    }
  });

  const refs = {
    builtin: { initial: {}, ref: "builtin", clientId: LOCAL.clientId, browser: "local", client: undefined },
    "builtin-remote": { initial: {}, ref: "builtin-remote", clientId: REMOTE.clientId, browser: "remote", client: undefined },
    "own installed": { initial: { [clientKey("bb")]: ownClient("bb", "BB") }, ref: "own:bb", clientId: OWN_BB.clientId, browser: "local", client: "own:bb" },
    "own web": { initial: { [clientKey("w")]: ownClient("w", "Web", OWN_SEMMI, { type: "web" }) }, ref: "own:w", clientId: OWN_SEMMI.clientId, browser: "remote", client: "own:w" },
  } as const;
  const cells = Object.keys(refs).flatMap((r) => (["new connect", "product consent", "sign in again"] as const).flatMap((op) => ([true, false] as const).map((accepted) => [r as keyof typeof refs, op, accepted] as const)));

  it.each(cells)("B57: %s × %s × disclosure accepted=%s", async (name, op, accepted) => {
    const r = refs[name];
    const { h, app } = await setup({
      initial: {
        ...(r.initial as Record<string, never>),
        [acctKey("s1")]: account("s1", "a@x.com", { client: r.ref, clientId: r.clientId, scopes: [SCOPE.calendarReadonly], products: { calendar: { level: "read" } } }) as never,
      },
    });
    if (accepted) await h.store.acceptDisclosure(DISCLOSURE_VERSION);
    else await h.store.acceptDisclosure(DISCLOSURE_VERSION - 1);
    const headers = r.browser === "remote" ? FWD : {};
    const res =
      op === "new connect"
        ? await app.inject({ method: "POST", url: `${P}/accounts`, headers, payload: { products: { calendar: "read" }, ...(r.client ? { client: r.client } : {}) } })
        : op === "product consent"
          ? await app.inject({ method: "POST", url: `${P}/accounts/s1/products`, headers, payload: { products: { tasks: { level: "read" } } } })
          : await app.inject({ method: "POST", url: `${P}/accounts/s1/reauth`, headers });
    const builtin = r.ref === "builtin" || r.ref === "builtin-remote";
    if (builtin && !accepted) {
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: "disclosure_required" });
      expect(h.started).toHaveLength(0);
    } else {
      expect(res.statusCode, res.body).toBe(200);
      expect(h.started).toHaveLength(1);
    }
  });

  it("B59: after the shipped version moves on, the next built-in connect is refused until PUT /disclosure; own clients are unaffected throughout", async () => {
    const { h, app } = await setup({ initial: { [clientKey("bb")]: ownClient("bb", "BB") as never } });
    await h.store.acceptDisclosure(DISCLOSURE_VERSION - 1); // accepted under the previous text
    expect((await connectBuiltin(app)).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `${P}/accounts`, payload: { products: { calendar: "read" }, client: "own:bb" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: `${P}/disclosure` })).statusCode).toBe(200);
    expect((await h.store.getDisclosure())?.version).toBe(DISCLOSURE_VERSION);
    expect((await connectBuiltin(app)).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `${P}/accounts`, payload: { products: { calendar: "read" }, client: "own:bb" } })).statusCode).toBe(200);
  });

  it("B60: PUT /disclosure from a non-hub-local caller → 403 origin_denied, nothing recorded; an unauthenticated caller is stopped by the guard", async () => {
    const { h, app } = await setup();
    const remote = await app.inject({ method: "PUT", url: `${P}/disclosure`, headers: FWD });
    expect(remote.statusCode).toBe(403);
    expect(remote.json()).toEqual({ error: "origin_denied" });
    expect(await h.store.getDisclosure()).toBeUndefined();
    const guarded = await setup({}, { guardOpen: false });
    for (const [method, url, payload] of [
      ["PUT", `${P}/disclosure`, undefined],
      ["POST", `${P}/accounts`, { products: { calendar: "read" } }],
    ] as const) {
      const r = await guarded.app.inject({ method, url, payload: payload as never });
      expect(r.statusCode, `${method} ${url}`).toBe(403);
      expect(r.json()).toEqual({ error: "network_denied" });
    }
    expect(await guarded.h.store.getDisclosure()).toBeUndefined();
    expect(guarded.h.started).toHaveLength(0);
  });
});

describe("B71–B76 — disconnect", () => {
  const withAccounts = () =>
    setup({ initial: { [acctKey("s1")]: account("s1", "a@x.com", { access: "ACCESS-live" }) as never, [acctKey("s2")]: account("s2", "b@x.com") as never } });
  const del = (app: Awaited<ReturnType<typeof setup>>["app"], sub: string, q = "") => app.inject({ method: "DELETE", url: `${P}/accounts/${sub}${q}` });

  it("B71: without 'also remove at Google' there are zero revoke requests; acct:<sub> is gone and vanishes from GET /state", async () => {
    const { h, app } = await withAccounts();
    const r = await del(app, "s1");
    expect(r.json()).toEqual({ ok: true, removed: true, remoteRevoked: null });
    expect(h.google.revokes).toEqual([]);
    expect(h.creds.data.has(acctKey("s1"))).toBe(false);
    const state = (await app.inject({ method: "GET", url: `${P}/state` })).json();
    expect(state.accounts.map((a: { sub: string }) => a.sub)).toEqual(["s2"]);
  });

  it("B72: with the option and Google answering 200 → one revoke with the grant's token; account deleted; no manual-removal flag", async () => {
    const { h, app } = await withAccounts();
    const r = await del(app, "s1", "?revoke=true");
    expect(r.json()).toEqual({ ok: true, removed: true, remoteRevoked: true });
    expect(h.google.revokes).toEqual(["REFRESH-s1"]);
    expect(h.creds.data.has(acctKey("s1"))).toBe(false);
  });

  it.each([
    ["400", { revokeStatus: 400 }],
    ["500", { revokeStatus: 500 }],
  ])("B73: revoke → %s: the local account is deleted; remoteRevoked:false tells the dialog to point at myaccount.google.com/connections; no token in the answer", async (_n, google) => {
    const { h, app } = await setup({ initial: { [acctKey("s1")]: account("s1", "a@x.com") as never }, google });
    const r = await del(app, "s1", "?revoke=true");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, removed: true, remoteRevoked: false });
    expect(r.body).not.toMatch(/REFRESH|ACCESS/);
    expect(h.creds.data.has(acctKey("s1"))).toBe(false);
  });

  it("B73: a revoke that aborts or hangs past its 5 s bound is the same outcome (never throws, never leaks the token)", async () => {
    const { revokeToken } = await import("../google-oauth.js");
    const ep = { issuer: "i", authorize: "a", token: "t", revoke: "http://127.0.0.1:9/revoke", overridden: true };
    const aborted = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await revokeToken(ep, "REFRESH-s1", aborted)).toBe(false);

    const timeout = new AbortController();
    const spy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const hanging = ((_u: unknown, init?: RequestInit) =>
      new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("t", "TimeoutError"))))) as unknown as typeof fetch;
    const hung = revokeToken(ep, "REFRESH-s1", hanging);
    timeout.abort();
    expect(await hung).toBe(false);
    expect(spy).toHaveBeenCalledWith(5000);
    spy.mockRestore();
  });

  it("B75: disconnecting an account imported from Gmail removes acct:<sub> but imported:gmail still lists the sub", async () => {
    const { h, app } = await setup();
    const legacy: LegacyGmailAccount = { sub: "g1", email: "g@x.com", tier: "send", scopes: [SCOPE.gmailModify], refresh: "LEGACY-REFRESH", access: "LEGACY-ACCESS", expires: 123, status: "ok", addedAt: 7 };
    await createLegacyImporter({ store: h.store, logger: h.logger }).importLegacyGmail({ client: { ...OWN_BB }, accounts: [legacy] });
    expect(h.creds.data.has(acctKey("g1"))).toBe(true);
    const r = await del(app, "g1");
    expect(r.statusCode).toBe(200);
    expect(h.creds.data.has(acctKey("g1"))).toBe(false);
    expect(h.creds.data.get(IMPORTED_GMAIL_KEY)).toMatchObject({ subs: ["g1"] });
  });

  it("B76: disconnecting twice (double click / two tabs) → the second is a clean 404 not_found; nothing resurrects", async () => {
    const { h, app } = await withAccounts();
    expect((await del(app, "s1")).statusCode).toBe(200);
    const second = await del(app, "s1");
    expect(second.statusCode).toBe(404);
    expect(second.json()).toEqual({ error: "not_found" });
    expect(h.creds.data.has(acctKey("s1"))).toBe(false);
    expect((await h.store.list()).map((x) => x.sub)).toEqual(["s2"]);
  });

  it("B76: two simultaneous disconnects never fail with a 5xx and leave the account gone", async () => {
    const { h, app } = await withAccounts();
    const codes = (await Promise.all([del(app, "s1"), del(app, "s1")])).map((r) => r.statusCode);
    for (const c of codes) expect([200, 404]).toContain(c);
    expect(codes).toContain(200);
    expect(h.creds.data.has(acctKey("s1"))).toBe(false);
    expect((await h.store.list()).map((x) => x.sub)).toEqual(["s2"]);
  });
});
