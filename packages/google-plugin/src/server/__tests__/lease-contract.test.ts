/**
 * `google/lease` + `google/accounts` contract (test-plan A79–A82, B1–B9): per-product / per-level refusals,
 * secret-free replies, the host's origin gate on both lanes, per-account single-flight and refresh failure
 * handling. Complements `lease.test.ts`. See change: add-google-connect.
 */
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { account, capturingLogger, fakeGoogleFetch, LOCAL, memoryCredentials, OWN_BB, ownClient, REMOTE, TEST_ENDPOINTS } from "../../__tests__/fakes.js";
import { ACCOUNTS_TYPE, LEASE_TYPE } from "../../shared/protocol.js";
import { CATALOGUE, PRODUCTS, scopesFor } from "../../shared/products.js";
import { createLeaseHandler } from "../lease.js";
import registerPlugin from "../index.js";
import { acctKey, clientKey, GoogleStore } from "../store.js";

/**
 * The REAL host lane (`packages/server`), loaded by path: a plugin must not depend on the server package, so the
 * import is dynamic and typed here by the little of it this test uses.
 */
interface HostLane {
  register(pluginId: string, type: string, handler: (p: unknown, m: unknown) => unknown, opts?: { hubLocalOnly?: boolean }): void;
  handle(sessionId: string, msg: unknown, conn?: unknown): Promise<void>;
}
async function hostLane(send: (m: { ok: boolean; error?: string; result?: unknown }) => void): Promise<HostLane> {
  const path = fileURLToPath(new URL("../../../../server/src/plugin-request-lane.ts", import.meta.url));
  const mod = (await import(/* @vite-ignore */ path)) as { createPluginRequestLane(s: (sid: string, m: never) => void): HostLane };
  return mod.createPluginRequestLane((_sid, m) => send(m as never));
}
const UNATTRIBUTED_REMOTE = "unattributed-remote"; // packages/server/src/session/session-origin.ts

const NOW = 1_700_000_000_000;
const fresh = { expires: NOW + 3_600_000 };
const stale = { expires: NOW - 1000 };
const ok = { access_token: "NEW-ACCESS", expires_in: 3600, token_type: "Bearer" };
const err = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(initial: Record<string, unknown>, refresh?: Parameters<typeof fakeGoogleFetch>[0]["refresh"]) {
  const creds = memoryCredentials(initial as never);
  const store = new GoogleStore(creds);
  const logger = capturingLogger();
  const google = fakeGoogleFetch({ refresh: refresh ?? (() => ok) });
  const lease = createLeaseHandler({
    store,
    clients: { store, builtIn: { local: LOCAL, remote: REMOTE }, switches: () => ({ defaultClients: true, remoteReturn: true }) },
    endpoints: TEST_ENDPOINTS,
    logger,
    fetchImpl: google.fetchImpl,
    now: () => NOW,
  });
  return { creds, store, lease, google, logger };
}

const refreshCalls = (g: ReturnType<typeof fakeGoogleFetch>) => g.calls.filter((c) => c.grant === "refresh_token");

/** Every key (at any depth) and every string value of `v`. */
function deepScan(v: unknown, out: { keys: string[]; strings: string[] } = { keys: [], strings: [] }) {
  if (typeof v === "string") out.strings.push(v);
  else if (Array.isArray(v)) for (const x of v) deepScan(x, out);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.keys.push(k);
      deepScan(x, out);
    }
  }
  return out;
}

