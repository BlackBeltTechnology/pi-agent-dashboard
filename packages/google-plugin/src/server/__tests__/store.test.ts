/**
 * Store: named own clients, domains, client in use, accounts bound to one client, aliases, capacity
 * (test-plan A18–A34, A65–A71; scenario-gate A3/A5). See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { account, memoryCredentials, OWN_BB, OWN_SEMMI, ownClient } from "../../__tests__/fakes.js";
import { acctKey, clientKey, GoogleStore, type StoreError, summarize } from "../store.js";

const parsed = (c: { clientId: string; clientSecret: string }, over: Record<string, unknown> = {}) => ({ type: "installed" as const, ...c, ...over });
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: StoreError) => e.code);

describe("named own clients (A18–A21)", () => {
  it("two clients side by side with their own domains and account counts", async () => {
    const store = new GoogleStore(memoryCredentials({ [acctKey("s1")]: account("s1", "a@blackbelt.hu", { client: "own:blackbelt", clientId: OWN_BB.clientId }) }));
    await store.upsertClient(parsed(OWN_BB), { label: "BlackBelt", domains: ["blackbelt.hu"] });
    await store.upsertClient(parsed(OWN_SEMMI), { label: "Semmi", domains: ["semmi.se"] });
    const list = await store.summarizeClients();
    expect(list.map((c) => [c.id, c.label, c.type, c.domains, c.accounts])).toEqual([
      ["blackbelt", "BlackBelt", "installed", ["blackbelt.hu"], 1],
      ["semmi", "Semmi", "installed", ["semmi.se"], 0],
    ]);
    expect(JSON.stringify(list)).not.toContain("SECRET");
  });

  it("an upload with an existing Google client id updates the secret; label and domains stay (A3/A19)", async () => {
    const store = new GoogleStore(memoryCredentials());
    await store.upsertClient(parsed(OWN_BB, { projectId: "bb-pi" }), { label: "BlackBelt", domains: ["blackbelt.hu"] });
    const r = await store.upsertClient(parsed({ clientId: OWN_BB.clientId, clientSecret: "NEW" }), { label: "ignored", domains: ["other.com"] });
    expect(r.created).toBe(false);
    expect(await store.listClients()).toHaveLength(1);
    expect(r.client).toMatchObject({ id: "blackbelt", label: "BlackBelt", domains: ["blackbelt.hu"], clientSecret: "NEW", projectId: "bb-pi" });
  });

  it("an upload with a different client id adds a client and leaves the first byte-identical (A20)", async () => {
    const creds = memoryCredentials();
    const store = new GoogleStore(creds);
    await store.upsertClient(parsed(OWN_BB), { label: "BlackBelt" });
    const before = JSON.stringify(creds.data.get(clientKey("blackbelt")));
    await store.upsertClient(parsed(OWN_SEMMI), { label: "BlackBelt" }); // same label → distinct slug
    expect(JSON.stringify(creds.data.get(clientKey("blackbelt")))).toBe(before);
    expect((await store.listClients()).map((c) => c.id)).toEqual(["blackbelt", "blackbelt-2"]);
  });

  it("a full namespace → too_many_keys, nothing half-written (A21)", async () => {
    const filler = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [`acct:f${i}`, account(`f${i}`, `f${i}@x.com`)]));
    const creds = memoryCredentials(filler);
    const store = new GoogleStore(creds);
    expect(await code(store.upsertClient(parsed(OWN_BB), { label: "A" }))).toBe("ok"); // key 256
    expect(await code(store.upsertClient(parsed(OWN_SEMMI), { label: "B" }))).toBe("too_many_keys");
    expect(creds.data.size).toBe(256);
  });
});

describe("domains are unambiguous (A26–A30)", () => {
  async function two() {
    const store = new GoogleStore(memoryCredentials());
    await store.upsertClient(parsed(OWN_SEMMI), { label: "Semmi", domains: ["semmi.se"] });
    await store.upsertClient(parsed(OWN_BB), { label: "Other" });
    return store;
  }
  it("a domain linked to one client cannot be linked to another — case-insensitively, naming the owner", async () => {
    const store = await two();
    for (const d of ["semmi.se", "Semmi.SE", "@semmi.se"]) {
      const err = await store.patchClient("other", { domains: [d] }).catch((e: StoreError) => e);
      expect(err).toMatchObject({ code: "domain_taken", detail: "Semmi" });
    }
    expect((await store.getClient("other"))?.domains).toEqual([]);
    expect((await store.getClient("semmi"))?.domains).toEqual(["semmi.se"]);
  });
  it("no suffix matching: mail.semmi.se and semmi.se.evil.com are accepted", async () => {
    const store = await two();
    await store.patchClient("other", { domains: ["mail.semmi.se", "semmi.se.evil.com"] });
    expect((await store.getClient("other"))?.domains).toEqual(["mail.semmi.se", "semmi.se.evil.com"]);
    expect((await store.clientForDomain("mail.semmi.se"))?.id).toBe("other");
    expect((await store.clientForDomain("SEMMI.se"))?.id).toBe("semmi");
    expect(await store.clientForDomain("x.semmi.se")).toBeUndefined();
  });
  it("several domains per client; a self-duplicate is de-duplicated, not a conflict with itself", async () => {
    const store = await two();
    await store.patchClient("semmi", { domains: ["semmi.se", "semmi.com", "SEMMI.se"] });
    expect((await store.getClient("semmi"))?.domains).toEqual(["semmi.se", "semmi.com"]);
  });
  it("invalid entries (no dot, empty) are refused as a whole; nothing stored", async () => {
    const store = await two();
    for (const list of [["@semmi.se", "semmi"], [""], ["   "]]) expect(await code(store.patchClient("semmi", { domains: list }))).toBe("invalid_domain");
    expect((await store.getClient("semmi"))?.domains).toEqual(["semmi.se"]);
  });
});

describe("own client in use (A31–A34)", () => {
  const withAccount = (status = "ok") =>
    new GoogleStore(
      memoryCredentials({
        [clientKey("blackbelt")]: ownClient("blackbelt", "BlackBelt"),
        [acctKey("s1")]: account("s1", "a@blackbelt.hu", { client: "own:blackbelt", clientId: OWN_BB.clientId, status }),
      }),
    );
  it("refuses to remove it while an account references it — whatever the grant status", async () => {
    for (const status of ["ok", "reauth_required"]) {
      const store = withAccount(status);
      expect(await code(store.removeClient("blackbelt"))).toBe("client_in_use");
      expect(await store.getClient("blackbelt")).toBeDefined();
      expect(await store.get("s1")).toBeDefined();
    }
  });
  it("refuses to replace its Google client id while in use; the same id may refresh the secret", async () => {
    const store = withAccount();
    expect(await code(store.replaceClientId("blackbelt", "new.apps.googleusercontent.com", "x"))).toBe("client_in_use");
    expect((await store.getClient("blackbelt"))?.clientId).toBe(OWN_BB.clientId);
    expect(await code(store.replaceClientId("blackbelt", OWN_BB.clientId, "rotated"))).toBe("ok");
  });
  it("removes once the last account is gone, or when it never had one", async () => {
    const store = withAccount();
    await store.remove("s1");
    await store.removeClient("blackbelt");
    expect(await store.listClients()).toEqual([]);
    expect(await code(store.removeClient("blackbelt"))).toBe("client_not_found");
  });
});

describe("accounts (D3)", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    sub: "s1",
    email: "a@x.com",
    client: "builtin" as const,
    clientId: "cid",
    scopes: ["s"],
    access: "A",
    refresh: "R",
    expires: 1,
    products: { gmail: { level: "readonly" } },
    ...over,
  });
  it("one account = one grant bound to one client; re-auth keeps alias and addedAt, updates the email", async () => {
    const store = new GoogleStore(memoryCredentials());
    const first = await store.upsertFromSignIn(input({ now: 100 }));
    await store.setAlias("s1", "work");
    const again = await store.upsertFromSignIn(input({ email: "renamed@x.com", refresh: "R2", now: 200 }));
    expect(again).toMatchObject({ alias: "work", addedAt: 100, email: "renamed@x.com", client: "builtin" });
    expect(again.grant).toMatchObject({ refresh: "R2", clientId: "cid", status: "ok", grantedAt: 200 });
    expect(first.addedAt).toBe(100);
  });
  it("a new account without a refresh token is rejected and writes nothing; a known one keeps its old refresh", async () => {
    const creds = memoryCredentials();
    const store = new GoogleStore(creds);
    expect(await code(store.upsertFromSignIn(input({ refresh: undefined })))).toBe("missing_refresh");
    expect(creds.data.size).toBe(0);
    await store.upsertFromSignIn(input());
    const kept = await store.upsertFromSignIn(input({ refresh: undefined, access: "A2" }));
    expect(kept.grant).toMatchObject({ refresh: "R", access: "A2" });
  });
  it("resolves by sub, alias, then email (case-insensitive); same email on two subs is ambiguous; no implicit default", async () => {
    const store = new GoogleStore(
      memoryCredentials({
        [acctKey("s1")]: account("s1", "a@x.com", { alias: "work" }),
        [acctKey("s2")]: account("s2", "dup@x.com"),
        [acctKey("s3")]: account("s3", "DUP@x.com"),
      }),
    );
    expect((await store.resolve("WORK")).sub).toBe("s1");
    expect((await store.resolve("A@X.com")).sub).toBe("s1");
    expect((await store.resolve("s2")).sub).toBe("s2");
    expect(await code(store.resolve("dup@x.com"))).toBe("ambiguous");
    const nf = await store.resolve("nobody@x.com").catch((e: StoreError) => e);
    expect(nf).toMatchObject({ code: "not_found" });
    expect((nf as StoreError).message).toContain("a@x.com");
  });
  it("aliases are unique (ci) and well-formed", async () => {
    const store = new GoogleStore(memoryCredentials({ [acctKey("s1")]: account("s1", "a@x.com", { alias: "work" }), [acctKey("s2")]: account("s2", "b@x.com") }));
    expect(await code(store.setAlias("s2", "WORK"))).toBe("alias_taken");
    expect(await code(store.setAlias("s2", "bad alias!"))).toBe("invalid_alias");
    expect((await store.setAlias("s2", undefined)).alias).toBeUndefined();
  });
  it("markReauthIf / storeTokensIf only touch the grant they were issued for (a concurrent re-auth wins)", async () => {
    const store = new GoogleStore(memoryCredentials({ [acctKey("s1")]: account("s1", "a@x.com") }));
    expect(await store.markReauthIf("s1", "STALE")).toBe(false);
    await store.storeTokensIf("s1", "STALE", { access: "X", expires: 5 });
    expect((await store.get("s1"))?.grant.access).toBe("ACCESS-s1");
    await store.storeTokensIf("s1", "REFRESH-s1", { access: "X", expires: 5, refresh: "ROT" });
    expect((await store.get("s1"))?.grant).toMatchObject({ access: "X", refresh: "ROT" });
    expect(await store.markReauthIf("s1", "ROT")).toBe(true);
    expect((await store.get("s1"))?.grant.status).toBe("reauth_required");
  });
  it("hasRoomForAccount: a reconnect of an existing account is allowed on a full store, a new one is not (B17)", async () => {
    const full = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`acct:f${i}`, account(`f${i}`, `f${i}@x.com`)]));
    const store = new GoogleStore(memoryCredentials(full));
    expect(await store.hasRoomForAccount()).toBe(false);
    expect(await store.hasRoomForAccount("f3")).toBe(true);
  });
  it("summaries never carry tokens", async () => {
    const a = account("s1", "a@x.com");
    const s = summarize(a as never);
    expect(JSON.stringify(s)).not.toMatch(/REFRESH|ACCESS/);
  });
});

describe("disclosure + import ledger records", () => {
  it("round-trips", async () => {
    const store = new GoogleStore(memoryCredentials());
    expect(await store.getDisclosure()).toBeUndefined();
    await store.acceptDisclosure(3, 9);
    expect(await store.getDisclosure()).toEqual({ version: 3, acceptedAt: 9 });
    expect(await store.getImportLedger()).toEqual({ subs: [], client: false });
    await store.setImportLedger({ subs: ["a"], client: true });
    expect(await store.getImportLedger()).toEqual({ subs: ["a"], client: true });
  });
});
