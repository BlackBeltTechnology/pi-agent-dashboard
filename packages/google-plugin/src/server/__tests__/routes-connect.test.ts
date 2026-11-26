/**
 * REST-level connect behaviour: secrets in responses, email validation, local-browser classification, flow lifetime
 * and denial (test-plan B89, B110–B113, B119, B37, B50, B17; scenario-gate B5/B7/B9/B16). See change: add-google-connect.
 */
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { account, makeHarness, OWN_BB, ownClient } from "../../__tests__/fakes.js";
import { SCOPE } from "../../shared/products.js";
import { PendingFlows } from "../pending-flows.js";
import { mountGoogleRoutes } from "../routes.js";
import { acctKey, clientKey } from "../store.js";

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const a of apps.splice(0)) await a.close();
});

const P = "/api/plugins/google";
const REMOTE_HDR = { "x-forwarded-for": "203.0.113.9" };
const cal = [SCOPE.calendarReadonly];
const BB = { [clientKey("bb")]: ownClient("bb", "BB") as never };

async function setup(o: Parameters<typeof makeHarness>[0] = {}) {
  const h = makeHarness(o);
  const app = Fastify();
  apps.push(app);
  await mountGoogleRoutes(app, {
    store: h.store,
    clients: h.clients,
    connect: h.connect,
    networkGuard: async () => {},
    logger: h.logger,
    dashboardBase: () => "https://dash.example.com",
  });
  return { h, app };
}

const connect = (app: Awaited<ReturnType<typeof setup>>["app"], email: unknown, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: `${P}/accounts`, headers, payload: { products: { calendar: "read" }, client: "own:bb", ...(email === undefined ? {} : { email }), ...extra } });

