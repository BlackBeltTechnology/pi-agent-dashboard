/**
 * Incremental consent, "a narrower reply changes nothing" and partial grants on a new connect, against the
 * real login flow and a fake Google (test-plan A84–A99, A101–A105). Complements `connect.test.ts`.
 * See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { account, makeHarness, OWN_BB, ownClient, TEST_ENDPOINTS } from "../../__tests__/fakes.js";
import { PRODUCTS, SCOPE } from "../../shared/products.js";
import { createLeaseHandler } from "../lease.js";
import { acctKey, clientKey } from "../store.js";

type H = ReturnType<typeof makeHarness>;

const gmail = [SCOPE.gmailReadonly];
const cal = [SCOPE.calendarReadonly];
const err = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

async function accepted(h: H): Promise<H> {
  await h.connect.acceptDisclosure();
  return h;
}
const lease = (h: H) =>
  createLeaseHandler({ store: h.store, clients: h.clients, endpoints: TEST_ENDPOINTS, logger: h.logger, fetchImpl: h.google.fetchImpl });

const gmailAcct = (over: Parameters<typeof account>[2] = {}) => ({
  [acctKey("s1")]: account("s1", "a@x.com", { scopes: gmail, products: { gmail: { level: "readonly" } }, ...over }) as never,
});

describe("A84 — a grant that already covers a product turns it on without Google", () => {
  it("applied immediately: no flow, no Google request", async () => {
    const h = await accepted(makeHarness({ initial: gmailAcct({ scopes: [...gmail, ...cal] }) }));
    expect(await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local")).toMatchObject({ ok: true, applied: true });
    expect(h.started).toHaveLength(0);
    expect(h.google.calls).toHaveLength(0);
    expect((await h.store.get("s1"))?.products.calendar).toEqual({ level: "read" });
  });
});

describe("A85 / A86 — one consent for the union; the reply replaces the grant", () => {
  it("A85: login_hint, union scope (+ openid email), prompt=consent, no include_granted_scopes", async () => {
    const h = await accepted(makeHarness({ initial: gmailAcct(), google: { scope: [...gmail, ...cal] } }));
    expect(await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local")).toMatchObject({ ok: true });
    const q = (await h.runFlow()).url.searchParams;
    expect(q.get("login_hint")).toBe("a@x.com");
    expect(q.get("scope")).toBe(`openid email ${SCOPE.gmailReadonly} ${SCOPE.calendarReadonly}`);
    expect(q.get("prompt")).toBe("consent");
    expect(q.has("include_granted_scopes")).toBe(false);
  });

  it("A86: grant.scopes replaced by the reply, Calendar on, Gmail still leases with the new refresh token", async () => {
    const h = await accepted(makeHarness({ initial: gmailAcct(), google: { scope: [...gmail, ...cal], refresh: "REFRESH-rotated" } }));
    await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    await h.runFlow();
    const a = await h.store.get("s1");
    expect(a?.grant.scopes).toEqual([...gmail, ...cal]);
    expect(a?.grant.refresh).toBe("REFRESH-rotated");
    expect(a?.products).toMatchObject({ gmail: { level: "readonly" }, calendar: { level: "read" } });
    expect(await lease(h)({ account: "s1", product: "gmail", level: "readonly" })).toMatchObject({ accessToken: "ACCESS-new", email: "a@x.com" });
    expect(h.google.calls.filter((c) => c.grant === "authorization_code")).toHaveLength(1); // no second sign-in
  });
});

describe("A87 / A88 / A89 — what Google did not grant stays off / at the previous level", () => {
  it("A87: reply grants Gmail but not Calendar → Calendar stays off with scope_missing; Gmail level unchanged", async () => {
    const h = await accepted(makeHarness({ initial: gmailAcct(), google: { scope: gmail } }));
    await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    await expect(h.runFlow()).rejects.toMatchObject({ code: "scope_missing" });
    const a = await h.store.get("s1");
    expect(a?.products).toEqual({ gmail: { level: "readonly" } });
    expect(a?.missing).toEqual(["calendar"]);
  });

  it("A88: Calendar read → write, reply lacks calendar.events → scope_missing; Calendar stays at read", async () => {
    const h = await accepted(
      makeHarness({ initial: gmailAcct({ scopes: [...gmail, ...cal], products: { gmail: { level: "readonly" }, calendar: { level: "read" } } }), google: { scope: [...gmail, ...cal] } }),
    );
    await h.connect.changeProducts("s1", { calendar: { level: "write" } }, "local");
    await expect(h.runFlow()).rejects.toMatchObject({ code: "scope_missing" });
    expect((await h.store.get("s1"))?.products.calendar).toEqual({ level: "read" });
  });

  it("A89: Drive files → read on an own client; grant.scopes become the reply, not merged with the stale drive.file", async () => {
    const h = makeHarness({
      initial: {
        [clientKey("bb")]: ownClient("bb", "BB") as never,
        [acctKey("s1")]: account("s1", "a@x.com", { client: "own:bb", clientId: OWN_BB.clientId, scopes: [SCOPE.driveFile], products: { drive: { level: "files" } } }) as never,
      },
      google: { scope: [SCOPE.driveReadonly] },
    });
    await h.connect.changeProducts("s1", { drive: { level: "read" } }, "local");
    await h.runFlow();
    const a = await h.store.get("s1");
    expect(a?.products.drive).toEqual({ level: "read" });
    expect(a?.grant.scopes).toEqual([SCOPE.driveReadonly]);
  });
});

describe("A90 / A91 — lowering and toggling never ask Google", () => {
  const calAcct = (level = "write", scopes: string[] = [...gmail, SCOPE.calendarEvents]) =>
    gmailAcct({ scopes, products: { gmail: { level: "readonly" }, calendar: { level } } });

  it("A90: Calendar write → read applies at once; a write lease is level_insufficient; grant.scopes untouched", async () => {
    const h = await accepted(makeHarness({ initial: calAcct() }));
    expect(await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local")).toMatchObject({ ok: true, applied: true });
    expect(h.started).toHaveLength(0);
    const a = await h.store.get("s1");
    expect(a?.grant.scopes).toEqual([...gmail, SCOPE.calendarEvents]);
    expect(await err(lease(h)({ account: "s1", product: "calendar", level: "write" }))).toMatch(/^level_insufficient/);
  });

  it("A91: read → off → on again: off blocks leases with product_disabled; on again is immediate, no consent", async () => {
    const h = await accepted(makeHarness({ initial: calAcct("read", [...gmail, ...cal]) }));
    await h.connect.changeProducts("s1", { calendar: null }, "local");
    expect(await err(lease(h)({ account: "s1", product: "calendar", level: "read" }))).toMatch(/^product_disabled/);
    expect(await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local")).toMatchObject({ ok: true, applied: true });
    expect(h.started).toHaveLength(0);
    expect(await lease(h)({ account: "s1", product: "calendar", level: "read" })).toMatchObject({ level: "read" });
  });
});

describe("A92 / A93 / A94 — an abandoned, wrong-account or concurrent consent", () => {
  it("A92: Google error access_denied → nothing changes, the account is free for another consent", async () => {
    const h = await accepted(makeHarness({ initial: gmailAcct() }));
    const before = structuredClone(await h.store.get("s1"));
    await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    await expect(h.runFlow(0, { deliver: "paste", pasteText: (s) => `http://127.0.0.1:5555/?error=access_denied&state=${s}` })).rejects.toMatchObject({ code: "access_denied" });
    expect(await h.store.get("s1")).toEqual(before);
    expect(await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local")).toMatchObject({ ok: true });
  });

  it("A93: Google's page signed in as b@x.com → account_mismatch; a@x.com unchanged; b@x.com not created", async () => {
    const h = await accepted(makeHarness({ initial: gmailAcct(), google: { sub: "s2", email: "b@x.com", scope: [...gmail, ...cal] } }));
    const before = structuredClone(await h.store.get("s1"));
    await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    await expect(h.runFlow()).rejects.toMatchObject({ code: "account_mismatch" });
    expect(await h.store.get("s1")).toEqual(before);
    expect(await h.store.get("s2")).toBeUndefined();
  });

  it("A94: a second consent for the same account is refused (409 consent_in_progress); no lost update, no scope without a token", async () => {
    const h = await accepted(makeHarness({ initial: gmailAcct(), google: { scope: [...gmail, ...cal] } }));
    expect(await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local")).toMatchObject({ ok: true });
    expect(await h.connect.changeProducts("s1", { tasks: { level: "read" } }, "local")).toMatchObject({ ok: false, status: 409, error: "consent_in_progress" });
    expect(h.started).toHaveLength(1);
    await h.runFlow();
    const a = await h.store.get("s1");
    expect(Object.keys(a?.products ?? {}).sort()).toEqual(["calendar", "gmail"]);
    expect(a?.grant.scopes).toEqual([...gmail, ...cal]); // every stored scope came back from the one stored token
    expect(a?.grant.refresh).toBe("REFRESH-new");
  });
});

describe("A95 — Gmail options survive a consent", () => {
  it("filters option, alias and products are kept when the reply still covers settings.basic", async () => {
    const scopes = [SCOPE.gmailModify, SCOPE.gmailSettingsBasic];
    const h = await accepted(
      makeHarness({
        initial: gmailAcct({ scopes, alias: "work", products: { gmail: { level: "send", options: { filters: true } } } }),
        google: { scope: [...scopes, ...cal] },
      }),
    );
    await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    await h.runFlow();
    expect(await h.store.get("s1")).toMatchObject({ alias: "work", products: { gmail: { level: "send", options: { filters: true } }, calendar: { level: "read" } } });
  });
});

describe("A96–A99 — a narrower reply changes nothing", () => {
  it("A96: reply has calendar.readonly but no Gmail scope → stored account byte-identical; Gmail still leases; Calendar off", async () => {
    const h = await accepted(makeHarness({ initial: gmailAcct(), google: { scope: cal, refresh: "REFRESH-would-replace" } }));
    const before = structuredClone(await h.store.get("s1"));
    await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    await expect(h.runFlow()).rejects.toMatchObject({ code: "scope_missing" });
    expect(await h.store.get("s1")).toEqual(before);
    expect((await h.store.get("s1"))?.grant.refresh).toBe("REFRESH-s1");
    expect(await lease(h)({ account: "s1", product: "gmail", level: "readonly" })).toMatchObject({ accessToken: "ACCESS-s1" });
    expect(await err(lease(h)({ account: "s1", product: "calendar", level: "read" }))).toMatch(/^product_disabled/);
  });

  it("A97: filters relied on (settings.basic); the reply omits only that scope → the whole reply counts as not granted", async () => {
    const scopes = [SCOPE.gmailModify, SCOPE.gmailSettingsBasic];
    const h = await accepted(
      makeHarness({ initial: gmailAcct({ scopes, products: { gmail: { level: "send", options: { filters: true } } } }), google: { scope: [SCOPE.gmailModify, ...cal] } }),
    );
    const before = structuredClone(await h.store.get("s1"));
    await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    await expect(h.runFlow()).rejects.toMatchObject({ code: "scope_missing" });
    expect(await h.store.get("s1")).toEqual(before);
  });

  it.each([
    ["equal to the union", [...gmail, ...cal], true],
    ["a superset of the union", [...gmail, ...cal, SCOPE.tasksReadonly], true],
    ["the union minus one scope", cal, false],
  ])("A98: reply %s → %s", async (_n, scope, accept) => {
    const h = await accepted(makeHarness({ initial: gmailAcct(), google: { scope } }));
    await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    if (accept) {
      await h.runFlow();
      expect((await h.store.get("s1"))?.grant.scopes).toEqual(scope);
      expect((await h.store.get("s1"))?.products.calendar).toEqual({ level: "read" });
    } else {
      await expect(h.runFlow()).rejects.toMatchObject({ code: "scope_missing" });
      expect((await h.store.get("s1"))?.products.calendar).toBeUndefined();
    }
  });

  it("A99: a scope of a product turned off earlier is not required of the reply", async () => {
    const h = await accepted(makeHarness({ initial: gmailAcct({ scopes: [...gmail, ...cal] }), google: { scope: [...gmail, SCOPE.tasksReadonly] } }));
    await h.connect.changeProducts("s1", { tasks: { level: "read" } }, "local"); // calendar is off: its scope is stale
    await h.runFlow();
    expect(await h.store.get("s1")).toMatchObject({ products: { gmail: { level: "readonly" }, tasks: { level: "read" } } });
    expect((await h.store.get("s1"))?.products.calendar).toBeUndefined();
  });
});

describe("A101–A105 — partial grants on a new connect", () => {
  const all = { gmail: "readonly", calendar: "read", drive: "files", docs: "read", sheets: "read", slides: "read", tasks: "read", contacts: "read" };

  it("A101: Gmail + Drive asked, Drive only granted → account stored; Drive on (files), Gmail off with scope_missing", async () => {
    const h = await accepted(makeHarness({ google: { scope: [SCOPE.driveFile] } }));
    await h.connect.startConnect({ products: { gmail: "readonly", drive: "files" }, browser: "local" });
    await h.runFlow();
    const a = await h.store.get("s1");
    expect(a?.products).toEqual({ drive: { level: "files" } });
    expect(a?.missing).toEqual(["gmail"]);
  });

  it("A102: neither granted (only openid email) → no account stored, store key count unchanged, error shown", async () => {
    const h = await accepted(makeHarness({ google: { scope: [] } }));
    const keys = h.creds.data.size;
    await h.connect.startConnect({ products: { gmail: "readonly", drive: "files" }, browser: "local" });
    await expect(h.runFlow()).rejects.toMatchObject({ code: "scope_missing" });
    expect(h.creds.data.size).toBe(keys);
  });

  it.each([
    ["1 requested, 1 granted", { calendar: "read" }, cal, [] as string[], true],
    ["8 requested, 1 granted", all, cal, PRODUCTS.filter((p) => p !== "calendar") as string[], true],
    ["8 requested, 0 granted", all, [], [] as string[], false],
  ])("A103: %s", async (_n, products, scope, missing, stored) => {
    const h = await accepted(makeHarness({ google: { scope } }));
    await h.connect.startConnect({ products, browser: "local" });
    if (!stored) {
      await expect(h.runFlow()).rejects.toMatchObject({ code: "scope_missing" });
      expect(await h.store.list()).toEqual([]);
      return;
    }
    await h.runFlow();
    const a = await h.store.get("s1");
    expect(a?.missing ?? []).toEqual(missing);
    expect(Object.keys(a?.products ?? {})).toEqual(["calendar"]);
  });

  it("A104: a scope granted for a product that was not requested does not turn that product on", async () => {
    const h = await accepted(makeHarness({ google: { scope: [...gmail, ...cal] } }));
    await h.connect.startConnect({ products: { gmail: "readonly" }, browser: "local" });
    await h.runFlow();
    const a = await h.store.get("s1");
    expect(a?.products).toEqual({ gmail: { level: "readonly" } });
    expect(a?.grant.scopes).toContain(SCOPE.calendarReadonly); // in the grant, but not auto-enabled
  });

  it("A105: reconnecting an existing account with a partial grant follows the consent rules, not the new-connect rules", async () => {
    const h = await accepted(makeHarness({ initial: gmailAcct(), google: { scope: cal } }));
    const before = structuredClone(await h.store.get("s1"));
    await h.connect.startConnect({ products: { gmail: "readonly", calendar: "read" }, browser: "local" });
    // The reply drops the Gmail scope the account relies on: a new connect would keep the Calendar half, a reconnect must not.
    await expect(h.runFlow()).rejects.toMatchObject({ code: "scope_missing" });
    expect(await h.store.get("s1")).toEqual(before);
  });

  it("A105: a reconnect whose reply keeps what the account relies on keeps its existing products", async () => {
    const h = await accepted(makeHarness({ initial: gmailAcct({ alias: "work" }), google: { scope: gmail } }));
    await h.connect.startConnect({ products: { gmail: "readonly", calendar: "read" }, browser: "local" });
    await expect(h.runFlow()).resolves.toBeTruthy();
    expect(await h.store.get("s1")).toMatchObject({ alias: "work", products: { gmail: { level: "readonly" } }, missing: ["calendar"] });
  });
});
