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
