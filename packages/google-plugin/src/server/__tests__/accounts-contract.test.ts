/**
 * Store-level contract (test-plan A32, A70, A83, B77, B78): an own client in use is never re-keyed, accounts are
 * keyed by Google subject, the products map recognises exactly the eight products, and the legacy Gmail import
 * is faithful and idempotent. See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { account, capturingLogger, LOCAL, makeHarness, memoryCredentials, OWN_BB, ownClient } from "../../__tests__/fakes.js";
import { PRODUCTS, SCOPE } from "../../shared/products.js";
import { createLegacyImporter, type LegacyGmailAccount } from "../import.js";
import { acctKey, clientKey, GoogleStore, summarize } from "../store.js";

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? "error",
  );

describe("A32 — an own client in use cannot be re-keyed", () => {
  const bb = () => {
    const creds = memoryCredentials({
      [clientKey("bb")]: ownClient("bb", "BlackBelt") as never,
      [acctKey("s1")]: account("s1", "a@x.com", { client: "own:bb", clientId: OWN_BB.clientId }) as never,
    });
    return { creds, store: new GoogleStore(creds) };
  };

  it("replacing the Google client id while an account uses it → client_in_use; the stored clientId and grant.clientId are unchanged", async () => {
    const { store, creds } = bb();
    const before = JSON.stringify(await creds.snapshot());
    expect(await code(store.replaceClientId("bb", "new-id.apps.googleusercontent.com", "NEW-SECRET"))).toBe("client_in_use");
    expect((await store.getClient("bb"))?.clientId).toBe(OWN_BB.clientId);
    expect((await store.get("s1"))?.grant.clientId).toBe(OWN_BB.clientId);
    expect(JSON.stringify(await creds.snapshot())).toBe(before);
  });

  it("the same Google client id with a new secret is not a re-key and is allowed", async () => {
    const { store } = bb();
    await store.replaceClientId("bb", OWN_BB.clientId, "ROTATED-SECRET");
    expect(await store.getClient("bb")).toMatchObject({ clientId: OWN_BB.clientId, clientSecret: "ROTATED-SECRET" });
  });

  it("once the account is disconnected the id can be replaced", async () => {
    const { store } = bb();
    await store.remove("s1");
    await store.replaceClientId("bb", "new-id.apps.googleusercontent.com", "NEW-SECRET");
    expect((await store.getClient("bb"))?.clientId).toBe("new-id.apps.googleusercontent.com");
  });

  it("an upload of a DIFFERENT Google client id never touches BlackBelt: it adds a client", async () => {
    const { store } = bb();
    const r = await store.upsertClient({ type: "installed", clientId: "other.apps.googleusercontent.com", clientSecret: "S" }, { label: "Other" });
    expect(r.created).toBe(true);
    expect((await store.getClient("bb"))?.clientId).toBe(OWN_BB.clientId);
  });

  it("removing it is refused too, whatever the grant status (reauth_required counts)", async () => {
    const creds = memoryCredentials({
      [clientKey("bb")]: ownClient("bb", "BlackBelt") as never,
      [acctKey("s1")]: account("s1", "a@x.com", { client: "own:bb", clientId: OWN_BB.clientId, status: "reauth_required" }) as never,
    });
    expect(await code(new GoogleStore(creds).removeClient("bb"))).toBe("client_in_use");
  });
});

describe("A70 — accounts are keyed by subject: the same email under two clients is two accounts", () => {
  it("S1 on the built-in app and S2 on an own client, both a@x.com → two distinct records, both listed", async () => {
    const creds = memoryCredentials({
      [clientKey("bb")]: ownClient("bb", "BB") as never,
      [acctKey("S1")]: account("S1", "a@x.com", { clientId: LOCAL.clientId }) as never,
      [acctKey("S2")]: account("S2", "a@x.com", { client: "own:bb", clientId: OWN_BB.clientId }) as never,
    });
    const store = new GoogleStore(creds);
    const list = await store.list();
    expect(list.map((a) => a.sub).sort()).toEqual(["S1", "S2"]);
    expect(list.map((a) => a.client).sort()).toEqual(["builtin", "own:bb"]);
    expect([...creds.data.keys()].filter((k) => k.startsWith("acct:")).sort()).toEqual(["acct:S1", "acct:S2"]);
    expect(list.map(summarize).map((s) => s.email)).toEqual(["a@x.com", "a@x.com"]);
  });

  it("a lookup by email is ambiguous, by sub is exact", async () => {
    const store = new GoogleStore(
      memoryCredentials({ [acctKey("S1")]: account("S1", "a@x.com") as never, [acctKey("S2")]: account("S2", "a@x.com", { client: "own:bb" }) as never }),
    );
    expect(await code(store.resolve("a@x.com"))).toBe("ambiguous");
    expect((await store.resolve("S2")).sub).toBe("S2");
  });
});

describe("A83 — the products map knows exactly eight products; absent means off", () => {
  const all = { gmail: "readonly", calendar: "read", drive: "files", docs: "read", sheets: "read", slides: "read", tasks: "read", contacts: "read" };
  const scopes = [SCOPE.gmailReadonly, SCOPE.calendarReadonly, SCOPE.driveFile, SCOPE.documentsReadonly, SCOPE.spreadsheetsReadonly, SCOPE.presentationsReadonly, SCOPE.tasksReadonly, SCOPE.contactsReadonly];

  it("the recognised keys are gmail, calendar, drive, docs, sheets, slides, tasks, contacts", () => {
    expect([...PRODUCTS]).toEqual(["gmail", "calendar", "drive", "docs", "sheets", "slides", "tasks", "contacts"]);
  });

  it("a new account with all eight on has a key for each; one with only Gmail has only gmail (the rest are off)", async () => {
    const h = makeHarness({ google: { scope: scopes } });
    await h.connect.acceptDisclosure();
    await h.connect.startConnect({ products: all, browser: "local" });
    await h.runFlow();
    expect(Object.keys((await h.store.get("s1"))?.products ?? {}).sort()).toEqual([...PRODUCTS].sort());

    const one = makeHarness({ google: { scope: [SCOPE.gmailReadonly], sub: "s9" } });
    await one.connect.acceptDisclosure();
    await one.connect.startConnect({ products: { gmail: "readonly" }, browser: "local" });
    await one.runFlow();
    expect(Object.keys((await one.store.get("s9"))?.products ?? {})).toEqual(["gmail"]);
  });

  it("an unknown product key in a change is refused (400 bad_request) and nothing is stored or started", async () => {
    const h = makeHarness({ initial: { [acctKey("s1")]: account("s1", "a@x.com") as never } });
    await h.connect.acceptDisclosure();
    const before = JSON.stringify(await h.store.get("s1"));
    expect(await h.connect.changeProducts("s1", { photos: { level: "read" } }, "local")).toMatchObject({ ok: false, status: 400, error: "bad_request" });
    expect(await h.connect.changeProducts("s1", { photos: null }, "local")).toMatchObject({ ok: false, status: 400, error: "bad_request" });
    expect(h.started).toHaveLength(0);
    expect(JSON.stringify(await h.store.get("s1"))).toBe(before);
  });
});

describe("B77 / B78 — legacy Gmail import is faithful and idempotent", () => {
  const legacy = (sub: string, over: Partial<LegacyGmailAccount> = {}): LegacyGmailAccount => ({
    sub,
    email: `${sub}@x.com`,
    tier: "send",
    scopes: [SCOPE.gmailModify],
    refresh: `LEGACY-REFRESH-${sub}`,
    access: `LEGACY-ACCESS-${sub}`,
    expires: 123,
    status: "ok",
    addedAt: 7,
    ...over,
  });
  const accounts = [
    legacy("s1", { tier: "send", filters: true, scopes: [SCOPE.gmailModify, SCOPE.gmailSettingsBasic] }),
    legacy("s2", { tier: "readonly", scopes: [SCOPE.gmailReadonly], status: "reauth_required" }),
  ];
  const run = () => {
    const creds = memoryCredentials({});
    const store = new GoogleStore(creds);
    return { creds, store, importer: createLegacyImporter({ store, logger: capturingLogger() }) };
  };

  it("B77: client:gmail-legacy (installed, 'Gmail client (migrated)'); accounts bound to it with grant, products and options intact; other products off", async () => {
    const { importer, store } = run();
    expect(await importer.importLegacyGmail({ client: { ...OWN_BB }, accounts })).toEqual({ ok: true, imported: 2, skipped: 0 });
    expect(await store.getClient("gmail-legacy")).toMatchObject({ type: "installed", label: "Gmail client (migrated)", clientId: OWN_BB.clientId, clientSecret: OWN_BB.clientSecret });
    for (const src of accounts) {
      const a = await store.get(src.sub);
      expect(a?.client).toBe("own:gmail-legacy");
      expect(a?.grant).toMatchObject({ clientId: OWN_BB.clientId, refresh: src.refresh, access: src.access, scopes: src.scopes, status: src.status });
      expect(Object.keys(a?.products ?? {})).toEqual(["gmail"]); // every other product is off
    }
    expect((await store.get("s1"))?.products.gmail).toEqual({ level: "send", options: { filters: true } });
    expect((await store.get("s2"))?.products.gmail).toEqual({ level: "readonly" });
    expect((await store.get("s2"))?.grant.status).toBe("reauth_required");
  });

  it("B78: a second run adds no duplicate and leaves every stored key byte-for-byte unchanged", async () => {
    const { importer, creds } = run();
    await importer.importLegacyGmail({ client: { ...OWN_BB }, accounts });
    const first = JSON.stringify(Object.fromEntries([...creds.data].sort(([a], [b]) => a.localeCompare(b))));
    expect(await importer.importLegacyGmail({ client: { ...OWN_BB }, accounts })).toEqual({ ok: true, imported: 0, skipped: 0 });
    expect(JSON.stringify(Object.fromEntries([...creds.data].sort(([a], [b]) => a.localeCompare(b))))).toBe(first);
    expect([...creds.data.keys()].filter((k) => k.startsWith("acct:"))).toHaveLength(2);
  });
});
