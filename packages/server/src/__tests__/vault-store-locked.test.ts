/**
 * vault-store × credential encryption: codec required, lazy key creation,
 * locked / not-writable / corrupt states, before-init refusals, newer format,
 * headless Linux. Stores are built either over a test codec (fixed key) or over
 * the process singleton fed by an injected stub keychain: never a real keychain.
 * See change: encrypt-credentials-at-rest (test-plan E17, E20, E21, E26, E27, E28, E36, E37, X11, X12).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeEnvelope, encodeEnvelope } from "../auth/credential-envelope.js";
import { _resetCredentialKeyForTests, getCredentialCodec, getCredentialKeyState, initCredentialKey } from "../auth/credential-key.js";
import { _resetQuarantineDedupForTests } from "../auth/locked-json-file.js";
import { createVaultStore, VaultError, type VaultStore } from "../vault/vault-store.js";
import {
  b64,
  filePath,
  KEY_1,
  KEY_2,
  logSink,
  resetCredentialFiles,
  sha256,
  stubKeychain,
  writeEnvelopeFile,
  writePlain,
} from "./helpers/credential-key-kit.js";
import { keylessVaultCodec, readVaultDoc, testVaultCodec } from "./helpers/vault-test-codec.js";

const ACCOUNT = { id: "a1", provider: "gemini", kind: "key", namespace: "user", label: "personal", value: "val-P8gN4vY6rM3a" };
const MARKER = "val-P8gN4vY6rM3a";
const MAGIC = "pi-dashboard-encrypted:v1";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-locked-"));
  file = path.join(dir, "vault.json");
  _resetCredentialKeyForTests();
  _resetQuarantineDedupForTests();
  resetCredentialFiles();
});
afterEach(() => {
  _resetCredentialKeyForTests();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const add = (store: VaultStore, value = "abcdefgh12", label = "personal") => store.addAccount({ provider: "gemini", label, value });
const attempt = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as Error);
const noCorruptSiblings = (d: string) => fs.readdirSync(d).filter((f) => f.includes(".corrupt-"));
const singletonStore = () => createVaultStore({ codec: getCredentialCodec("vault") });
const lockedOnKeyB = (): VaultStore => {
  fs.writeFileSync(file, encodeEnvelope({ accounts: [ACCOUNT] }, KEY_1, "vault"), { mode: 0o600 });
  return createVaultStore({ codec: testVaultCodec(KEY_2), path: file });
};

describe("E26: codec required (vault half)", () => {
  it("createVaultStore without a codec does not compile and throws before touching the file", () => {
    fs.writeFileSync(file, "{}\n");
    const before = sha256(file);
    // @ts-expect-error the codec is a required option (D1)
    expect(() => createVaultStore({ path: file })).toThrow(/codec/i);
    // @ts-expect-error `createVaultStore({})` is the same mistake
    expect(() => createVaultStore({})).toThrow(/codec/i);
    expect(sha256(file)).toBe(before);
  });
});

describe("E17: lazy: no files → no keychain", () => {
  it("init with empty HOME stays deferred, never touches the keychain and creates no file", async () => {
    const kc = stubKeychain(null);
    const sink = logSink();
    await initCredentialKey({ entryFactory: kc.factory, log: sink.log });
    expect(getCredentialKeyState().state).toBe("deferred");
    expect(sink.lines.join("\n")).toContain("state=deferred");
    const store = singletonStore();
    expect(await store.status()).toEqual({ state: "absent" });
    expect(await store.listAccounts()).toEqual([]);
    expect(kc.calls.get + kc.calls.set).toBe(0);
    expect(fs.existsSync(filePath("vault"))).toBe(false);
    expect(fs.existsSync(filePath("plugin-credentials"))).toBe(false);
  });
});

describe("E21: first write creates the key", () => {
  it("the first account creates the key once and writes an envelope; writes 2–3 make no keychain call", async () => {
    const kc = stubKeychain(null);
    await initCredentialKey({ entryFactory: kc.factory, log: logSink().log });
    const store = singletonStore();
    await add(store, "abcdefgh12", "one");
    expect(kc.calls.set).toBe(1);
    expect(fs.readFileSync(filePath("vault"), "utf8").split("\n")[0]).toBe(MAGIC);
    const afterFirst = { ...kc.calls };
    await add(store, "abcdefgh34", "two");
    await add(store, "abcdefgh56", "three");
    expect(kc.calls.get).toBe(afterFirst.get);
    expect(kc.calls.set).toBe(afterFirst.set);
    expect((await store.listAccounts()).map((a) => a.label).sort()).toEqual(["one", "three", "two"]);
    expect(fs.readFileSync(filePath("vault"), "utf8")).not.toContain("abcdefgh12");
  });
});

describe("E20: lost key not replaced", () => {
  it("an encrypted vault with an empty keychain stays key_missing: no setPassword, add refused, bytes unchanged", async () => {
    writeEnvelopeFile("vault", { accounts: [ACCOUNT] }, KEY_1);
    const before = sha256(filePath("vault"));
    const kc = stubKeychain(null);
    await initCredentialKey({ entryFactory: kc.factory, log: logSink().log });
    const store = singletonStore();
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "key_missing" });
    expect(await store.status()).toEqual({ state: "locked", reason: "key_missing" });
    const err = await attempt(add(store));
    expect(err).toBeInstanceOf(VaultError);
    expect(err).toMatchObject({ code: "vault_locked", reason: "key_missing" });
    expect(kc.calls.set).toBe(0);
    expect(sha256(filePath("vault"))).toBe(before);
    expect(noCorruptSiblings(path.dirname(filePath("vault")))).toEqual([]);
  });
});

describe("E27: before init, encrypted", () => {
  it("is locked key_uninitialized; the add is refused; bytes unchanged", async () => {
    writeEnvelopeFile("vault", { accounts: [ACCOUNT] }, KEY_1);
    const before = sha256(filePath("vault"));
    const store = singletonStore(); // initCredentialKey NOT called
    expect(await store.status()).toEqual({ state: "locked", reason: "key_uninitialized" });
    expect(await attempt(add(store))).toMatchObject({ code: "vault_locked", reason: "key_uninitialized" });
    expect(sha256(filePath("vault"))).toBe(before);
  });
});

describe("E28: before init, plaintext", () => {
  it("lists the accounts; the add is refused with key_uninitialized; bytes unchanged", async () => {
    writePlain("vault", { accounts: [ACCOUNT] });
    const before = sha256(filePath("vault"));
    const store = singletonStore();
    expect((await store.listAccounts()).map((a) => a.id)).toEqual(["a1"]);
    expect(await attempt(add(store))).toMatchObject({ code: "vault_locked", reason: "key_uninitialized" });
    expect(sha256(filePath("vault"))).toBe(before);
  });
});

describe("E36: locked vault reads", () => {
  it("getKeyValue undefined, listTlsNamespaces [], readTlsSecret and deleteTlsNamespace throw vault_locked", async () => {
    const store = lockedOnKeyB();
    expect(await store.status()).toEqual({ state: "locked", reason: "key_mismatch" });
    expect(store.getKeyValue("a1")).toBeUndefined();
    expect(await store.listTlsNamespaces()).toEqual([]);
    expect(await attempt(store.readTlsSecret("home", "cloudflareToken"))).toMatchObject({ code: "vault_locked", reason: "key_mismatch" });
    expect(await attempt(store.deleteTlsNamespace("home"))).toMatchObject({ code: "vault_locked", reason: "key_mismatch" });
    expect(await store.listAccounts()).toEqual([]);
  });

  it("a locked vault never leaks file content in an error or the status", async () => {
    const store = lockedOnKeyB();
    const err = await attempt(add(store));
    expect(`${err?.message}${JSON.stringify(err)}${JSON.stringify(await store.status())}`).not.toContain(MARKER);
  });
});

describe("E37: corrupt vault unchanged", () => {
  it("{not json: add refused as vault_corrupt, byte-exact backup, no file bytes in the error, status corrupt with the backup", async () => {
    const bytes = "{not json sk-live-ABCDEFGH";
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    const store = createVaultStore({ codec: testVaultCodec(), path: file });
    const err = await attempt(add(store));
    expect(err).toMatchObject({ code: "vault_corrupt" });
    expect(err?.message).not.toContain("sk-live");
    expect(fs.readFileSync(file, "utf8")).toBe(bytes);
    const backups = noCorruptSiblings(dir);
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, backups[0]), "utf8")).toBe(bytes);
    expect(await store.status()).toMatchObject({ state: "corrupt", backup: path.join(dir, backups[0]) });
  });
});

describe("E40 (store half): plaintext vault, no key", () => {
  it("is readable and reports ok writable:false; every write is refused vault_locked; bytes unchanged", async () => {
    fs.writeFileSync(file, `${JSON.stringify({ accounts: [ACCOUNT] }, null, 2)}\n`, { mode: 0o600 });
    const before = sha256(file);
    const store = createVaultStore({ codec: keylessVaultCodec("keychain_unavailable"), path: file });
    expect(await store.status()).toEqual({ state: "ok", writable: false, reason: "keychain_unavailable" });
    expect((await store.listAccounts()).map((a) => a.id)).toEqual(["a1"]);
    expect(store.getKeyValue("a1")).toBe(MARKER);
    const err = await attempt(add(store));
    expect(err).toMatchObject({ code: "vault_locked", reason: "keychain_unavailable" });
    expect(err?.message).toContain("PI_DASHBOARD_DATA_KEY_FILE");
    expect(await attempt(store.rotateAccount("a1", "rotated-value-1"))).toMatchObject({ code: "vault_locked" });
    expect(sha256(file)).toBe(before);
  });

  it("a plaintext vault with a ready key is plainly ok (no writable flag) and is encrypted by the next write", async () => {
    fs.writeFileSync(file, `${JSON.stringify({ accounts: [ACCOUNT] }, null, 2)}\n`, { mode: 0o600 });
    const store = createVaultStore({ codec: testVaultCodec(), path: file });
    expect(await store.status()).toEqual({ state: "ok" });
    await add(store, "abcdefgh12", "second");
    expect(fs.readFileSync(file, "utf8").split("\n")[0]).toBe(MAGIC);
    expect((readVaultDoc(file).accounts as unknown[]).length).toBe(2);
  });
});

describe("X11: newer format never overwritten", () => {
  it("pi-dashboard-encrypted:v2 is locked unsupported_format: add refused, bytes unchanged, no .corrupt-*", async () => {
    fs.writeFileSync(file, "pi-dashboard-encrypted:v2\n{}\n", { mode: 0o600 });
    const before = sha256(file);
    const store = createVaultStore({ codec: testVaultCodec(), path: file });
    expect(await store.status()).toEqual({ state: "locked", reason: "unsupported_format" });
    expect(await attempt(add(store))).toMatchObject({ code: "vault_locked", reason: "unsupported_format" });
    expect(sha256(file)).toBe(before);
    expect(noCorruptSiblings(dir)).toEqual([]);
  });
});

describe("X12 (store half): headless Linux, no keyring", () => {
  it("a provider that throws 'no session bus' refuses the add with keychain_unavailable naming the key file env", async () => {
    const files = writePlain("vault", { accounts: [ACCOUNT] });
    const before = sha256(files);
    const noBus = () => { throw new Error("Couldn't access platform storage: NoStorageAccess (no session bus)"); };
    await initCredentialKey({ entryFactory: () => ({ getPassword: noBus, setPassword: noBus }), log: logSink().log });
    const store = singletonStore();
    expect(await store.status()).toEqual({ state: "ok", writable: false, reason: "keychain_unavailable" });
    const err = await attempt(add(store));
    expect(err).toMatchObject({ code: "vault_locked", reason: "keychain_unavailable" });
    expect(err?.message).toContain("PI_DASHBOARD_DATA_KEY_FILE");
    expect(sha256(files)).toBe(before);
  });
});

describe("round trip", () => {
  it("writes are envelopes that decrypt to the document; the plaintext marker is never on disk", async () => {
    const store = createVaultStore({ codec: testVaultCodec(), path: file });
    await add(store, MARKER, "lbl-K5dF9sJ2qW7e");
    const raw = fs.readFileSync(file, "utf8");
    expect(raw).not.toContain(MARKER);
    expect(raw).not.toContain("lbl-K5dF9sJ2qW7e");
    expect(decodeEnvelope(fs.readFileSync(file), KEY_1, "vault").kind).toBe("document");
    expect(b64(KEY_1)).not.toBe("");
  });
});
