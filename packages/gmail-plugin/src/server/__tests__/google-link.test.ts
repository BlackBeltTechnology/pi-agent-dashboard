/**
 * Gmail's soft link to Google Connect through the real plugin entry (test-plan B126, B132–B135, B137–B138, B141–B148,
 * B154; scenario-gate B18/B20/B25): which provider is trusted, when the legacy hand-off runs, what the lanes answer,
 * and that the management routes refuse with 410/503 while storing nothing. See change: add-google-connect.
 */
import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { CLIENT, capturingLogger, memoryCredentials } from "../../__tests__/fakes.js";
import { CLIENT_KEY } from "../accounts.js";
import registerPlugin from "../index.js";

const scopes = ["https://www.googleapis.com/auth/gmail.readonly"];
const rec = (sub: string, over: Record<string, unknown> = {}) => ({
  sub, email: `${sub}@canary.example`, alias: `alias-${sub}`, tier: "readonly", scopes,
  refresh: `REFRESH-${sub}`, access: `ACCESS-${sub}`, expires: Date.now() + 3_600_000, status: "ok", addedAt: 1, ...over,
});

type Importer = (snap: { client?: unknown; accounts: Array<{ sub: string }> }) => Promise<{ ok: true; imported: number; skipped: number } | { ok: false; error: string }>;
type Providers = Array<{ provider: string; importLegacyGmail: Importer }>;
type Handler = (payload: unknown, meta: unknown) => Promise<unknown>;

const okImporter = () => vi.fn<Importer>(async (s) => ({ ok: true, imported: s.accounts.length, skipped: 0 }));
const google = (importLegacyGmail: Importer = okImporter()) => ({ provider: "google", importLegacyGmail });
const evil = (importLegacyGmail: Importer = okImporter()) => ({ provider: "evil", importLegacyGmail });

/** One server start: the plugin entry against a shared credential namespace. `providers()` is read per request. */
async function start(creds: ReturnType<typeof memoryCredentials>, providers: () => Providers, opts: { registered?: Array<[string, unknown]> } = {}) {
  const app = Fastify();
  const handlers = new Map<string, Handler>();
  const logger = capturingLogger();
  await registerPlugin({
    credentials: creds, logger, fastify: app, networkGuard: async () => {}, consume: () => undefined,
    consumeAll: () => providers().map((p) => ({ provider: p.provider, value: { importLegacyGmail: p.importLegacyGmail } })),
    getPluginConfig: () => ({}), updatePluginConfig: async () => {}, oauth: undefined,
    registerPiRequestHandler: (type: string, h: Handler, o: unknown) => {
      handlers.set(type, h);
      opts.registered?.push([type, o]);
    },
  } as never);
  await app.ready();
  return { app, logger, lease: (account = "alias-s1") => handlers.get("gmail/lease")!({ account, op: "read" }, { sessionId: "S" }), accounts: () => handlers.get("gmail/accounts")!({}, { sessionId: "S" }) };
}

const withLegacy = (...subs: string[]) =>
  memoryCredentials({ [CLIENT_KEY]: { ...CLIENT }, ...Object.fromEntries(subs.map((s) => [`acct:${s}`, rec(s)])) } as never);
const snapshotOf = (c: ReturnType<typeof memoryCredentials>) => JSON.stringify([...c.data.entries()].filter(([k]) => k !== "migrated").sort());

describe("Google Connect usable: Gmail delegates (B126)", () => {
  it("B126: gmail/lease answers {delegate:\"google\"} with no token; both lanes stay hub-local-only", async () => {
    const registered: Array<[string, unknown]> = [];
    const s = await start(withLegacy("s1"), () => [google()], { registered });
    const reply = await s.lease();
    expect(reply).toEqual({ delegate: "google" });
    expect(JSON.stringify(reply)).not.toMatch(/ACCESS|REFRESH|accessToken/);
    expect(await s.accounts()).toEqual({ delegate: "google" });
    expect(Object.fromEntries(registered)).toEqual({ "gmail/lease": { hubLocalOnly: true }, "gmail/accounts": { hubLocalOnly: true } });
    await s.app.close();
  });
});

