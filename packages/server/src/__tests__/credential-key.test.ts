/**
 * Data key module: key-file source, keychain source through an injected
 * provider, lazy creation, caching and the fail-closed singleton codec
 * (test-plan E11–E16, E18, E19, E22–E25, X23). Tests never touch a real
 * keychain (D9): an in-process stub provider is injected.
 *
 * The store layer arrives in later waves; `writeVia` (helpers) models a store
 * write: ensure the key, then write through the singleton codec under lock.
 * See change: encrypt-credentials-at-rest (D4, D6, D9; tasks 3.1, 14).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeEnvelope, deriveKid } from "../auth/credential-envelope.js";
import {
  _resetCredentialKeyForTests,
  ensureCredentialKey,
  getCredentialCodec,
  getCredentialKeyState,
  initCredentialKey,
} from "../auth/credential-key.js";
import { readJsonChecked, writeJsonAtomic } from "../auth/locked-json-file.js";
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
  writeKeyFile,
  writePlain,
  writeVia,
} from "./helpers/credential-key-kit.js";

// E25 spy: the real binding must never be resolved from the main thread under VITEST.
const bindingLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock("@napi-rs/keyring", () => {
  bindingLoads.count++;
  return { Entry: class {} };
});

const ENV_KEY = "PI_DASHBOARD_DATA_KEY_FILE";
const isWin = process.platform === "win32"; // platform-branch-ok: POSIX-mode tests are skipped on win32
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

beforeEach(() => {
  _resetCredentialKeyForTests();
  resetCredentialFiles();
});
afterEach(() => {
  _resetCredentialKeyForTests();
  vi.restoreAllMocks();
});

const rawKid = (id: "vault" | "plugin-credentials") => {
  const header = JSON.parse(fs.readFileSync(filePath(id), "utf8").split("\n")[1]);
  return header.kid as string;
};

describe("key file source (E11–E16, E18)", () => {
  it("E11: key file takes precedence over the keychain", async () => {
    const keyFile = writeKeyFile(b64(KEY_1));
    const kc = stubKeychain(b64(KEY_2));
    await initCredentialKey({ env: { [ENV_KEY]: keyFile }, entryFactory: kc.factory });
    expect(getCredentialKeyState()).toMatchObject({ state: "ready", source: "key-file", kid: deriveKid(KEY_1) });
    await writeVia("vault", { accounts: ["a"] });
    expect(decodeEnvelope(fs.readFileSync(filePath("vault")), KEY_1, "vault").kind).toBe("document");
    expect(kc.calls.get + kc.calls.set).toBe(0);
    expect(kc.calls.ctor).toHaveLength(0);
  });

  const good = b64(KEY_1);
  it.each([
    ["b64(32 B)", good, "ready"],
    ["b64(32 B)+LF", `${good}\n`, "ready"],
    ["b64(31 B)", b64(Buffer.alloc(31, 1)), "key_file_invalid"],
    ["b64(33 B)", b64(Buffer.alloc(33, 1)), "key_file_invalid"],
    ["empty", "", "key_file_invalid"],
    ["!!!", "!!!", "key_file_invalid"],
    ["b64+LF LF", `${good}\n\n`, "key_file_invalid"],
  ])("E12: key file content %s → %s, keychain never consulted", async (_n, content, want) => {
    const kc = stubKeychain(b64(KEY_2));
    await initCredentialKey({ env: { [ENV_KEY]: writeKeyFile(content) }, entryFactory: kc.factory });
    const st = getCredentialKeyState();
    if (want === "ready") expect(st.state).toBe("ready");
    else expect(st).toMatchObject({ state: "unavailable", reason: want });
    expect(kc.calls.ctor).toHaveLength(0);
  });

  it.skipIf(isWin).each([
    [0o600, "ready"],
    [0o400, "ready"],
    [0o640, "key_file_insecure"],
    [0o644, "key_file_insecure"],
    [0o604, "key_file_insecure"],
  ])("E13: key file mode %o → %s", async (mode, want) => {
    const kc = stubKeychain(b64(KEY_2));
    await initCredentialKey({ env: { [ENV_KEY]: writeKeyFile(b64(KEY_1), mode) }, entryFactory: kc.factory });
    const st = getCredentialKeyState();
    if (want === "ready") expect(st.state).toBe("ready");
    else expect(st).toMatchObject({ state: "unavailable", reason: want });
    expect(kc.calls.ctor).toHaveLength(0);
  });

  it("E14: win32 (injected) — key inside the profile is ready, outside is key_file_insecure (outside-profile)", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-win-home-"));
    const inside = path.join(home, "k");
    fs.writeFileSync(inside, b64(KEY_1));
    const outside = writeKeyFile(b64(KEY_1));
    await initCredentialKey({ env: { [ENV_KEY]: inside }, platform: "win32", homeDir: home });
    expect(getCredentialKeyState().state).toBe("ready");
    _resetCredentialKeyForTests();
    await initCredentialKey({ env: { [ENV_KEY]: outside }, platform: "win32", homeDir: home });
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "key_file_insecure", detail: "outside-profile" });
  });

  it("E15: a missing key file is key_file_missing; the write is refused; no file is created", async () => {
    const missing = path.join(os.tmpdir(), `pi-nokey-${Date.now()}`, "data-key");
    const kc = stubKeychain(b64(KEY_2));
    await initCredentialKey({ env: { [ENV_KEY]: missing }, entryFactory: kc.factory });
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "key_file_missing" });
    await expect(writeVia("vault", { a: 1 })).rejects.toMatchObject({ code: "credential_locked", reason: "key_file_missing" });
    expect(fs.existsSync(missing)).toBe(false);
    expect(fs.existsSync(path.dirname(missing))).toBe(false);
    expect(fs.existsSync(filePath("vault"))).toBe(false);
    expect(kc.calls.ctor).toHaveLength(0);
  });

  it("E16: the server never writes the key file", async () => {
    const keyFile = writeKeyFile(b64(KEY_1));
    const before = { sha: sha256(keyFile), mtime: fs.statSync(keyFile).mtimeMs };
    await initCredentialKey({ env: { [ENV_KEY]: keyFile } });
    for (let i = 0; i < 10; i++) await writeVia(i % 2 ? "vault" : "plugin-credentials", { i });
    expect(sha256(keyFile)).toBe(before.sha);
    expect(fs.statSync(keyFile).mtimeMs).toBe(before.mtime);
    expect(fs.readdirSync(path.dirname(keyFile))).toEqual(["data-key"]);
  });

  it("E18: an unusable key file (directory) is key_file_invalid; CRLF is ready", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-keydir-"));
    await initCredentialKey({ env: { [ENV_KEY]: dir } });
    expect(getCredentialKeyState()).toMatchObject({ reason: "key_file_invalid" });
    _resetCredentialKeyForTests();
    await initCredentialKey({ env: { [ENV_KEY]: writeKeyFile(`${b64(KEY_1)}\r\n`) } });
    expect(getCredentialKeyState().state).toBe("ready");
  });

  it.skipIf(isWin || isRoot)("E18: an unreadable key file (mode 0000) is key_file_invalid", async () => {
    await initCredentialKey({ env: { [ENV_KEY]: writeKeyFile(b64(KEY_1), 0o000) } });
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "key_file_invalid" });
  });

  it.each(["short", "not-base64-!!!-not-base64-!!!-not-base64-!!!"])(
    "E18: malformed keychain value %j is keychain_unavailable and never overwritten",
    async (value) => {
      writePlain("plugin-credentials", { p: { k: { v: 1 } } });
      const kc = stubKeychain(value);
      await initCredentialKey({ env: {}, entryFactory: kc.factory });
      expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "keychain_unavailable" });
      expect(kc.calls.set).toBe(0);
      expect(kc.value).toBe(value);
      await expect(writeVia("plugin-credentials", { p: 1 })).rejects.toMatchObject({ reason: "keychain_unavailable" });
    },
  );
});

describe("keychain source through an injected provider (E19, E22–E25, X23)", () => {
  it("E19: plaintext triggers creation at startup; the file is migrated and still readable", async () => {
    writePlain("plugin-credentials", { gmail: { "a@x.com": { token: "tok-1" } } });
    const kc = stubKeychain(null);
    const sink = logSink();
    await initCredentialKey({ env: {}, entryFactory: kc.factory, log: sink.log });
    expect(kc.calls.order[0]).toBe("get"); // the read finds nothing
    expect(kc.calls.order.slice(-2)).toEqual(["set", "get"]); // create, then the read-back
    expect(kc.calls.set).toBe(1);
    expect(getCredentialKeyState()).toMatchObject({ state: "ready", source: "keychain", created: true });
    // Every Entry is pinned to the Secret Service on Linux (D5).
    for (const [service, account, options] of kc.calls.ctor) {
      expect([service, account]).toEqual(["pi-dashboard-credential-key", "data-key-v1"]);
      expect(options).toEqual({ linux: { store: "secret-service" } });
    }
    // Seam-level migration (the startup migration itself is a later wave): read plaintext, write encoded.
    const f = filePath("plugin-credentials");
    const codec = getCredentialCodec("plugin-credentials");
    const read = readJsonChecked(f, "t", codec);
    expect(read).toMatchObject({ encrypted: false, data: { gmail: { "a@x.com": { token: "tok-1" } } } });
    writeJsonAtomic(f, read.data, undefined, codec);
    expect(fs.readFileSync(f, "utf8").split("\n")[0]).toBe("pi-dashboard-encrypted:v1");
    expect(readJsonChecked(f, "t", codec).data).toEqual({ gmail: { "a@x.com": { token: "tok-1" } } });
    expect(sink.lines.join("\n")).toMatch(/\[credential-key\] source=keychain state=ready .*created=true/);
  });

  it("E22: read-back wins — the file decodes with the stored value, not the one this process generated", async () => {
    const kc = stubKeychain(null, { readBackAfterSet: b64(KEY_2) });
    const sink = logSink();
    await initCredentialKey({ env: {}, entryFactory: kc.factory, log: sink.log });
    expect(getCredentialKeyState().state).toBe("deferred"); // no credential file: no keychain access
    expect(kc.calls.ctor).toHaveLength(0);
    await writeVia("vault", { a: 1 });
    expect(kc.lastSet).not.toBe(b64(KEY_2));
    expect(decodeEnvelope(fs.readFileSync(filePath("vault")), KEY_2, "vault").kind).toBe("document");
    expect(rawKid("vault")).toBe(deriveKid(KEY_2));
    expect(sink.lines.join("\n")).toContain(`created source=keychain kid=${deriveKid(KEY_2)}`);
  });

  it("E23: the key is resolved at most once across reads and writes of both stores", async () => {
    writeEnvelopeFile("plugin-credentials", { p: 1 }, KEY_1);
    writeEnvelopeFile("vault", { v: 1 }, KEY_1);
    const kc = stubKeychain(b64(KEY_1));
    await initCredentialKey({ env: {}, entryFactory: kc.factory });
    for (let i = 0; i < 5; i++) {
      readJsonChecked(filePath(i % 2 ? "vault" : "plugin-credentials"), "t", getCredentialCodec(i % 2 ? "vault" : "plugin-credentials"));
    }
    for (let i = 0; i < 3; i++) await writeVia(i % 2 ? "vault" : "plugin-credentials", { n: i });
    expect(kc.calls.get).toBe(1);
    expect(kc.calls.set).toBe(0);
  });

  it("E24: a resolution failure is cached for the life of the process", async () => {
    writePlain("vault", { a: 1 });
    const kc = stubKeychain(b64(KEY_1), { getThrowsOnce: true });
    await initCredentialKey({ env: {}, entryFactory: kc.factory });
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "keychain_unavailable" });
    for (let i = 0; i < 3; i++) await expect(writeVia("vault", { n: i })).rejects.toMatchObject({ reason: "keychain_unavailable" });
    expect((await ensureCredentialKey()).state).toBe("unavailable");
    expect((await ensureCredentialKey()).state).toBe("unavailable");
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "keychain_unavailable" });
    expect(kc.calls.get).toBe(1);
  });

  it("E25: under VITEST with nothing injected the keychain is refused without loading the binding", async () => {
    writeEnvelopeFile("vault", { a: 1 }, KEY_1);
    await initCredentialKey({ env: { VITEST: "1" } });
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "keychain_unavailable" });
    await expect(writeVia("vault", { a: 2 })).rejects.toMatchObject({ reason: "keychain_unavailable" });
    expect(bindingLoads.count).toBe(0);
  });

  it("X23 (key file): writes keep working with the cached key after the key file is deleted; a new process is locked", async () => {
    const keyFile = writeKeyFile(b64(KEY_1));
    await initCredentialKey({ env: { [ENV_KEY]: keyFile } });
    await writeVia("vault", { n: 0 });
    fs.rmSync(keyFile);
    for (let i = 1; i <= 3; i++) await writeVia(i % 2 ? "vault" : "plugin-credentials", { n: i });
    expect(decodeEnvelope(fs.readFileSync(filePath("plugin-credentials")), KEY_1, "plugin-credentials").kind).toBe("document");

    _resetCredentialKeyForTests(); // "a new process"
    await initCredentialKey({ env: { [ENV_KEY]: keyFile } });
    expect(getCredentialKeyState()).toMatchObject({ reason: "key_file_missing" });
    expect(readJsonChecked(filePath("vault"), "t", getCredentialCodec("vault"))).toMatchObject({ locked: "key_file_missing" });
  });

  it("X23 (keychain): the cached key survives entry deletion; a new process reports key_missing and is locked", async () => {
    writeEnvelopeFile("vault", { n: 0 }, KEY_1);
    const kc = stubKeychain(b64(KEY_1));
    await initCredentialKey({ env: {}, entryFactory: kc.factory });
    kc.value = null; // the keychain entry is deleted behind the process's back
    for (let i = 1; i <= 3; i++) await writeVia("vault", { n: i });
    expect(kc.calls.set).toBe(0);

    _resetCredentialKeyForTests();
    await initCredentialKey({ env: {}, entryFactory: kc.factory });
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "key_missing" });
    expect(kc.calls.set).toBe(0); // never created over an existing envelope
    expect(readJsonChecked(filePath("vault"), "t", getCredentialCodec("vault"))).toMatchObject({ locked: "key_missing" });
  });
});

describe("fail-closed singleton codec", () => {
  it("before init an envelope is locked key_uninitialized and a write is refused", async () => {
    writeEnvelopeFile("vault", { a: 1 }, KEY_1);
    expect(getCredentialKeyState()).toMatchObject({ state: "uninitialized", reason: "key_uninitialized" });
    expect(readJsonChecked(filePath("vault"), "t", getCredentialCodec("vault"))).toMatchObject({ locked: "key_uninitialized" });
    const before = sha256(filePath("vault"));
    await expect(writeVia("vault", { a: 2 })).rejects.toMatchObject({ reason: "key_uninitialized" });
    expect(sha256(filePath("vault"))).toBe(before);
  });

  it("a host with no credential files touches no keychain at init (deferred)", async () => {
    const kc = stubKeychain(b64(KEY_1));
    await initCredentialKey({ env: {}, entryFactory: kc.factory });
    expect(getCredentialKeyState()).toMatchObject({ state: "deferred" });
    expect(kc.calls.ctor).toHaveLength(0);
  });

  it("lost key is not replaced: an envelope on disk and an empty keychain is key_missing, never created", async () => {
    writeEnvelopeFile("vault", { a: 1 }, KEY_1);
    const kc = stubKeychain(null);
    await initCredentialKey({ env: {}, entryFactory: kc.factory });
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "key_missing" });
    expect(kc.calls.set).toBe(0);
  });
});
