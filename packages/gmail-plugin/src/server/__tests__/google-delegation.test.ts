/**
 * Gmail's soft link to Google Connect (add-google-connect D1/D10; spec gmail-plugin › "Gmail accounts come from
 * Google Connect", "Legacy Gmail data migrates"): the first request after start hands the legacy data over
 * exactly once, then `gmail/lease` + `gmail/accounts` answer `{delegate:"google"}`; a partial or failed hand-off
 * keeps Gmail leasing from its own data; an imported account that was disconnected is never served from legacy
 * tokens. The importer is a structural fake (no import edge to the google plugin).
 */
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { CLIENT, capturingLogger, memoryCredentials } from "../../__tests__/fakes.js";
import { AccountStore, CLIENT_KEY } from "../accounts.js";
import { createGoogleLink } from "../google-link.js";
import registerPlugin from "../index.js";

type Importer = { importLegacyGmail: ReturnType<typeof vi.fn> };
type ImportResult = { ok: true; imported: number; skipped: number } | { ok: false; error: string };

const rec = (sub: string, over: Record<string, unknown> = {}) => ({
  sub,
  email: `${sub}@x.com`,
  tier: "readonly",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  refresh: "REFRESH-SECRET",
  access: "ACCESS-legacy",
  expires: Date.now() + 3_600_000,
  status: "ok",
  addedAt: 1,
  ...over,
});

const importer = (result: ImportResult | (() => Promise<ImportResult>) = { ok: true, imported: 2, skipped: 0 }): Importer => ({
  importLegacyGmail: vi.fn(async () => (typeof result === "function" ? result() : result)),
});

const entry = (value: Importer, provider = "google") => [{ provider, value }];

interface Boot {
  handlers: Map<string, (payload: unknown, meta: unknown) => Promise<unknown>>;
  app: ReturnType<typeof Fastify>;
  creds: ReturnType<typeof memoryCredentials>;
  logger: ReturnType<typeof capturingLogger>;
}

async function boot(opts: { accounts?: string[]; consumeAll?: () => unknown; creds?: ReturnType<typeof memoryCredentials> } = {}): Promise<Boot> {
  const accounts = opts.accounts ?? ["s1", "s2"];
  const creds =
    opts.creds ?? memoryCredentials({ [CLIENT_KEY]: { ...CLIENT }, ...Object.fromEntries(accounts.map((s) => [`acct:${s}`, rec(s)])) });
  const logger = capturingLogger();
  const app = Fastify();
  const handlers = new Map<string, (payload: unknown, meta: unknown) => Promise<unknown>>();
  await registerPlugin({
    credentials: creds,
    logger,
    fastify: app,
    networkGuard: async () => {},
    consume: () => undefined,
    consumeAll: opts.consumeAll,
    getPluginConfig: () => ({}),
    updatePluginConfig: async () => {},
    registerPiRequestHandler: (type: string, h: (p: unknown, m: unknown) => Promise<unknown>) => handlers.set(type, h),
    oauth: undefined,
  } as never);
  return { handlers, app, creds, logger };
}

const lease = (b: Boot, payload: unknown = { account: "s1@x.com", op: "read" }) => b.handlers.get("gmail/lease")?.(payload, { sessionId: "S" }) as Promise<unknown>;
const list = (b: Boot) => b.handlers.get("gmail/accounts")?.({}, { sessionId: "S" }) as Promise<unknown>;
const DELEGATE = { delegate: "google" };

describe("delegation once the legacy accounts are in Google Connect (B124)", () => {
  it("gmail/lease and gmail/accounts reply {delegate:'google'} — no token, no account row", async () => {
    const imp = importer();
    const b = await boot({ consumeAll: () => entry(imp) });
    expect(await lease(b)).toEqual(DELEGATE);
    expect(await list(b)).toEqual(DELEGATE);
    await b.app.close();
  });

  it("a malformed lease request is still refused (bad_request), not delegated", async () => {
    const b = await boot({ consumeAll: () => entry(importer()) });
    await expect(lease(b, { op: "read" })).rejects.toThrow(/bad_request/);
    await expect(lease(b, { account: "s1@x.com", op: "root" })).rejects.toThrow(/bad_request/);
    await expect(lease(b, { account: "  ", op: "read" })).rejects.toThrow(/bad_request/);
    await b.app.close();
  });

  it("both lanes stay hub-local-only while delegating", async () => {
    const app = Fastify();
    const register = vi.fn();
    await registerPlugin({
      credentials: memoryCredentials({ [CLIENT_KEY]: { ...CLIENT } }),
      logger: capturingLogger(),
      fastify: app,
      networkGuard: async () => {},
      consumeAll: () => entry(importer()),
      getPluginConfig: () => ({}),
      updatePluginConfig: async () => {},
      registerPiRequestHandler: register,
    } as never);
    await app.close();
    expect(register.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ["gmail/lease", { hubLocalOnly: true }],
      ["gmail/accounts", { hubLocalOnly: true }],
    ]);
  });
});