describe("secrets never leave the REST surface (B89)", () => {
  const FORBIDDEN = /^(clientSecret|client_secret|refresh|refresh_token|access|access_token|verifier|code_verifier|codeVerifier)$/;
  const walk = (v: unknown, path = "$"): string[] => {
    if (Array.isArray(v)) return v.flatMap((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => (FORBIDDEN.test(k) ? [`${path}.${k}`] : []).concat(walk(x, `${path}.${k}`)));
    return [];
  };

  it("state, clients, accounts, products, alias and flow responses carry no secret field and no secret value", async () => {
    const { app, h } = await setup({
      initial: { ...BB, [acctKey("s1")]: account("s1", "a@x.com", { client: "own:bb", clientId: OWN_BB.clientId, scopes: cal, products: { calendar: { level: "read" } } }) as never },
      google: { scope: cal },
    });
    const bodies: unknown[] = [];
    const take = async (r: Promise<{ body: string; statusCode: number }>) => {
      const res = await r;
      bodies.push(res.body);
      return res;
    };
    await take(app.inject({ method: "GET", url: `${P}/state` }));
    await take(app.inject({ method: "PUT", url: `${P}/clients`, payload: { json: { installed: { client_id: "n.apps.googleusercontent.com", client_secret: "SECRET-new", redirect_uris: ["http://localhost"], project_id: "p" } } } }));
    await take(connect(app, undefined));
    await take(app.inject({ method: "POST", url: `${P}/accounts/s1/products`, payload: { products: { calendar: null } } }));
    await take(app.inject({ method: "PATCH", url: `${P}/accounts/s1`, payload: { alias: "mine" } }));
    await take(app.inject({ method: "GET", url: `${P}/state` }));
    await h.runFlow(); // the started flow is visible only as a flow id; its verifier stays in the login flow
    const all = bodies.join("\n");
    expect(all).not.toMatch(/SECRET-|REFRESH-|ACCESS-|CODE_VERIFIER|code_verifier/);
    for (const b of bodies) expect(walk(JSON.parse(b as string))).toEqual([]);
    const state = JSON.parse(bodies[0] as string) as { clients?: Array<Record<string, unknown>> };
    for (const c of state.clients ?? []) expect(Object.keys(c).filter((k) => /secret/i.test(k)).every((k) => k === "hasSecret")).toBe(true);
  });
});

describe("email validation on connect (B110–B113; GB16)", () => {
  const local = (n: number) => `${"a".repeat(n - "@x.com".length)}@x.com`;

  it("B110: 253 and 254 characters are accepted and sent as login_hint; 255 → 400", async () => {
    for (const n of [253, 254]) {
      const { app, h } = await setup({ initial: BB, google: { scope: cal } });
      const r = await connect(app, local(n));
      expect(r.statusCode).toBe(200);
      const { url } = await h.runFlow();
      expect(url.searchParams.get("login_hint")).toBe(local(n));
    }
    const { app, h } = await setup({ initial: BB });
    const r = await connect(app, local(255));
    expect([r.statusCode, r.json().error]).toEqual([400, "invalid_email"]);
    expect(h.started).toHaveLength(0);
  });

  it("B111: malformed emails → 400 each, no flow is created, no injected parameter reaches an auth URL", async () => {
    const { app, h } = await setup({ initial: BB });
    for (const bad of ["not-an-email", "a b@x.com", "a@", "@x.com", 123, ["a@x.com"], "a@x.com\nprompt=none", "a@@x.com", "a@x"]) {
      const r = await connect(app, bad);
      expect([JSON.stringify(bad), r.statusCode, r.json().error]).toEqual([JSON.stringify(bad), 400, "invalid_email"]);
    }
    expect(h.started).toHaveLength(0);
    expect(h.oauth.startFlow).not.toHaveBeenCalled();
  });

  it("B111: an address with `&` or `=` is encoded into login_hint and never adds an auth parameter", async () => {
    const { app, h } = await setup({ initial: BB, google: { scope: cal } });
    expect((await connect(app, "a@x.com&prompt=none")).statusCode).toBe(200);
    const { url } = await h.runFlow();
    expect(url.searchParams.get("prompt")).toBe("select_account consent");
    expect(url.searchParams.getAll("prompt")).toHaveLength(1);
    expect(url.search).toContain("login_hint=a%40x.com%26prompt%3Dnone");
  });

  it("GB16: one @, non-empty local part, domain with a dot, no whitespace, ≤ 254; the empty string means not given", async () => {
    const { app, h } = await setup({ initial: BB, google: { scope: cal } });
    expect((await connect(app, "")).statusCode).toBe(200);
    expect((await h.runFlow()).url.searchParams.has("login_hint")).toBe(false);
    expect((await connect(app, "x@y.co")).statusCode).toBe(200);
    for (const bad of ["x@y", "x y@z.co", " ", "x@y@z.co"]) expect((await connect(app, bad)).json().error).toBe("invalid_email");
  });

  it("B112: `a+tag@x.com` and `é@x.com` are URL-encoded correctly and login_hint appears exactly once", async () => {
    for (const [email, encoded] of [["a+tag@x.com", "a%2Btag%40x.com"], ["é@x.com", "%C3%A9%40x.com"]] as const) {
      const { app, h } = await setup({ initial: BB, google: { scope: cal } });
      expect((await connect(app, email)).statusCode).toBe(200);
      const { url } = await h.runFlow();
      expect(url.search.match(/login_hint=/g)).toHaveLength(1);
      expect(url.search).toContain(`login_hint=${encoded}`);
      expect(url.searchParams.get("login_hint")).toBe(email);
    }
  });

  it("B113: no email → the flow starts without login_hint", async () => {
    const { app, h } = await setup({ initial: BB, google: { scope: cal } });
    expect((await connect(app, undefined)).statusCode).toBe(200);
    expect((await h.runFlow()).url.searchParams.has("login_hint")).toBe(false);
  });
});

describe("local-browser consent over HTTP (B119)", () => {
  it("B119: a tunnel request from 127.0.0.1 with X-Forwarded-For is remote → 409 local_browser_required, no flow", async () => {
    const { app, h } = await setup({
      initial: { [acctKey("s1")]: account("s1", "a@x.com", { client: "builtin", scopes: cal, products: { calendar: { level: "read" } } }) as never },
    });
    await h.connect.acceptDisclosure();
    for (const headers of [REMOTE_HDR, { "x-forwarded-host": "dash.example.com" }, { forwarded: "for=203.0.113.9" }]) {
      const before = h.started.length;
      const r = await app.inject({ method: "POST", url: `${P}/accounts/s1/products`, headers, payload: { products: { tasks: "read" } }, remoteAddress: "127.0.0.1" });
      expect([r.statusCode, r.json().error]).toEqual([409, "local_browser_required"]);
      expect(h.started).toHaveLength(before);
    }
    // The same call from the local browser is not refused for that reason (it starts the consent flow).
    const local = await app.inject({ method: "POST", url: `${P}/accounts/s1/products`, payload: { products: { tasks: "read" } } });
    expect(local.json().error).not.toBe("local_browser_required");
    expect(h.started).toHaveLength(1);
  });
});

describe("flow lifetime, denial and the own-client dialog (GB5, GB7, GB9)", () => {
  it("GB5: a pending sign-in expires after exactly 300 s with code `timeout` (the dialog maps it to \"Sign-in timed out — try again\")", async () => {
    vi.useFakeTimers();
    const f = new PendingFlows().create({});
    const settled = f.result.then(() => "ok", (e: { code?: string }) => e.code);
    await vi.advanceTimersByTimeAsync(299_000);
    let state = "pending";
    void settled.then((v) => (state = String(v)));
    await vi.advanceTimersByTimeAsync(0);
    expect(state).toBe("pending");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await settled).toBe("timeout");
  });

  it("GB7: an own client shows no disclosure and records nothing about it", async () => {
    const { app, h } = await setup({ initial: BB, google: { scope: cal } });
    const r = await connect(app, undefined);
    expect([r.statusCode, r.json().error]).toEqual([200, undefined]);
    await h.runFlow();
    expect([...h.creds.data.keys()].some((k) => k.startsWith("disclosure"))).toBe(false);
    expect(await h.connect.disclosureAccepted()).toBe(false);
  });

  it("GB9: the user denies consent on the pasted redirect → the flow ends `access_denied`, nothing is stored", async () => {
    const { h } = await setup({ initial: BB, google: { scope: cal } });
    await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "remote" });
    const events: Array<{ type: string; url?: string }> = [];
    let paste!: (v: string) => void;
    const login = h.started[0]!.loginFlow.login({
      signal: new AbortController().signal,
      prompt: () => new Promise<string>((r) => { paste = r; }),
      notify: (e) => events.push(e as never),
    });
    login.catch(() => {});
    await vi.waitFor(() => expect(events.some((e) => e.type === "auth_url")).toBe(true));
    const url = new URL(events.find((e) => e.type === "auth_url")!.url as string);
    paste(`${url.searchParams.get("redirect_uri")}?error=access_denied&state=${encodeURIComponent(url.searchParams.get("state") as string)}`);
    await expect(login).rejects.toMatchObject({ code: "access_denied" });
    expect(await h.store.list()).toEqual([]);
  });
});

