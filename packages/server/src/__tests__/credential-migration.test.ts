/**
 * Startup migration of plaintext credential files (design D7, D11): per file,
 * under its lock, encrypt → in-memory verify → atomic replace; no plaintext copy;
 * `.corrupt-*` untouched; a late plaintext file is encrypted by the next write.
 * Every codec is a test codec over a fixed key or the singleton over a stub
 * keychain: no test touches a real keychain.
 * See change: encrypt-credentials-at-rest (test-plan E9, E42–E45, X7–X9).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CredentialFileId } from "@blackbelt-technology/pi-dashboard-shared/credential-encryption.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnvelopeCodec } from "../auth/credential-envelope.js";
import { _resetCredentialKeyForTests, initCredentialKey } from "../auth/credential-key.js";
import { migrateCredentialFiles } from "../auth/credential-migration.js";
import { _resetQuarantineDedupForTests, type JsonFileCodec } from "../auth/locked-json-file.js";
import { createPluginCredentialStore } from "../auth/plugin-credential-store.js";
import { createVaultStore } from "../vault/vault-store.js";
import { KEY_1, KEY_2, logSink, stubKeychain } from "./helpers/credential-key-kit.js";

const MAGIC = "pi-dashboard-encrypted:v1";
let home: string;
const pluginFile = () => path.join(home, ".pi", "agent", "plugin-credentials.json");
const vaultFile = () => path.join(home, ".pi", "dashboard", "vault.json");
const sha = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const keyed = (id: CredentialFileId, key: Buffer = KEY_1): JsonFileCodec => createEnvelopeCodec(id, () => ({ ok: true, key }));
const codecFor = (key: Buffer = KEY_1) => (id: CredentialFileId) => keyed(id, key);
const lines = () => {
  const sink = logSink();
  return { out: sink.lines, log: sink.log };
};
const put = (file: string, doc: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
};
const allBytes = (dir: string): Array<{ file: string; text: string }> => {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push({ file: p, text: fs.readFileSync(p).toString("latin1") });
    }
  };
  walk(dir);
  return out;
};

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-cred-migration-")));
  _resetCredentialKeyForTests();
  _resetQuarantineDedupForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  _resetCredentialKeyForTests();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("credential migration", () => {
  it("E9: neither credential file holds a plaintext marker (also UTF-16 and base64 forms)", async () => {
    const markers = ["key-H3nB8wZ1cT6y@x.com", "tok-Q7vX2mR9pL4k", "lbl-K5dF9sJ2qW7e", "val-P8gN4vY6rM3a"];
    await createPluginCredentialStore("demo", { codec: keyed("plugin-credentials"), path: pluginFile() }).set(markers[0], { token: markers[1] });
    await createVaultStore({ codec: keyed("vault"), path: vaultFile() }).addAccount({ provider: "gemini", label: markers[2], value: markers[3] });
    for (const f of [pluginFile(), vaultFile()]) {
      const raw = fs.readFileSync(f);
      expect(raw.toString("utf-8").startsWith(MAGIC)).toBe(true);
      for (const m of markers) {
        for (const form of [Buffer.from(m), Buffer.from(m, "utf16le"), Buffer.from(Buffer.from(m).toString("base64"))]) {
          expect(raw.includes(form)).toBe(false);
        }
      }
    }
  });

  it("E42: a plaintext vault becomes an envelope; accounts survive; the log line says encrypted", async () => {
    put(vaultFile(), {
      accounts: [
        { id: "a1", provider: "gemini", kind: "key", namespace: "user", label: "one", value: "value-one-0001" },
        { id: "a2", provider: "openai", kind: "key", namespace: "user", label: "two", value: "value-two-0002" },
      ],
    });
    const sink = lines();
    const report = await migrateCredentialFiles({ home, codecFor: codecFor(), log: sink.log });
    expect(fs.readFileSync(vaultFile(), "utf-8").startsWith(`${MAGIC}\n`)).toBe(true);
    expect(report.find((r) => r.id === "vault")).toMatchObject({ state: "encrypted", migrated: true });
    const store = createVaultStore({ codec: keyed("vault"), path: vaultFile() });
    expect((await store.listAccounts()).map((a) => [a.id, a.label])).toEqual([["a1", "one"], ["a2", "two"]]);
    expect(store.getKeyValue("a1")).toBe("value-one-0001");
    expect(store.getKeyValue("a2")).toBe("value-two-0002");
    expect(sink.out).toContain("[credential-key] vault.json state=encrypted");
    expect(sink.out.join("\n")).not.toContain("value-one-0001");
  });

  it("E42: an already-encrypted file is left byte-identical (no rewrite); absent files log absent", async () => {
    await createVaultStore({ codec: keyed("vault"), path: vaultFile() }).addAccount({ provider: "g", label: "l", value: "value-0000001" });
    const before = sha(vaultFile());
    const sink = lines();
    const report = await migrateCredentialFiles({ home, codecFor: codecFor(), log: sink.log });
    expect(sha(vaultFile())).toBe(before);
    expect(report.find((r) => r.id === "vault")).toMatchObject({ state: "encrypted", migrated: false });
    expect(sink.out).toContain("[credential-key] plugin-credentials.json state=absent");
    expect(fs.existsSync(pluginFile())).toBe(false); // never created by the migration
  });

  it("E43: no plaintext copy: the marker survives only in the pre-existing .corrupt-* file, whose hash is unchanged", async () => {
    const marker = "tok-Z4mW8qN2xV6c";
    put(pluginFile(), { demo: { k: { token: marker } } });
    const corrupt = `${pluginFile()}.corrupt-20260101T000000Z`;
    fs.writeFileSync(corrupt, `{"demo":{"k":{"token":"${marker}"}} broken`, { mode: 0o600 });
    const corruptSha = sha(corrupt);
    await migrateCredentialFiles({ home, codecFor: codecFor(), log: lines().log });
    const hits = allBytes(home).filter((f) => f.text.includes(marker)).map((f) => f.file);
    expect(hits).toEqual([corrupt]);
    expect(sha(corrupt)).toBe(corruptSha);
    expect(fs.readFileSync(pluginFile(), "utf-8").startsWith(`${MAGIC}\n`)).toBe(true);
    expect(fs.statSync(pluginFile()).mode & 0o777).toBe(process.platform === "win32" ? fs.statSync(pluginFile()).mode & 0o777 : 0o600);
  });

  it("E44: a plaintext file restored after startup is read, then encrypted by the next write", async () => {
    await migrateCredentialFiles({ home, codecFor: codecFor(), log: lines().log }); // startup: nothing to do
    put(pluginFile(), { demo: { restored: { token: "tok-restored-1" } } });
    const store = createPluginCredentialStore("demo", { codec: keyed("plugin-credentials"), path: pluginFile() });
    expect(await store.get("restored")).toEqual({ token: "tok-restored-1" });
    expect(fs.readFileSync(pluginFile(), "utf-8").startsWith(MAGIC)).toBe(false);
    await store.set("fresh", { token: "tok-fresh-2" });
    expect(fs.readFileSync(pluginFile(), "utf-8").startsWith(`${MAGIC}\n`)).toBe(true);
    expect(await store.snapshot()).toEqual({ restored: { token: "tok-restored-1" }, fresh: { token: "tok-fresh-2" } });
  });

  it("E45: without a key the plaintext files stay byte-unchanged; one log line per file names the reason", async () => {
    put(pluginFile(), { demo: { k: { token: "tok-e45-plugin" } } });
    put(vaultFile(), { accounts: [{ id: "a1", provider: "g", kind: "key", namespace: "user", label: "l", value: "value-e45-0001" }] });
    const before = [sha(pluginFile()), sha(vaultFile())];
    const stub = stubKeychain(null, { getThrowsOnce: true });
    await initCredentialKey({ homeDir: home, env: {}, entryFactory: stub.factory, log: logSink().log });
    const sink = lines();
    const report = await migrateCredentialFiles({ home, log: sink.log }); // default codecs: the singleton
    expect([sha(pluginFile()), sha(vaultFile())]).toEqual(before);
    expect(sink.out).toEqual([
      "[credential-key] plugin-credentials.json state=plaintext reason=keychain_unavailable",
      "[credential-key] vault.json state=plaintext reason=keychain_unavailable",
    ]);
    expect(report.map((r) => [r.id, r.state, r.reason, r.migrated])).toEqual([
      ["plugin-credentials", "plaintext", "keychain_unavailable", false],
      ["vault", "plaintext", "keychain_unavailable", false],
    ]);
  });

  it("E45: a locked envelope logs state=locked with the key reason and is not touched", async () => {
    await createVaultStore({ codec: keyed("vault", KEY_2), path: vaultFile() }).addAccount({ provider: "g", label: "l", value: "value-0000002" });
    const before = sha(vaultFile());
    const sink = lines();
    await migrateCredentialFiles({ home, codecFor: codecFor(KEY_1), log: sink.log });
    expect(sha(vaultFile())).toBe(before);
    expect(sink.out).toContain("[credential-key] vault.json state=locked reason=key_mismatch");
  });

  it("E45: a corrupt file is left alone and never quarantined by the migration", async () => {
    fs.mkdirSync(path.dirname(vaultFile()), { recursive: true });
    fs.writeFileSync(vaultFile(), "{not json", { mode: 0o600 });
    const sink = lines();
    await migrateCredentialFiles({ home, codecFor: codecFor(), log: sink.log });
    expect(fs.readFileSync(vaultFile(), "utf-8")).toBe("{not json");
    expect(fs.readdirSync(path.dirname(vaultFile())).filter((f) => f.includes(".corrupt-"))).toEqual([]);
    expect(sink.out).toContain("[credential-key] vault.json state=corrupt");
  });

  it("X7: a verify mismatch leaves the plaintext intact, names the file, leaks no marker, leaves no temp file", async () => {
    const marker = "val-X7mismatchMarker1";
    put(vaultFile(), { accounts: [{ id: "a1", provider: "g", kind: "key", namespace: "user", label: "l", value: marker }] });
    const before = sha(vaultFile());
    const real = keyed("vault");
    const lying: JsonFileCodec = {
      ...real,
      decode: (bytes) => {
        const out = real.decode(bytes);
        return out.kind === "document" && out.encrypted ? { ...out, data: { ...out.data, accounts: [] } } : out;
      },
    };
    const sink = lines();
    const report = await migrateCredentialFiles({ home, codecFor: (id) => (id === "vault" ? lying : keyed(id)), log: sink.log });
    expect(sha(vaultFile())).toBe(before);
    expect(fs.readdirSync(path.dirname(vaultFile())).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    const line = sink.out.find((l) => l.includes("vault.json") && l.includes("plaintext"));
    expect(line).toBeDefined();
    expect(line).toContain("reason=verify_mismatch");
    expect(sink.out.join("\n")).not.toContain(marker);
    expect(report.find((r) => r.id === "vault")).toMatchObject({ state: "plaintext", migrated: false });
  });

  it("X8: a rename failure (EIO once) leaves the plaintext byte-identical, no sibling holds it, and the next write retries", async () => {
    const marker = "val-X8renameMarker001";
    put(vaultFile(), { accounts: [{ id: "a1", provider: "g", kind: "key", namespace: "user", label: "l", value: marker }] });
    const before = sha(vaultFile());
    const realRename = fs.renameSync;
    let thrown = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (!thrown && String(to) === vaultFile()) {
        thrown = true;
        throw Object.assign(new Error("EIO: i/o error, rename"), { code: "EIO" });
      }
      return realRename(from, to);
    });
    const sink = lines();
    await migrateCredentialFiles({ home, codecFor: codecFor(), log: sink.log });
    expect(thrown).toBe(true);
    expect(sha(vaultFile())).toBe(before);
    for (const f of allBytes(path.dirname(vaultFile()))) {
      if (f.file !== vaultFile()) expect(f.text).not.toContain(marker);
    }
    expect(sink.out.some((l) => l.includes("vault.json") && l.includes("state=plaintext"))).toBe(true);
    expect(sink.out.join("\n")).not.toContain(marker);
    // The next write retries (and now succeeds).
    const store = createVaultStore({ codec: keyed("vault"), path: vaultFile() });
    await store.addAccount({ provider: "g", label: "second", value: "value-0000003" });
    expect(fs.readFileSync(vaultFile(), "utf-8").startsWith(`${MAGIC}\n`)).toBe(true);
    expect((await store.listAccounts()).map((a) => a.label)).toEqual(["l", "second"]);
  });

  it("X9: migration racing a write from a second store keeps every record and ends as one envelope", async () => {
    put(pluginFile(), { demo: { orig1: { token: "tok-orig-1" }, orig2: { token: "tok-orig-2" } } });
    const other = createPluginCredentialStore("demo", { codec: keyed("plugin-credentials"), path: pluginFile() });
    await Promise.all([
      migrateCredentialFiles({ home, codecFor: codecFor(), log: lines().log }),
      other.set("added", { token: "tok-added-3" }),
      other.set("added2", { token: "tok-added-4" }),
    ]);
    expect(fs.readFileSync(pluginFile(), "utf-8").startsWith(`${MAGIC}\n`)).toBe(true);
    const keys = Object.keys(await other.snapshot()).sort();
    expect(keys).toEqual(["added", "added2", "orig1", "orig2"]);
    expect(fs.readdirSync(path.dirname(pluginFile())).filter((f) => f.includes(".corrupt-"))).toEqual([]);
  });
});