describe("A79–A82 — products enabled per account", () => {
  it("A79: calendar off → product_disabled and Google's token endpoint receives 0 requests", async () => {
    const { lease, google } = setup({ [acctKey("s1")]: account("s1", "a@x.com", { ...stale }) });
    expect(await err(lease({ account: "s1", product: "calendar", level: "read" }))).toMatch(/^product_disabled/);
    expect(google.calls).toHaveLength(0);
  });

  it("A80: every product × (configured, requested) level pair — insufficient iff requested > configured; ordering holds", async () => {
    const failures: string[] = [];
    let cases = 0;
    for (const def of CATALOGUE) {
      const levels = def.levels.map((l) => l.id);
      for (const [ci, cfg] of levels.entries()) {
        const { lease } = setup({
          [acctKey("s1")]: account("s1", "a@x.com", { ...fresh, scopes: scopesFor(def.id, { level: cfg }), products: { [def.id]: { level: cfg } } }),
        });
        for (const [ri, req] of levels.entries()) {
          cases++;
          const got = await err(lease({ account: "s1", product: def.id, level: req }));
          const want = ri > ci ? /^level_insufficient/ : /^ok$/;
          if (!want.test(got)) failures.push(`${def.id} cfg=${cfg} req=${req} → ${got}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(cases).toBe(CATALOGUE.reduce((n, d) => n + d.levels.length ** 2, 0));
    // drive: files < read < write
    expect(CATALOGUE.find((d) => d.id === "drive")?.levels.map((l) => l.id)).toEqual(["files", "read", "write"]);
  });

  it("A81: product off AND grant reauth_required → product_disabled first (GAP-A13), no Google request", async () => {
    const { lease, google } = setup({ [acctKey("s1")]: account("s1", "a@x.com", { status: "reauth_required", ...stale }) });
    expect(await err(lease({ account: "s1", product: "calendar", level: "read" }))).toMatch(/^product_disabled/);
    expect(google.calls).toHaveLength(0);
  });

  it.each([
    ["an unknown product", { account: "s1", product: "photos", level: "read" }],
    ["a missing product", { account: "s1", level: "read" }],
  ])("A82: %s → bad_request (GAP-A14), no refresh attempted", async (_n, payload) => {
    const { lease, google } = setup({ [acctKey("s1")]: account("s1", "a@x.com", { ...stale }) });
    expect(await err(lease(payload))).toMatch(/^bad_request/);
    expect(google.calls).toHaveLength(0);
  });
});

describe("B1 / B2 — tokens stay on the dashboard", () => {
  it("B1: the lease reply has exactly accessToken, expiresAt, email, level — no refresh token, no client secret, at any depth", async () => {
    const { lease } = setup({ [acctKey("s1")]: account("s1", "a@x.com", { ...fresh, scopes: scopesFor("calendar", { level: "read" }), products: { calendar: { level: "read" } } }) });
    const reply = (await lease({ account: "s1", product: "calendar", level: "read" })) as unknown;
    expect(Object.keys(reply as object).sort()).toEqual(["accessToken", "email", "expiresAt", "level"]);
    const scan = deepScan(reply);
    expect(scan.keys.filter((k) => /refresh|secret/i.test(k))).toEqual([]);
    expect(JSON.stringify(reply)).not.toMatch(/REFRESH-s1|SECRET-/);
  });

  it("B1: a refreshed lease (new access token) still carries no refresh token", async () => {
    const { lease } = setup({ [acctKey("s1")]: account("s1", "a@x.com", { ...stale, scopes: scopesFor("calendar", { level: "read" }), products: { calendar: { level: "read" } } }) }, () => ({ ...ok, refresh_token: "REFRESH-rotated" }));
    const reply = await lease({ account: "s1", product: "calendar", level: "read" });
    expect(reply).toMatchObject({ accessToken: "NEW-ACCESS" });
    expect(JSON.stringify(reply)).not.toMatch(/REFRESH/);
  });

  it("B2: google/accounts rows carry no refresh, access or secret field and none of the stored token values", async () => {
    const h = lanes({ [acctKey("s1")]: account("s1", "a@x.com", { ...fresh }), [acctKey("s2")]: account("s2", "b@x.com", { ...fresh, alias: "work" }) });
    const rows = (await h.handlers.get(ACCOUNTS_TYPE)?.({}, {})) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    const scan = deepScan(rows);
    expect(scan.keys.filter((k) => /refresh|access|secret|token|grant/i.test(k))).toEqual([]);
    expect(scan.strings.filter((s) => /REFRESH|ACCESS|SECRET/.test(s))).toEqual([]);
  });
});

/** The plugin's two lanes, registered through its real entry. */
function lanes(initial: Record<string, unknown>) {
  const fastify = Fastify();
  apps.push(fastify);
  const handlers = new Map<string, (p: unknown, m: unknown) => Promise<unknown>>();
  const opts = new Map<string, unknown>();
  const creds = memoryCredentials(initial as never);
  return {
    creds,
    handlers,
    opts,
    ready: registerPlugin({
      fastify,
      logger: capturingLogger(),
      credentials: creds,
      oauth: { startFlow: vi.fn() },
      networkGuard: async () => {},
      registerPiRequestHandler: (t: string, fn: (p: unknown, m: unknown) => Promise<unknown>, o?: unknown) => {
        handlers.set(t, fn);
        opts.set(t, o);
      },
      provide: () => {},
      consume: () => undefined,
    } as never),
  };
}
const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  vi.unstubAllGlobals();
});

describe("B3 — both lanes are refused to every non-hub-local session (real host lane)", () => {
  const chan = (admission: "unix" | "device-ticket") => ({ admission, provenTls: false, ticketTls: false });
  const sessions = {
    "hub-local": { originDeviceId: undefined, channel: chan("unix") },
    "paired-device": { originDeviceId: "dev-1", channel: chan("device-ticket") },
    "remote-origin": { originDeviceId: UNATTRIBUTED_REMOTE, channel: chan("unix") },
  } as const;
  const requests = {
    [LEASE_TYPE]: { account: "s1", product: "gmail", level: "readonly" },
    [ACCOUNTS_TYPE]: {},
  } as const;
  const cells = (Object.keys(sessions) as Array<keyof typeof sessions>).flatMap((s) => ([LEASE_TYPE, ACCOUNTS_TYPE] as const).map((l) => [s, l] as const));

  it.each(cells)("%s × %s", async (kind, lane) => {
    const fetchSpy = vi.fn(async () => Response.json(ok));
    vi.stubGlobal("fetch", fetchSpy);
    const sent: Array<{ ok: boolean; error?: string; result?: unknown }> = [];
    const lane_ = await hostLane((m) => void sent.push(m));
    const h = lanes({
      [clientKey("bb")]: ownClient("bb", "BB"),
      [acctKey("s1")]: account("s1", "a@x.com", { ...stale, client: "own:bb", clientId: OWN_BB.clientId, scopes: scopesFor("gmail", { level: "readonly" }), products: { gmail: { level: "readonly" } } }),
    });
    await h.ready;
    for (const [type, fn] of h.handlers) lane_.register("google", type, fn, h.opts.get(type) as never);
    await lane_.handle("S1", { type: "plugin_request", requestId: "r1", pluginId: "google", messageType: lane, payload: requests[lane] } as never, sessions[kind] as never);
    if (kind === "hub-local") {
      expect(sent[0]?.ok).toBe(true);
      expect(JSON.stringify(sent[0]?.result)).not.toMatch(/REFRESH/);
      if (lane === LEASE_TYPE) expect(fetchSpy).toHaveBeenCalledTimes(1); // served: the expired token is refreshed
    } else {
      expect(sent[0]).toMatchObject({ ok: false });
      expect(String(sent[0]?.error)).toMatch(/^origin_denied/);
      expect(fetchSpy).not.toHaveBeenCalled(); // the expired token was NOT refreshed for a denied caller
    }
  });
});

describe("B4–B9 — refresh is single-flight per account and never resurrects a disconnected one", () => {
  const expired = (sub: string) =>
    account(sub, `${sub}@x.com`, { ...stale, scopes: scopesFor("gmail", { level: "readonly" }), products: { gmail: { level: "readonly" } }, access: `OLD-${sub}` });
  const lease1 = (l: ReturnType<typeof setup>["lease"], sub: string) => l({ account: sub, product: "gmail", level: "readonly" });

  it("B4: ten concurrent leases against a slow token endpoint → exactly one refresh, one shared access token", async () => {
    const t = setup({ [acctKey("s1")]: expired("s1") }, async () => {
      await sleep(200);
      return ok;
    });
    const replies = (await Promise.all(Array.from({ length: 10 }, () => lease1(t.lease, "s1")))) as Array<{ accessToken: string }>;
    expect(refreshCalls(t.google)).toHaveLength(1);
    expect(new Set(replies.map((r) => r.accessToken))).toEqual(new Set(["NEW-ACCESS"]));
  });

  it("B5: two expired accounts → one refresh each (single-flight is per account)", async () => {
    const t = setup({ [acctKey("A")]: expired("A"), [acctKey("B")]: expired("B") }, async () => {
      await sleep(50);
      return ok;
    });
    await Promise.all([lease1(t.lease, "A"), lease1(t.lease, "B"), lease1(t.lease, "A"), lease1(t.lease, "B")]);
    expect(refreshCalls(t.google)).toHaveLength(2);
    expect(refreshCalls(t.google).map((c) => c.body.get("refresh_token")).sort()).toEqual(["REFRESH-A", "REFRESH-B"]);
  });

  it("B6: invalid_grant for A only → A reauth_required (no second Google call), B untouched and leases fine", async () => {
    const t = setup({ [acctKey("A")]: expired("A"), [acctKey("B")]: expired("B") }, (body) =>
      body.get("refresh_token") === "REFRESH-A" ? { status: 400, body: { error: "invalid_grant" } } : ok,
    );
    expect(await err(lease1(t.lease, "A"))).toMatch(/^reauth_required/);
    expect((await t.store.get("A"))?.grant.status).toBe("reauth_required");
    expect(await lease1(t.lease, "B")).toMatchObject({ accessToken: "NEW-ACCESS" });
    expect((await t.store.get("B"))?.grant.status).toBe("ok");
    const before = refreshCalls(t.google).length;
    expect(await err(lease1(t.lease, "A"))).toMatch(/^reauth_required/);
    expect(refreshCalls(t.google)).toHaveLength(before);
  });

  it("B7: a 503 on refresh is a non-reauth failure; the grant stays ok; the next lease retries", async () => {
    let n = 0;
    const t = setup({ [acctKey("s1")]: expired("s1") }, () => (++n === 1 ? { status: 503, body: { error: "backend_error" } } : ok));
    const first = await err(lease1(t.lease, "s1"));
    expect(first).toMatch(/^refresh_failed/);
    expect(first).not.toMatch(/reauth/);
    expect((await t.store.get("s1"))?.grant.status).toBe("ok");
    expect(await lease1(t.lease, "s1")).toMatchObject({ accessToken: "NEW-ACCESS" });
    expect(refreshCalls(t.google)).toHaveLength(2);
  });

  it("B7: a dropped connection is the same transient failure", async () => {
    const t = setup({ [acctKey("s1")]: expired("s1") }, () => {
      throw new TypeError("fetch failed");
    });
    expect(await err(lease1(t.lease, "s1"))).toMatch(/^refresh_failed/);
    expect((await t.store.get("s1"))?.grant.status).toBe("ok");
  });

  it("B8: ten concurrent leases share one failing refresh → one Google call, one error for all, no orphaned in-flight entry", async () => {
    let n = 0;
    const t = setup({ [acctKey("s1")]: expired("s1") }, async () => {
      await sleep(100);
      return ++n === 1 ? { status: 503, body: { error: "backend_error" } } : ok;
    });
    const results = await Promise.all(Array.from({ length: 10 }, () => err(lease1(t.lease, "s1"))));
    expect(refreshCalls(t.google)).toHaveLength(1);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toMatch(/^refresh_failed/);
    expect(await lease1(t.lease, "s1")).toMatchObject({ accessToken: "NEW-ACCESS" }); // a later lease starts a NEW refresh
    expect(refreshCalls(t.google)).toHaveLength(2);
  });

  it("B9: disconnecting while a refresh is in flight — the write-back does not resurrect the account", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const t = setup({ [acctKey("s1")]: expired("s1") }, async () => {
      await held;
      return { ...ok, refresh_token: "REFRESH-rotated" };
    });
    const pending = lease1(t.lease, "s1").catch((e: Error) => e);
    await vi.waitFor(() => expect(refreshCalls(t.google)).toHaveLength(1));
    await t.store.remove("s1");
    release();
    await pending;
    expect(await t.store.get("s1")).toBeUndefined();
    expect(t.creds.data.has(acctKey("s1"))).toBe(false);
  });
});