describe("Gmail works without Google Connect (B132–B135)", () => {
  it("B132: with `google` absent the plugin loads and leases from the legacy namespace; no delegate reply", async () => {
    const s = await start(withLegacy("s1"), () => []);
    expect(await s.lease()).toMatchObject({ accessToken: "ACCESS-s1", email: "s1@canary.example", tier: "readonly" });
    expect(await s.accounts()).toEqual([expect.objectContaining({ sub: "s1", alias: "alias-s1" })]);
    await s.app.close();
  });

  it("B133: another plugin providing google.connect is ignored — no import call to it, no delegation, legacy leasing continues", async () => {
    const bad = okImporter();
    const s = await start(withLegacy("s1"), () => [evil(bad)]);
    expect(await s.lease()).toMatchObject({ accessToken: "ACCESS-s1" });
    expect(bad).not.toHaveBeenCalled();
    await s.app.close();
  });

  it("B134: enabling `google` after Gmail started changes nothing until a restart; after the restart Gmail delegates", async () => {
    const creds = withLegacy("s1");
    let present = false;
    const imp = okImporter();
    const s = await start(creds, () => (present ? [google(imp)] : []));
    expect(await s.lease()).toMatchObject({ accessToken: "ACCESS-s1" });
    present = true;
    expect(await s.lease()).toMatchObject({ accessToken: "ACCESS-s1" });
    expect(imp).not.toHaveBeenCalled();
    await s.app.close();
    const restarted = await start(creds, () => [google(imp)]);
    expect(await restarted.lease()).toEqual({ delegate: "google" });
    await restarted.app.close();
  });

  for (const order of ["google-first", "evil-first"] as const) {
    it(`B135: with both providers registered (${order}) only \`google\` is used`, async () => {
      const g = okImporter();
      const e = okImporter();
      const s = await start(withLegacy("s1"), () => (order === "google-first" ? [google(g), evil(e)] : [evil(e), google(g)]));
      expect(await s.lease()).toEqual({ delegate: "google" });
      expect(g).toHaveBeenCalledTimes(1);
      expect(e).not.toHaveBeenCalled();
      await s.app.close();
    });
  }
});

