/**
 * The opt-in `codec` seam in locked-json-file (test-plan E8, E10) plus the
 * seam contract the credential stores rely on: a locked result never
 * quarantines, never overwrites, and the default path stays byte-identical.
 * See change: encrypt-credentials-at-rest (D1, D3; tasks 4.2, 14).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createEnvelopeCodec, encodeEnvelope } from "../auth/credential-envelope.js";
import {
  _resetQuarantineDedupForTests,
  readJsonChecked,
  tryReadJson,
  withLockedJsonFile,
  writeJsonAtomic,
} from "../auth/locked-json-file.js";

const DIR = path.join(os.homedir(), ".pi", "agent");
const KEY = Buffer.alloc(32, 7);
const OTHER = Buffer.alloc(32, 9);
const vaultFile = path.join(DIR, "vault.json");
const authFile = path.join(DIR, "auth.json");

const codecFor = (key: Buffer | null, fileId: "vault" | "plugin-credentials" = "vault") =>
  createEnvelopeCodec(fileId, () => (key ? { ok: true, key } : { ok: false, reason: "keychain_unavailable" }));

beforeEach(() => {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { recursive: true, force: true });
  _resetQuarantineDedupForTests();
});

describe("locked-json-file codec seam", () => {
  it("E8: an encrypted file is corrupt to a codec-less parser, so older versions cannot merge into it", () => {
    fs.writeFileSync(vaultFile, encodeEnvelope({ accounts: [] }, KEY, "vault"));
    const bytes = fs.readFileSync(vaultFile, "utf8");
    expect(() => JSON.parse(bytes)).toThrow();
    expect(tryReadJson(vaultFile)).toEqual({ ok: false });
    const r = readJsonChecked(vaultFile, "t");
    expect(r.corrupt).toBe(true);
    expect(r.data).toEqual({});
  });

  it("E10: auth.json (no codec) stays plain JSON, byte-equal to the pre-change format", () => {
    const data = { anthropic: { type: "api_key", key: "sk-plain" } };
    writeJsonAtomic(authFile, data);
    expect(fs.readFileSync(authFile, "utf8")).toBe(`${JSON.stringify(data, null, 2)}\n`);
    expect(readJsonChecked(authFile, "t")).toEqual({ data, corrupt: false, quarantined: false });
  });

  it("codec read: absent → empty, plaintext → document (encrypted:false), envelope → document (encrypted:true)", () => {
    const codec = codecFor(KEY);
    expect(readJsonChecked(vaultFile, "t", codec)).toMatchObject({ data: {}, corrupt: false });
    fs.writeFileSync(vaultFile, '{"a":1}');
    expect(readJsonChecked(vaultFile, "t", codec)).toMatchObject({ data: { a: 1 }, corrupt: false, encrypted: false });
    writeJsonAtomic(vaultFile, { a: 2 }, undefined, codec);
    expect(readJsonChecked(vaultFile, "t", codec)).toMatchObject({ data: { a: 2 }, corrupt: false, encrypted: true });
    expect(fs.readFileSync(vaultFile, "utf8").split("\n")[0]).toBe("pi-dashboard-encrypted:v1");
    expect(fs.statSync(vaultFile).mode & 0o777).toBe(0o600);
  });

  it("codec read: a wrong key is locked key_mismatch; the file is never quarantined", () => {
    writeJsonAtomic(vaultFile, { a: 1 }, undefined, codecFor(KEY));
    const before = fs.readFileSync(vaultFile);
    const r = readJsonChecked(vaultFile, "t", codecFor(OTHER));
    expect(r).toMatchObject({ data: {}, corrupt: false, quarantined: false, locked: "key_mismatch" });
    expect(fs.readdirSync(DIR).filter((f) => f.includes(".corrupt-"))).toEqual([]);
    expect(fs.readFileSync(vaultFile).equals(before)).toBe(true);
  });

  it("codec read: a damaged v1 header is locked envelope_damaged, never corrupt", () => {
    fs.writeFileSync(vaultFile, "pi-dashboard-encrypted:v1\n{\"alg\":");
    const before = fs.readFileSync(vaultFile);
    expect(readJsonChecked(vaultFile, "t", codecFor(KEY))).toMatchObject({ corrupt: false, locked: "envelope_damaged" });
    expect(fs.readdirSync(DIR).filter((f) => f.includes(".corrupt-"))).toEqual([]);
    expect(fs.readFileSync(vaultFile).equals(before)).toBe(true);
  });

  it("codec read: corrupt plaintext is still quarantined byte-exact", () => {
    fs.writeFileSync(vaultFile, "{not json");
    const r = readJsonChecked(vaultFile, "t", codecFor(KEY));
    expect(r).toMatchObject({ corrupt: true, quarantined: true });
    const backup = fs.readdirSync(DIR).find((f) => f.startsWith("vault.json.corrupt-"));
    expect(backup).toBeDefined();
    expect(fs.readFileSync(path.join(DIR, backup as string), "utf8")).toBe("{not json");
  });

  it("codec write: refused when no key; the plaintext file is untouched", () => {
    fs.writeFileSync(vaultFile, '{"a":1}');
    expect(() => writeJsonAtomic(vaultFile, { a: 2 }, undefined, codecFor(null))).toThrowError(
      expect.objectContaining({ code: "credential_locked", reason: "keychain_unavailable" }),
    );
    expect(fs.readFileSync(vaultFile, "utf8")).toBe('{"a":1}');
    expect(fs.existsSync(`${vaultFile}.tmp`)).toBe(false);
  });

  it("codec write: never overwrites an envelope the codec cannot decode", () => {
    writeJsonAtomic(vaultFile, { a: 1 }, undefined, codecFor(KEY));
    const before = fs.readFileSync(vaultFile);
    expect(() => writeJsonAtomic(vaultFile, { b: 2 }, undefined, codecFor(OTHER))).toThrowError(
      expect.objectContaining({ code: "credential_locked", reason: "key_mismatch" }),
    );
    expect(fs.readFileSync(vaultFile).equals(before)).toBe(true);
    // unsupported newer formats are protected the same way
    fs.writeFileSync(vaultFile, "pi-dashboard-encrypted:v2\nwhatever\n");
    expect(() => writeJsonAtomic(vaultFile, { b: 2 }, undefined, codecFor(KEY))).toThrowError(
      expect.objectContaining({ reason: "unsupported_format" }),
    );
    expect(fs.readFileSync(vaultFile, "utf8")).toBe("pi-dashboard-encrypted:v2\nwhatever\n");
  });

  it("withLockedJsonFile: with a codec no plaintext placeholder is created; without one it still is", async () => {
    await withLockedJsonFile(vaultFile, () => 1, { codec: codecFor(KEY) });
    expect(fs.existsSync(vaultFile)).toBe(false);
    await withLockedJsonFile(authFile, () => 1);
    expect(fs.readFileSync(authFile, "utf8")).toBe("{}\n");
  });
});