describe("Drive levels need an own client (C41)", () => {
  const withDrive = (client: string, extra = {}) => ({
    ...extra,
    [acctKey("s1")]: account("s1", "a@x.com", { client, clientId: client === "own:bb" ? OWN_BB.clientId : undefined, scopes: [SCOPE.driveFile], products: { drive: { level: "files" } } }) as never,
  });
  const save = (app: Awaited<ReturnType<typeof setup>>["app"], level: string, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: `${P}/accounts/s1/products`, headers, payload: { products: { drive: level } } });

  for (const [client, headers] of [["builtin", {}], ["builtin-remote", REMOTE_HDR]] as const) {
    it(`#GC7 ${client}: read and write are refused (400 own_client_required) and the levels stay unchanged`, async () => {
      const { app, h } = await setup({ initial: withDrive(client) });
      await h.connect.acceptDisclosure();
      for (const level of ["read", "write"]) {
        const r = await save(app, level, headers);
        expect([level, r.statusCode, r.json().error]).toEqual([level, 400, "own_client_required"]);
      }
      expect(await h.store.get("s1")).toMatchObject({ products: { drive: { level: "files" } } });
      expect(h.started).toHaveLength(0);
    });
  }

  it("an own-client account may raise Drive to read and write (a consent flow starts)", async () => {
    for (const level of ["read", "write"]) {
      const { app, h } = await setup({ initial: withDrive("own:bb", BB) });
      const r = await save(app, level);
      expect([level, r.statusCode, r.json().error]).toEqual([level, 200, undefined]);
      expect(h.started).toHaveLength(1);
    }
  });
});
