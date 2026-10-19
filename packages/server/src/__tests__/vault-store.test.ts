/**
 * vault-store: account storage, 0600 + no-file-before-first-add, unknown-field
 * preservation, concurrency, and corrupt-file refusal with content-free errors.
 * Runs under the fresh tmp $HOME per test file.
 * See change: add-credential-vault (test-plan E1–E5).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetQuarantineDedupForTests } from "../auth/locked-json-file.js";
import { createVaultStore, MIN_VALUE_LENGTH, VaultError } from "../vault/vault-store.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-store-"));
  file = path.join(dir, "vault.json");
  _resetQuarantineDedupForTests();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const add = (store: ReturnType<typeof createVaultStore>, value: string, label = "personal") =>
  store.addAccount({ provider: "gemini", label, value });

describe("vault store — account storage", () => {
  it("E1: values of 7 characters are rejected, 8 and 9 are stored", async () => {
    const store = createVaultStore(file);
    expect(MIN_VALUE_LENGTH).toBe(8);
    await expect(add(store, "1234567")).rejects.toMatchObject({ name: "VaultError", code: "value_too_short" });
    expect(fs.existsSync(file)).toBe(false);
    await add(store, "12345678", "eight");
    await add(store, "123456789", "nine");
    expect((await store.listAccounts()).map((a) => a.label).sort()).toEqual(["eight", "nine"]);
  });

  it.skipIf(process.platform === "win32")("E2: no file after listing; mode 0600 after the first add", async () => {
    const store = createVaultStore(file);
    expect(await store.listAccounts()).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);
    await add(store, "abcdefgh12");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("E3: an account of an unknown kind and namespace is byte-identical after a write", async () => {
    const unknown = { id: "x1", provider: "p", kind: "oauth", namespace: "service:x", label: "svc", extra: { n: [1, 2] }, value: "zzzzzzzzzz" };
    fs.writeFileSync(file, JSON.stringify({ futureField: { a: 1 }, accounts: [unknown] }), { mode: 0o600 });
    const store = createVaultStore(file);
    await add(store, "abcdefgh12");
    const after = JSON.parse(fs.readFileSync(file, "utf-8")) as { accounts: unknown[]; futureField: unknown };
    expect(JSON.stringify(after.accounts[0])).toBe(JSON.stringify(unknown));
    expect(after.futureField).toEqual({ a: 1 });
    expect(after.accounts).toHaveLength(2);
  });

  it("E4: two concurrent adds both survive", async () => {
    const store = createVaultStore(file);
    await Promise.all([add(store, "abcdefgh12", "a"), add(store, "abcdefgh34", "b")]);
    expect((await store.listAccounts()).map((a) => a.label).sort()).toEqual(["a", "b"]);
  });

  it("listings never carry a stored value", async () => {
    const store = createVaultStore(file);
    const view = await add(store, "abcdefgh12");
    expect(JSON.stringify(view)).not.toContain("abcdefgh12");
    expect(JSON.stringify(await store.listAccounts())).not.toContain("abcdefgh12");
    expect(store.getKeyValue(view.id)).toBe("abcdefgh12");
  });

  it("getKeyValue returns nothing for a non-key kind", async () => {
    fs.writeFileSync(file, JSON.stringify({ accounts: [{ id: "o1", provider: "p", kind: "oauth", namespace: "user", label: "l", value: "zzzzzzzzzz" }] }));
    expect(createVaultStore(file).getKeyValue("o1")).toBeUndefined();
  });
});

describe("vault store — corrupt file", () => {
  it("E5: refuses the write, keeps a byte-equal backup, and leaks no content", async () => {
    const bytes = '{"a":"sk-live-ABCDEFGH';
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    const store = createVaultStore(file);
    const err = await add(store, "abcdefgh12").then(() => null, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(VaultError);
    expect((err as VaultError).code).toBe("vault_corrupt");
    expect(err?.message).not.toContain("sk-live");
    expect(fs.readFileSync(file, "utf-8")).toBe(bytes);
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith("vault.json.corrupt-"));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, backups[0]), "utf-8")).toBe(bytes);
    expect(err?.message).toContain(backups[0]);
    const status = await store.status();
    expect(status).toMatchObject({ state: "corrupt" });
    expect(JSON.stringify(status)).not.toContain("sk-live");
  });
});

describe("vault store — owner-only check (task 2.7)", () => {
  it.skipIf(process.platform === "win32")("POSIX: reads the mode bits", async () => {
    const { checkOwnerOnly } = await import("../vault/vault-permissions.js");
    expect(checkOwnerOnly(file)).toEqual({ ok: false, basis: "missing" });
    fs.writeFileSync(file, "{}", { mode: 0o600 });
    expect(checkOwnerOnly(file)).toEqual({ ok: true, basis: "mode" });
    fs.chmodSync(file, 0o644);
    expect(checkOwnerOnly(file)).toEqual({ ok: false, basis: "mode" });
  });

  it("Windows: accepted only inside the profile directory", async () => {
    const { checkOwnerOnly } = await import("../vault/vault-permissions.js");
    fs.writeFileSync(file, "{}");
    expect(checkOwnerOnly(file, { platform: "win32", home: dir })).toEqual({ ok: true, basis: "profile-acl-inherited" });
    expect(checkOwnerOnly(file, { platform: "win32", home: path.join(dir, "other") })).toEqual({ ok: false, basis: "outside-profile" });
  });
});

describe("vault store — tls-solver accounts (add-acme-dns01-certs E12, E31, E15 vault part)", () => {
  const CF = "cf-secret-1234567890";
  const CF2 = "cf-secret-0987654321";
  const tlsAccounts = (f: string) =>
    (JSON.parse(fs.readFileSync(f, "utf8")).accounts as Array<Record<string, unknown>>).filter((a) => a.kind === "tls-solver");

  it.skipIf(process.platform === "win32")("E12: two upserts leave ONE account holding the second value, mode 0600", async () => {
    const store = createVaultStore(file);
    const entry = (value: string) => ({ sourceId: "home", provider: "cloudflare", entries: [{ label: "cloudflareToken", value }] });
    await store.upsertTlsSecrets(entry(CF));
    const first = (await store.listAccounts())[0];
    await store.upsertTlsSecrets(entry(CF2));
    const accounts = await store.listAccounts();
    expect(accounts).toEqual([{ id: first.id, provider: "cloudflare", kind: "tls-solver", namespace: "tls:home", label: "cloudflareToken" }]);
    expect(await store.readTlsSecret("home", "cloudflareToken")).toBe(CF2);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(tlsAccounts(file)).toHaveLength(1);
  });

  it("listings never carry the value; generic getKeyValue / rotateAccount refuse the account", async () => {
    const store = createVaultStore(file);
    await store.upsertTlsSecrets({ sourceId: "home", provider: "cloudflare", entries: [{ label: "cloudflareToken", value: CF }] });
    const [acc] = await store.listAccounts();
    expect(JSON.stringify(acc)).not.toContain(CF);
    expect(store.getKeyValue(acc.id)).toBeUndefined();
    await expect(store.rotateAccount(acc.id, "another-value-123")).rejects.toMatchObject({ code: "not_found" });
    expect(await store.readTlsSecret("home", "cloudflareToken")).toBe(CF);
  });

  it("keeps the 8-character minimum", async () => {
    const store = createVaultStore(file);
    await expect(
      store.upsertTlsSecrets({ sourceId: "home", provider: "cloudflare", entries: [{ label: "cloudflareToken", value: "1234567" }] }),
    ).rejects.toMatchObject({ code: "value_too_short" });
    expect(fs.existsSync(file)).toBe(false);
  });

  it("E31: acme-dns pair is atomic — a failing 2nd label leaves the 1st unchanged", async () => {
    const store = createVaultStore(file);
    const pair = (user: string, key: string) => ({
      sourceId: "home",
      provider: "acme-dns",
      entries: [{ label: "acmeDnsUser", value: user }, { label: "acmeDnsKey", value: key }],
    });
    // fresh vault: nothing written
    await expect(store.upsertTlsSecrets(pair("user-aaaaaaaa", "short"))).rejects.toMatchObject({ code: "value_too_short" });
    expect(fs.existsSync(file)).toBe(false);
    // existing pair: nothing changed
    await store.upsertTlsSecrets(pair("user-aaaaaaaa", "key-aaaaaaaaaa"));
    const before = fs.readFileSync(file, "utf8");
    await expect(store.upsertTlsSecrets(pair("user-bbbbbbbb", "short"))).rejects.toMatchObject({ code: "value_too_short" });
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(await store.readTlsSecret("home", "acmeDnsUser")).toBe("user-aaaaaaaa");
  });

  it("E31: an I/O failure while persisting the pair leaves both labels unchanged", async () => {
    const store = createVaultStore(file);
    const pair = (user: string, key: string) => ({
      sourceId: "home",
      provider: "acme-dns",
      entries: [{ label: "acmeDnsUser", value: user }, { label: "acmeDnsKey", value: key }],
    });
    await store.upsertTlsSecrets(pair("user-aaaaaaaa", "key-aaaaaaaaaa"));
    const before = fs.readFileSync(file, "utf8");
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("disk full"); });
    await expect(store.upsertTlsSecrets(pair("user-bbbbbbbb", "key-bbbbbbbbbb"))).rejects.toThrow("disk full");
    rename.mockRestore();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(await store.readTlsSecret("home", "acmeDnsUser")).toBe("user-aaaaaaaa");
    expect(await store.readTlsSecret("home", "acmeDnsKey")).toBe("key-aaaaaaaaaa");
  });

  it("deleteTlsNamespace / listTlsNamespaces: only that namespace, other accounts and unknown kinds untouched", async () => {
    const store = createVaultStore(file);
    await add(store, "user-key-0001", "mine");
    await store.upsertTlsSecrets({ sourceId: "home", provider: "cloudflare", entries: [{ label: "cloudflareToken", value: CF }] });
    await store.upsertTlsSecrets({ sourceId: "lab", provider: "cloudflare", entries: [{ label: "cloudflareToken", value: CF2 }] });
    expect((await store.listTlsNamespaces()).sort()).toEqual(["home", "lab"]);
    await store.deleteTlsNamespace("home");
    expect(await store.listTlsNamespaces()).toEqual(["lab"]);
    expect(await store.readTlsSecret("home", "cloudflareToken")).toBeNull();
    expect((await store.listAccounts()).map((a) => a.label).sort()).toEqual(["cloudflareToken", "mine"]);
  });

  it("deleteTlsNamespace writes nothing when there is nothing to delete (no vault file created)", async () => {
    const store = createVaultStore(file);
    await store.deleteTlsNamespace("home");
    expect(fs.existsSync(file)).toBe(false);
    await add(store, "user-key-0001");
    const before = fs.statSync(file).mtimeMs;
    const onChange = vi.fn();
    store.onChange(onChange);
    await store.deleteTlsNamespace("home");
    expect(onChange).not.toHaveBeenCalled();
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });

  it("unknown kinds still round-trip through a tls upsert", async () => {
    const unknown = { id: "x1", provider: "p", kind: "future-kind", namespace: "future:z", label: "l", value: "future-secret" };
    fs.writeFileSync(file, JSON.stringify({ futureField: { a: 1 }, accounts: [unknown] }), { mode: 0o600 });
    const store = createVaultStore(file);
    await store.upsertTlsSecrets({ sourceId: "home", provider: "cloudflare", entries: [{ label: "cloudflareToken", value: CF }] });
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(doc.futureField).toEqual({ a: 1 });
    expect(doc.accounts[0]).toEqual(unknown);
  });

  it("a corrupt vault refuses writes and secret reads; listTlsNamespaces is empty", async () => {
    fs.writeFileSync(file, "{ not json", { mode: 0o600 });
    const store = createVaultStore(file);
    await expect(
      store.upsertTlsSecrets({ sourceId: "home", provider: "cloudflare", entries: [{ label: "cloudflareToken", value: CF }] }),
    ).rejects.toMatchObject({ code: "vault_corrupt" });
    await expect(store.readTlsSecret("home", "cloudflareToken")).rejects.toMatchObject({ code: "vault_corrupt" });
    await expect(store.deleteTlsNamespace("home")).rejects.toMatchObject({ code: "vault_corrupt" });
    expect(await store.listTlsNamespaces()).toEqual([]);
  });
});