describe("legacy Gmail data migrates (B142–B148; G20)", () => {
  it("B142: nothing at start; the first request hands the data over once, writes migrated:{at,version}, deletes nothing", async () => {
    const creds = withLegacy("s1", "s2");
    const imp = okImporter();
    const before = snapshotOf(creds);
    const s = await start(creds, () => [google(imp)]);
    expect(imp).not.toHaveBeenCalled();
    expect(creds.data.has("migrated")).toBe(false);
    await s.lease();
    await s.lease();
    expect(imp).toHaveBeenCalledTimes(1);
    expect(imp.mock.calls[0]?.[0].accounts.map((a) => a.sub).sort()).toEqual(["s1", "s2"]);
    expect(creds.data.get("migrated")).toMatchObject({ at: expect.any(Number), version: 1 });
    expect(snapshotOf(creds)).toBe(before);
    await s.app.close();
  });

  it("B143: a failing hand-off writes no marker, Gmail leases from legacy data, and there is no second attempt in this process", async () => {
    const creds = withLegacy("s1");
    const boom = vi.fn<Importer>(async () => {
      throw new Error("store locked");
    });
    const s = await start(creds, () => [google(boom)]);
    expect(await s.lease()).toMatchObject({ accessToken: "ACCESS-s1" });
    expect(await s.lease()).toMatchObject({ accessToken: "ACCESS-s1" });
    expect(boom).toHaveBeenCalledTimes(1);
    expect(creds.data.has("migrated")).toBe(false);
    expect(s.logger.warns.join("\n")).not.toMatch(/ACCESS|REFRESH|canary/);
    await s.app.close();
  });

  it("B144: a failed first start then a good restart → the import succeeds, the marker is written, legacy data is still there", async () => {
    const creds = withLegacy("s1");
    const s1 = await start(creds, () => [google(async () => ({ ok: false, error: "too_many_keys" }))]);
    expect(await s1.lease()).toMatchObject({ accessToken: "ACCESS-s1" });
    await s1.app.close();
    expect(creds.data.has("migrated")).toBe(false);
    const imp = okImporter();
    const s2 = await start(creds, () => [google(imp)]);
    expect(await s2.lease()).toEqual({ delegate: "google" });
    expect(imp).toHaveBeenCalledTimes(1);
    expect(creds.data.get("migrated")).toBeDefined();
    expect(creds.data.get("acct:s1")).toBeDefined();
    expect(creds.data.get(CLIENT_KEY)).toBeDefined();
    await s2.app.close();
  });

  it("B145: with the marker covering every legacy account there is no import call; Gmail delegates", async () => {
    const creds = withLegacy("s1");
    creds.data.set("migrated", { at: 1, version: 1, subs: ["s1"] } as never);
    const imp = okImporter();
    const s = await start(creds, () => [google(imp)]);
    expect(await s.lease()).toEqual({ delegate: "google" });
    expect(imp).not.toHaveBeenCalled();
    await s.app.close();
  });

  it("B146: a legacy account added while Google was off is handed over at the next start (G20); the marker grows", async () => {
    const creds = withLegacy("s1", "s2");
    creds.data.set("migrated", { at: 1, version: 1, subs: ["s1"] } as never);
    const imp = okImporter();
    const s = await start(creds, () => [google(imp)]);
    expect(await s.lease()).toEqual({ delegate: "google" });
    expect(imp).toHaveBeenCalledTimes(1);
    expect((creds.data.get("migrated") as unknown as { subs: string[] }).subs.sort()).toEqual(["s1", "s2"]);
    await s.app.close();
  });

  it("B147: an empty legacy namespace → no import call, no marker, no error; Gmail still delegates (G20)", async () => {
    const creds = memoryCredentials({});
    const imp = okImporter();
    const s = await start(creds, () => [google(imp)]);
    expect(await s.accounts()).toEqual({ delegate: "google" });
    expect(imp).not.toHaveBeenCalled();
    expect(creds.data.has("migrated")).toBe(false);
    expect(s.logger.warns).toEqual([]);
    await s.app.close();
  });

  it("B148: after a successful migration, disabling `google` and restarting → Gmail leases from the intact legacy tokens", async () => {
    const creds = withLegacy("s1");
    const s1 = await start(creds, () => [google()]);
    expect(await s1.lease()).toEqual({ delegate: "google" });
    await s1.app.close();
    const s2 = await start(creds, () => []);
    expect(await s2.lease()).toMatchObject({ accessToken: "ACCESS-s1", email: "s1@canary.example" });
    expect(creds.data.get("acct:s1")).toMatchObject({ refresh: "REFRESH-s1" });
    await s2.app.close();
  });
});

