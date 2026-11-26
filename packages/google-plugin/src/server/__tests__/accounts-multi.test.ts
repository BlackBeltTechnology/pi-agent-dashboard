/**
 * Several Google accounts in one store, a full store, local-browser consent, and disconnect-sticks across
 * restarts (test-plan B106–B109, B114, B116–B117, B118–B119, B121–B123; scenario-gate B17).
 * See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { account, makeHarness, OWN_BB, ownClient } from "../../__tests__/fakes.js";
import { SCOPE } from "../../shared/products.js";
import { createLegacyImporter } from "../import.js";
import { acctKey, clientKey, GoogleStore } from "../store.js";

const cal = [SCOPE.calendarReadonly];
const BB = { [clientKey("bb")]: ownClient("bb", "BB") as never };
const filler = (n: number, from = 0) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [acctKey(`f${from + i}`), account(`f${from + i}`, `f${from + i}@x.com`, { client: "own:bb", clientId: OWN_BB.clientId }) as never]));

async function connectAs(h: ReturnType<typeof makeHarness>, sub: string, o: { products?: Record<string, unknown>; email?: string } = {}) {
  h.reply.sub = sub;
  h.reply.email = `${sub}@x.com`;
  await h.connect.startConnect({ products: o.products ?? { calendar: "read" }, client: "own:bb", email: o.email, browser: "local" });
  await h.runFlow();
}

describe("multiple Google accounts (B106–B109)", () => {
  it("B106: 1, 2 and 5 distinct subs on the same client → one acct:<sub> each, none overwrites another", async () => {
    const h = makeHarness({ initial: BB, google: { scope: cal } });
    for (const sub of ["s1", "s2", "s3", "s4", "s5"]) await connectAs(h, sub);
    const keys = [...h.creds.data.keys()].filter((k) => k.startsWith("acct:")).sort();
    expect(keys).toEqual(["acct:s1", "acct:s2", "acct:s3", "acct:s4", "acct:s5"]);
    expect((await h.store.list()).map((a) => a.email).sort()).toEqual(["s1@x.com", "s2@x.com", "s3@x.com", "s4@x.com", "s5@x.com"]);
  });

  it("B107: reconnecting a@x.com keeps alias, products and options; only the grant is replaced", async () => {
    const mine = account("a", "a@x.com", {
      alias: "Work",
      client: "own:bb",
      clientId: OWN_BB.clientId,
      scopes: [SCOPE.calendarEvents, SCOPE.gmailReadonly, SCOPE.gmailSettingsBasic],
      products: { calendar: { level: "write" }, gmail: { level: "readonly", options: { filters: true } } },
    });
    const h = makeHarness({ initial: { ...BB, [acctKey("a")]: mine as never }, google: { scope: [SCOPE.calendarEvents, SCOPE.gmailReadonly, SCOPE.gmailSettingsBasic], refresh: "REFRESH-reconnected" } });
    const before = await h.store.get("a");
    h.reply.sub = "a";
    h.reply.email = "a@x.com";
    await h.connect.startConnect({ products: { calendar: "write", gmail: { level: "readonly", options: { filters: true } } }, client: "own:bb", browser: "local" });
    await h.runFlow();
    const after = await h.store.get("a");
    expect(await h.store.list()).toHaveLength(1);
    expect(after).toMatchObject({ alias: "Work", products: before?.products });
    expect(after?.grant.refresh).toBe("REFRESH-reconnected");
    expect(after?.grant.refresh).not.toBe(before?.grant.refresh);
  });

  it("B108: two connects in parallel, B completes first then A → both stored, neither flow cancelled, no lost update", async () => {
    const h = makeHarness({ initial: BB, google: { scope: cal } });
    const a = await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "local" });
    const b = await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "local" });
    expect([a.ok, b.ok]).toEqual([true, true]);
    h.reply.sub = "B";
    h.reply.email = "b@x.com";
    await h.runFlow(1);
    h.reply.sub = "A";
    h.reply.email = "a@x.com";
    await h.runFlow(0);
    expect((await h.store.list()).map((x) => [x.sub, x.email]).sort()).toEqual([["A", "a@x.com"], ["B", "b@x.com"]]);
  });

  it("B109: two connects ending on the same Google sub → one entry, no duplicate, no account_mismatch", async () => {
    const h = makeHarness({ initial: BB, google: { scope: cal, sub: "same", email: "same@x.com" } });
    await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "local" });
    await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "local" });
    await h.runFlow(0);
    await h.runFlow(1);
    expect((await h.store.list()).map((x) => x.sub)).toEqual(["same"]);
  });
});

describe("a full store is explained (B114, B116, B117; G17)", () => {
  it("B114: at 255 keys a new account connects (reaching 256); at 256 it is refused `too_many_keys`, nothing written", async () => {
    const ok = makeHarness({ initial: { ...BB, ...filler(254) }, google: { scope: cal } });
    expect(ok.creds.data.size).toBe(255);
    await connectAs(ok, "new");
    expect(ok.creds.data.size).toBe(256);
    expect(await ok.store.get("new")).toBeDefined();

    const full = makeHarness({ initial: { ...BB, ...filler(255) }, google: { scope: cal } });
    expect(full.creds.data.size).toBe(256);
    const r = await full.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "local" });
    expect(r).toMatchObject({ ok: false, status: 409, error: "too_many_keys" });
    expect(full.started).toHaveLength(0);
    expect(full.creds.data.size).toBe(256);
  });

  it("B114: a store that fills up DURING the sign-in fails the flow and leaves no partial record", async () => {
    const h = makeHarness({ initial: { ...BB, ...filler(254) }, google: { scope: cal } });
    await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "local" });
    for (const [k, v] of Object.entries(filler(1, 900))) h.creds.data.set(k, v);
    h.reply.sub = "late";
    await expect(h.runFlow()).rejects.toBeDefined();
    expect(h.creds.data.size).toBe(256);
    expect(await h.store.get("late")).toBeUndefined();
  });

  it("B116: at 256 keys an existing account can reconnect, change a level and sign in again; only new keys fail", async () => {
    const mine = account("a", "a@x.com", { client: "own:bb", clientId: OWN_BB.clientId, scopes: [SCOPE.calendarEvents], products: { calendar: { level: "write" } } });
    const h = makeHarness({ initial: { ...BB, ...filler(254), [acctKey("a")]: mine as never }, google: { scope: [SCOPE.calendarEvents], sub: "a", email: "a@x.com" } });
    expect(h.creds.data.size).toBe(256);
    // reconnect through the add flow with the account's email (G17: reconnect of an existing account allowed)
    const r = await h.connect.startConnect({ products: { calendar: "write" }, client: "own:bb", email: "a@x.com", browser: "local" });
    expect(r).toMatchObject({ ok: true });
    await h.runFlow();
    // level change (lowering) applies in place
    expect(await h.connect.changeProducts("a", { calendar: "read" }, "local")).toMatchObject({ ok: true, applied: true });
    // sign in again is a consent flow, not a new key
    expect(await h.connect.signInAgain("a", "local")).toMatchObject({ ok: true });
    expect(h.creds.data.size).toBe(256);
    // an unknown email is a NEW account → refused
    expect(await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", email: "new@x.com", browser: "local" })).toMatchObject({ status: 409, error: "too_many_keys" });
  });

  it("B117: the refusal for a new account happens BEFORE Google opens (no flow, no auth URL) — G17", async () => {
    const h = makeHarness({ initial: { ...BB, ...filler(255) }, google: { scope: cal } });
    await h.connect.startConnect({ products: { calendar: "read" }, client: "own:bb", browser: "local" });
    expect(h.started).toHaveLength(0);
    expect(h.oauth.startFlow).not.toHaveBeenCalled();
  });
});

describe("consent for a local built-in account needs the local browser (B118, B119, B121)", () => {
  const cases = ["builtin", "builtin-remote", "own-installed", "own-web"] as const;
  const initialFor = (kind: (typeof cases)[number]) => {
    const own = kind === "own-web" ? { type: "web" as const } : {};
    const client = kind === "builtin" || kind === "builtin-remote" ? kind : "own:bb";
    return {
      ...(client === "own:bb" ? { [clientKey("bb")]: ownClient("bb", "BB", OWN_BB, { ...own, ...(kind === "own-web" ? { domains: ["dash.example.com"] } : {}) }) as never } : {}),
      [acctKey("s1")]: account("s1", "a@x.com", {
        client,
        clientId: client === "own:bb" ? OWN_BB.clientId : undefined,
        scopes: [SCOPE.calendarReadonly],
        products: { calendar: { level: "read" } },
      }) as never,
    };
  };

  for (const kind of cases) {
    for (const browser of ["local", "remote"] as const) {
      it(`B118: ${kind} × ${browser} browser`, async () => {
        const refused = kind === "builtin" && browser === "remote";
        const h = makeHarness({ initial: initialFor(kind), google: { scope: [SCOPE.calendarReadonly, SCOPE.tasksReadonly] } });
        await h.connect.acceptDisclosure();
        const needsConsent = await h.connect.changeProducts("s1", { tasks: "read" }, browser);
        const again = await h.connect.signInAgain("s1", browser);
        for (const r of [needsConsent, again]) {
          if (refused) expect(r).toMatchObject({ ok: false, status: 409, error: "local_browser_required" });
          else expect((r as { error?: string }).error).not.toBe("local_browser_required");
          if (refused) continue;
        }
        if (refused) expect(h.started).toHaveLength(0);
        // actions that need no consent never mention the local browser
        for (const wish of [{ calendar: "off" }, { tasks: "off" }]) {
          const r = await h.connect.changeProducts("s1", wish, browser);
          expect((r as { error?: string }).error).not.toBe("local_browser_required");
        }
      });
    }
  }

  it("B119: a same-host tunnel request counts as remote → local_browser_required on a local built-in account", async () => {
    // The server classifies 127.0.0.1 + X-Forwarded-For as `remote`; the connect service only sees the verdict.
    const h = makeHarness({ initial: initialFor("builtin"), google: { scope: [SCOPE.calendarReadonly, SCOPE.tasksReadonly] } });
    await h.connect.acceptDisclosure();
    expect(await h.connect.changeProducts("s1", { tasks: "read" }, "remote")).toMatchObject({ status: 409, error: "local_browser_required" });
  });

  it("B121: connecting the same sub through builtin-remote → client_mismatch (not local_browser_required); nothing changes", async () => {
    const h = makeHarness({ initial: initialFor("builtin"), google: { scope: cal, sub: "s1", email: "a@x.com" } });
    await h.connect.acceptDisclosure();
    const before = JSON.stringify(await h.store.get("s1"));
    expect(await h.connect.startConnect({ products: { calendar: "read" }, browser: "remote" })).toMatchObject({ ok: true, client: "builtin-remote" });
    await expect(h.runFlow()).rejects.toMatchObject({ code: "client_mismatch" });
    expect(JSON.stringify(await h.store.get("s1"))).toBe(before);
  });
});

describe("a disconnected account stays disconnected across restarts (B122, B123)", () => {
  const legacyAcct = {
    sub: "a",
    email: "a@x.com",
    tier: "send",
    scopes: [SCOPE.gmailModify],
    refresh: "LEGACY-RT",
    access: "OLD",
    expires: 1,
    status: "ok" as const,
    addedAt: 1,
  };
  const snapshot = { client: { clientId: OWN_BB.clientId, clientSecret: OWN_BB.clientSecret }, accounts: [legacyAcct] };
  /** A "restart": fresh store + importer over the same credential namespace. */
  const restart = (h: ReturnType<typeof makeHarness>) => {
    const store = new GoogleStore(h.creds);
    return { store, importer: createLegacyImporter({ store, logger: h.logger }) };
  };

  it("B122: an imported account that was disconnected is absent after a restart; the next import does not add it back", async () => {
    const h = makeHarness();
    await createLegacyImporter({ store: h.store, logger: h.logger }).importLegacyGmail(snapshot);
    expect(await h.store.get("a")).toBeDefined();
    await h.connect.disconnect("a", { revoke: false });
    const r = restart(h);
    expect(await r.store.get("a")).toBeUndefined();
    expect(await r.importer.importLegacyGmail(snapshot)).toMatchObject({ ok: true, imported: 0 });
    expect(await r.store.list()).toEqual([]);
  });

  it("B123: disconnect, manual reconnect, disconnect again, restart → import never restores it; reconnecting is allowed", async () => {
    const h = makeHarness({ google: { scope: [SCOPE.gmailModify], sub: "a", email: "a@x.com" } });
    await createLegacyImporter({ store: h.store, logger: h.logger }).importLegacyGmail(snapshot);
    await h.connect.disconnect("a", { revoke: false });
    await createLegacyImporter({ store: h.store, logger: h.logger }).importLegacyGmail(snapshot);
    expect(await h.store.list()).toEqual([]);
    await h.connect.startConnect({ products: { gmail: "send" }, client: "own:gmail-legacy", email: "a@x.com", browser: "local" });
    await h.runFlow();
    expect(await h.store.get("a")).toMatchObject({ email: "a@x.com" });
    await h.connect.disconnect("a", { revoke: false });
    const r = restart(h);
    expect(await r.importer.importLegacyGmail(snapshot)).toMatchObject({ ok: true, imported: 0 });
    expect(await r.store.list()).toEqual([]);
  });
});