describe("at-most-once import (B142)", () => {
  it("the hand-off happens at the FIRST request, not at start, and only once for any number of requests", async () => {
    const imp = importer();
    const b = await boot({ consumeAll: () => entry(imp) });
    expect(imp.importLegacyGmail).not.toHaveBeenCalled();
    await Promise.all([lease(b), list(b), lease(b), b.app.inject({ method: "GET", url: "/api/plugins/gmail/state" })]);
    await lease(b);
    expect(imp.importLegacyGmail).toHaveBeenCalledTimes(1);
    await b.app.close();
  });

  it("hands over the legacy client + every account, writes the marker only after success, deletes nothing", async () => {
    const imp = importer();
    const b = await boot({ consumeAll: () => entry(imp) });
    const before = await b.creds.snapshot();
    await lease(b);
    const arg = imp.importLegacyGmail.mock.calls[0]?.[0] as { client: unknown; accounts: Array<{ sub: string }> };
    expect(arg.client).toMatchObject({ clientId: CLIENT.clientId });
    expect(arg.accounts.map((a) => a.sub).sort()).toEqual(["s1", "s2"]);
    const after = await b.creds.snapshot();
    expect(after.migrated).toMatchObject({ version: 1, subs: expect.arrayContaining(["s1", "s2"]) });
    expect(typeof (after.migrated as { at: unknown }).at).toBe("number");
    const { migrated: _m, ...rest } = after;
    expect(rest).toEqual(before);
    await b.app.close();
  });

  it("a restart with the marker present does not import again; a legacy account added later is handed over alone", async () => {
    const creds = memoryCredentials({ [CLIENT_KEY]: { ...CLIENT }, "acct:s1": rec("s1") });
    const first = importer({ ok: true, imported: 1, skipped: 0 });
    await (await boot({ creds, consumeAll: () => entry(first) })).handlers.get("gmail/lease")?.({ account: "s1", op: "read" }, {});
    expect(first.importLegacyGmail).toHaveBeenCalledTimes(1);

    const second = importer({ ok: true, imported: 0, skipped: 0 });
    const b2 = await boot({ creds, consumeAll: () => entry(second) });
    expect(await lease(b2)).toEqual(DELEGATE);
    expect(second.importLegacyGmail).not.toHaveBeenCalled();

    await creds.set("acct:s3", rec("s3") as never);
    const third = importer({ ok: true, imported: 1, skipped: 0 });
    const b3 = await boot({ creds, consumeAll: () => entry(third) });
    expect(await lease(b3)).toEqual(DELEGATE);
    expect(third.importLegacyGmail).toHaveBeenCalledTimes(1);
  });

  it("an empty legacy namespace imports nothing and leaves no marker, yet delegates", async () => {
    const creds = memoryCredentials({});
    const imp = importer();
    const b = await boot({ creds, accounts: [], consumeAll: () => entry(imp) });
    expect(await list(b)).toEqual(DELEGATE);
    expect(imp.importLegacyGmail).not.toHaveBeenCalled();
    expect(await creds.get("migrated")).toBeUndefined();
    await b.app.close();
  });
});

describe("no fallback to legacy tokens for an imported account (GB18, B128)", () => {
  it("an imported account that is disconnected in Google Connect still gets the delegation, never legacy tokens", async () => {
    const imp = importer();
    const b = await boot({ consumeAll: () => entry(imp) });
    expect(await lease(b)).toEqual(DELEGATE);
    // The user disconnects s1 in Google Connect: Gmail's own copy is untouched (never deleted) …
    expect(await b.creds.get("acct:s1")).toBeTruthy();
    // … yet every later request — any account, any op — still answers the delegation, with no token in it.
    for (const account of ["s1@x.com", "s1", "ghost@x.com"]) {
      const reply = await lease(b, { account, op: "read" });
      expect(reply).toEqual(DELEGATE);
      expect(JSON.stringify(reply)).not.toMatch(/REFRESH|ACCESS|accessToken/);
    }
    expect(imp.importLegacyGmail).toHaveBeenCalledTimes(1);
    await b.app.close();
  });
});