describe("management routes while moved / unavailable (B137, B138, B141, B154; GB25)", () => {
  const MANAGEMENT: Array<[string, string]> = [
    ["PUT", "/client"], ["PUT", "/setup"], ["GET", "/accounts"], ["POST", "/accounts"], ["PATCH", "/accounts/s1"], ["DELETE", "/accounts/s1"],
    ["POST", "/accounts/s1/level"], ["POST", "/accounts/s1/reauth"], ["POST", "/accounts/s1/filters"],
    ["POST", "/setup/run"], ["GET", "/setup/run/r1"], ["POST", "/setup/run/r1/continue"], ["POST", "/setup/run/r1/takeover"], ["DELETE", "/setup/run/r1"],
  ];
  const call = (s: Awaited<ReturnType<typeof start>>, [method, url]: [string, string]) =>
    s.app.inject({ method: method as "GET", url: `/api/plugins/gmail${url}`, payload: method === "GET" || method === "DELETE" ? undefined : { x: 1 } });

  it("B137: while Google Connect is usable every management route answers 410 {error:\"moved\"}; the store is unchanged byte for byte", async () => {
    const creds = withLegacy("s1");
    const s = await start(creds, () => [google()]);
    await s.app.inject({ method: "GET", url: "/api/plugins/gmail/state" }); // first request: the hand-off (and its marker) happens here
    const before = JSON.stringify([...creds.data.entries()]);
    const results = await Promise.all(MANAGEMENT.map((m) => call(s, m)));
    for (const [i, r] of results.entries()) expect([MANAGEMENT[i], r.statusCode, r.json()]).toEqual([MANAGEMENT[i], 410, { error: "moved" }]);
    expect(JSON.stringify([...creds.data.entries()])).toBe(before);
    await s.app.close();
  });

  it("B138: with `google` unavailable the same calls answer 503 {error:\"google_connect_unavailable\"}; legacy data unchanged, tools still work", async () => {
    const creds = withLegacy("s1");
    const s = await start(creds, () => []);
    const before = JSON.stringify([...creds.data.entries()]);
    const results = await Promise.all(MANAGEMENT.map((m) => call(s, m)));
    for (const [i, r] of results.entries()) expect([MANAGEMENT[i], r.statusCode, r.json()]).toEqual([MANAGEMENT[i], 503, { error: "google_connect_unavailable" }]);
    expect(JSON.stringify([...creds.data.entries()])).toBe(before);
    expect(await s.lease()).toMatchObject({ accessToken: "ACCESS-s1" });
    await s.app.close();
  });

  it("B154: the old setup paths answer 410 `moved` while usable and 503 while unavailable; no run is started", async () => {
    for (const [providers, code, body] of [
      [() => [google()], 410, { error: "moved" }],
      [() => [], 503, { error: "google_connect_unavailable" }],
    ] as const) {
      const s = await start(withLegacy("s1"), providers as () => Providers);
      for (const m of MANAGEMENT.filter(([, u]) => u.startsWith("/setup"))) {
        const r = await call(s, m);
        expect([r.statusCode, r.json()]).toEqual([code, body]);
      }
      await s.app.close();
    }
  });

  it("B141/GB25: only management routes moved — `GET /state` stays 200 (moved:true), and the lease lane is unaffected by the 410 rule", async () => {
    const s = await start(withLegacy("s1"), () => [google()]);
    const state = await s.app.inject({ method: "GET", url: "/api/plugins/gmail/state" });
    expect([state.statusCode, state.json()]).toEqual([200, { moved: true }]);
    expect(await s.lease()).toEqual({ delegate: "google" });
    const off = await start(withLegacy("s1"), () => []);
    const offState = await off.app.inject({ method: "GET", url: "/api/plugins/gmail/state" });
    expect([offState.statusCode, offState.json()]).toMatchObject([200, { moved: false }]);
    await s.app.close();
    await off.app.close();
  });
});

describe("Gmail declares no hard dependency on Google Connect (GB19)", () => {
  it("GB19: the plugin manifest has no dependsOn naming `google` — the link is soft, a missing `google` never skips Gmail", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as Record<string, unknown>;
    const plugin = (manifest["pi-dashboard-plugin"] ?? manifest.piDashboardPlugin ?? manifest) as { dependsOn?: unknown };
    expect(JSON.stringify(plugin.dependsOn ?? [])).not.toMatch(/google/);
    expect(JSON.stringify(manifest)).not.toMatch(/"dependsOn"\s*:\s*[\[{][^\]}]*google/);
  });
});
