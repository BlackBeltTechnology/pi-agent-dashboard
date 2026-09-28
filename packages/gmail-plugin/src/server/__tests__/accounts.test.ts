/**
 * L1 account-store tests (test-plan E6, E7, E10, E11).
 * See change: add-gmail-plugin.
 */
import { describe, expect, it } from "vitest";
import { memoryCredentials } from "../../__tests__/fakes.js";
import { AccountError, AccountStore, acctKey } from "../accounts.js";

function acct(sub: string, email: string, alias?: string) {
  return {
    sub,
    email,
    ...(alias ? { alias } : {}),
    tier: "readonly",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    refresh: `r-${sub}`,
    access: `a-${sub}`,
    expires: Date.now() + 3_600_000,
    status: "ok",
    addedAt: 1,
  };
}

describe("E10 — account resolution", () => {
  const creds = memoryCredentials({
    [acctKey("s1")]: acct("s1", "a@x.com", "work"),
    [acctKey("s2")]: acct("s2", "B@y.com"),
    [acctKey("s3")]: acct("s3", "dup@z.com"),
    [acctKey("s4")]: acct("s4", "dup@z.com"),
  });
  const store = new AccountStore(creds);

  it("resolves an alias", async () => {
    expect((await store.resolve("work")).sub).toBe("s1");
  });
  it("resolves an email case-insensitively", async () => {
    expect((await store.resolve("b@Y.com")).sub).toBe("s2");
  });
  it("same email on two subs is ambiguous and asks for an alias", async () => {
    await expect(store.resolve("dup@z.com")).rejects.toMatchObject({ code: "ambiguous", message: expect.stringMatching(/alias/) });
  });
  it("unknown ref lists the known aliases/emails", async () => {
    const err = await store.resolve("nobody").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountError);
    expect((err as AccountError).code).toBe("not_found");
    expect((err as Error).message).toContain("work (a@x.com)");
    expect((err as Error).message).toContain("B@y.com");
  });
});

describe("E11 — alias uniqueness", () => {
  it("rejects an alias already used by another account", async () => {
    const store = new AccountStore(
      memoryCredentials({ [acctKey("s1")]: acct("s1", "a@x.com", "work"), [acctKey("s2")]: acct("s2", "b@y.com") }),
    );
    await expect(store.setAlias("s2", "work")).rejects.toMatchObject({ code: "alias_taken" });
    await expect(store.setAlias("s2", "WORK")).rejects.toMatchObject({ code: "alias_taken" });
    expect((await store.get("s2"))?.alias).toBeUndefined();
  });
});

describe("E6 — missing refresh token on a new account", () => {
  it("fails with the revoke-and-retry message and writes nothing", async () => {
    const creds = memoryCredentials();
    const store = new AccountStore(creds);
    const err = await store
      .upsertFromSignIn({ sub: "new", email: "n@x.com", tier: "readonly", scopes: [], access: "a", expires: 1 })
      .catch((e: unknown) => e);
    expect((err as AccountError).code).toBe("missing_refresh");
    expect((err as Error).message).toMatch(/myaccount\.google\.com\/permissions.*retry/);
    expect(creds.data.size).toBe(0);
  });
});

describe("E7 — re-auth updates in place", () => {
  it("keeps one record and the alias, updates the email", async () => {
    const creds = memoryCredentials({ [acctKey("s1")]: acct("s1", "old@x.com", "work") });
    const store = new AccountStore(creds);
    await store.upsertFromSignIn({
      sub: "s1",
      email: "new@x.com",
      tier: "send",
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
      access: "a2",
      refresh: "r2",
      expires: 5,
    });
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ sub: "s1", alias: "work", email: "new@x.com", tier: "send", refresh: "r2", addedAt: 1, status: "ok" });
  });

  it("re-auth without a new refresh token keeps the old one", async () => {
    const creds = memoryCredentials({ [acctKey("s1")]: acct("s1", "a@x.com") });
    const store = new AccountStore(creds);
    await store.upsertFromSignIn({ sub: "s1", email: "a@x.com", tier: "readonly", scopes: [], access: "a2", expires: 5 });
    expect((await store.get("s1"))?.refresh).toBe("r-s1");
  });
});

describe("CodeRabbit — alias uniqueness under concurrency", () => {
  it("two concurrent PATCHes of the same alias: exactly one wins", async () => {
    const store = new AccountStore(memoryCredentials({ [acctKey("s1")]: acct("s1", "a@x.com"), [acctKey("s2")]: acct("s2", "b@y.com") }));
    const results = await Promise.allSettled([store.setAlias("s1", "work"), store.setAlias("s2", "work")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await store.list()).filter((a) => a.alias === "work")).toHaveLength(1);
  });
});