describe("partial / failed hand-off keeps legacy leasing (B143)", () => {
  it("skipped accounts → legacy leasing + legacy account list, no marker, routes still moved, retried on next start", async () => {
    const creds = memoryCredentials({ [CLIENT_KEY]: { ...CLIENT }, "acct:s1": rec("s1"), "acct:s2": rec("s2") });
    const partial = importer({ ok: true, imported: 1, skipped: 1 });
    const b = await boot({ creds, consumeAll: () => entry(partial) });
    expect(await lease(b)).toMatchObject({ accessToken: "ACCESS-legacy", email: "s1@x.com", tier: "readonly" });
    expect(await list(b)).toHaveLength(2);
    expect(await creds.get("migrated")).toBeUndefined();
    expect((await b.app.inject({ method: "GET", url: "/api/plugins/gmail/accounts" })).statusCode).toBe(410);
    expect(partial.importLegacyGmail).toHaveBeenCalledTimes(1);
    expect(b.logger.warns.some((w) => w.includes("incomplete"))).toBe(true);

    const full = importer({ ok: true, imported: 2, skipped: 0 });
    const b2 = await boot({ creds, consumeAll: () => entry(full) });
    expect(await lease(b2)).toEqual(DELEGATE);
    expect(full.importLegacyGmail).toHaveBeenCalledTimes(1);
  });

  it("an importer that answers {ok:false} behaves like a partial import", async () => {
    const b = await boot({ consumeAll: () => entry(importer({ ok: false, error: "too_many_keys" })) });
    expect(await lease(b)).toMatchObject({ accessToken: "ACCESS-legacy" });
    expect(await b.creds.get("migrated")).toBeUndefined();
    await b.app.close();
  });

  it("an importer that throws: Gmail leases from legacy data, one attempt per process, no marker", async () => {
    const imp = importer(async () => {
      throw new Error("store_locked");
    });
    const b = await boot({ consumeAll: () => entry(imp) });
    expect(await lease(b)).toMatchObject({ accessToken: "ACCESS-legacy" });
    expect(await lease(b)).toMatchObject({ accessToken: "ACCESS-legacy" });
    expect(await list(b)).toHaveLength(2);
    expect(imp.importLegacyGmail).toHaveBeenCalledTimes(1);
    expect(await b.creds.get("migrated")).toBeUndefined();
    expect(b.logger.warns.join("\n")).not.toContain("REFRESH-SECRET");
    await b.app.close();
  });
});

describe("Gmail declares no hard dependency: the link is soft (B140)", () => {
  it("no google.connect entry → legacy leasing, routes 503, /state says unavailable", async () => {
    const b = await boot({ consumeAll: () => [] });
    expect(await lease(b)).toMatchObject({ accessToken: "ACCESS-legacy" });
    expect((await b.app.inject({ method: "POST", url: "/api/plugins/gmail/accounts", payload: {} })).statusCode).toBe(503);
    expect((await b.app.inject({ method: "GET", url: "/api/plugins/gmail/state" })).json()).toEqual({ moved: false, googleConnect: "unavailable" });
    await b.app.close();
  });

  it("a host without consumeAll behaves the same", async () => {
    const b = await boot({});
    expect(await lease(b)).toMatchObject({ accessToken: "ACCESS-legacy" });
    await b.app.close();
  });

  it("an entry whose provider is not `google` is ignored and handed nothing", async () => {
    const imp = importer();
    const b = await boot({ consumeAll: () => entry(imp, "evil") });
    expect(await lease(b)).toMatchObject({ accessToken: "ACCESS-legacy" });
    expect(imp.importLegacyGmail).not.toHaveBeenCalled();
    await b.app.close();
  });

  it("an entry without importLegacyGmail is ignored", async () => {
    const b = await boot({ consumeAll: () => [{ provider: "google", value: {} }] });
    expect(await lease(b)).toMatchObject({ accessToken: "ACCESS-legacy" });
    await b.app.close();
  });
});

describe("createGoogleLink directly", () => {
  it("memoises one state per process and reports usable/delegating", async () => {
    const imp = importer();
    const store = new AccountStore(memoryCredentials({ [CLIENT_KEY]: { ...CLIENT }, "acct:s1": rec("s1") }));
    const link = createGoogleLink({ consumeAll: () => entry(imp) as never, store, logger: capturingLogger() });
    const [a, b] = await Promise.all([link.ensure(), link.ensure()]);
    expect(a).toEqual({ usable: true, delegating: true });
    expect(b).toBe(a);
    expect(imp.importLegacyGmail).toHaveBeenCalledTimes(1);
  });
});
