/**
 * Host identity: stable Ed25519 key pair, memory-only fallback, sign() bound to
 * the target's fetched instanceId. See change: add-operator-browser-relay
 * (test-plan #E36 #E37 #E38).
 */
import fs from "node:fs";
import path from "node:path";
import { hostIdFromPublicKey, verifyHostSignature } from "@blackbelt-technology/pi-dashboard-shared/browser-host-identity.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHostIdentity, type ChromePort } from "../identity.js";
import type { TargetPort } from "../target.js";
import { fakeCrypto, noCrypto, tempDir } from "./fixtures.js";

let tmp: ReturnType<typeof tempDir>;
beforeEach(() => {
  tmp = tempDir();
});
afterEach(() => tmp.cleanup());

const chrome = (over: Partial<ChromePort> = {}): ChromePort => ({
  canOpen: () => true,
  listProfiles: async () => [{ profileDirectory: "Default", label: "Me", installed: true }],
  ...over,
});
const target = (instanceId: string | Error = "inst-I"): TargetPort => ({
  origin: () => "http://localhost:8000",
  instanceId: async () => {
    if (instanceId instanceof Error) throw instanceId;
    return instanceId;
  },
});
const open = (over: { crypto?: ReturnType<typeof fakeCrypto>; target?: TargetPort; chrome?: ChromePort } = {}) =>
  createHostIdentity({
    dir: tmp.dir,
    crypto: over.crypto ?? fakeCrypto(),
    label: () => "my-mac",
    platform: "darwin",
    chrome: over.chrome ?? chrome(),
    target: over.target ?? target(),
    log: () => {},
  });
const keyFile = () => path.join(tmp.dir, "browser-host-key.json");

describe("identity (E36)", () => {
  it("returns hostId derived from the public key and the registration fields", async () => {
    const id = await open().identity();
    expect(id.hostId).toBe(hostIdFromPublicKey(id.publicKey));
    expect(id).toMatchObject({ label: "my-mac", platform: "darwin", canOpenChrome: true });
    expect(id.profiles).toEqual([{ profileDirectory: "Default", label: "Me", installed: true }]);
    expect(Object.keys(id).sort()).toEqual(["canOpenChrome", "hostId", "label", "platform", "profiles", "publicKey"]);
  });

  it("is unchanged across a restart (new module instance, same dir) when encryption is available", async () => {
    const a = await open().identity();
    const b = await open().identity();
    expect(b.hostId).toBe(a.hostId);
    expect(b.publicKey).toBe(a.publicKey);
  });

  it("never exposes the private key through identity() or sign()", async () => {
    const crypto = fakeCrypto();
    const host = open({ crypto });
    const id = await host.identity();
    const sig = await host.sign("nonce-1", "inst-I");
    const stored = JSON.parse(fs.readFileSync(keyFile(), "utf8")) as { privateKey: { data: string } };
    const privateKey = crypto.decryptString(Buffer.from(stored.privateKey.data, "base64"));
    expect(privateKey.length).toBeGreaterThan(20);
    const returned = JSON.stringify({ id, sig });
    expect(returned).not.toContain(privateKey);
    expect(fs.readFileSync(keyFile(), "utf8")).not.toContain(privateKey);
  });

  it("replaces an undecryptable stored key with a fresh identity", async () => {
    const a = await open().identity();
    fs.writeFileSync(keyFile(), JSON.stringify({ version: 1, publicKey: a.publicKey, privateKey: { enc: "safeStorage", data: "AAAA" } }));
    const b = await open().identity();
    expect(b.hostId).not.toBe(a.hostId);
  });

  it("bounds profile rows (≤64, label ≤128, profileDirectory ≤128 without separators, email ≤254)", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ profileDirectory: `Profile ${i}`, label: "x".repeat(300), email: `${"e".repeat(300)}@x`, installed: true }));
    const rows = [{ profileDirectory: "../evil", label: "bad", installed: true }, { profileDirectory: "a/b", label: "bad", installed: true }, ...many];
    const id = await open({ chrome: chrome({ listProfiles: async () => rows }) }).identity();
    expect(id.profiles).toHaveLength(64);
    expect(id.profiles.every((p) => p.label.length <= 128 && !/[\\/]/.test(p.profileDirectory))).toBe(true);
    expect(id.profiles.every((p) => p.email === undefined)).toBe(true); // 302-char email dropped
  });
});

describe("no encryption (E37)", () => {
  it("uses a different hostId each run and writes nothing to disk", async () => {
    const a = await open({ crypto: noCrypto() }).identity();
    const b = await open({ crypto: noCrypto() }).identity();
    expect(b.hostId).not.toBe(a.hostId);
    expect(fs.readdirSync(tmp.dir)).toEqual([]);
  });

  it("treats the Linux basic_text backend as unavailable", async () => {
    const crypto = fakeCrypto({ getSelectedStorageBackend: () => "basic_text" });
    await open({ crypto }).identity();
    expect(fs.readdirSync(tmp.dir)).toEqual([]);
  });

  it("keeps the key in memory for the run (sign verifies against identity())", async () => {
    const host = open({ crypto: noCrypto() });
    const id = await host.identity();
    expect(verifyHostSignature(id.publicKey, "n", "inst-I", await host.sign("n", "inst-I"))).toBe(true);
  });
});

describe("sign (E38)", () => {
  it("signs the exact message for the target's instanceId and not for another serverId", async () => {
    const host = open();
    const id = await host.identity();
    const sig = await host.sign("nonce-abc", "inst-I");
    expect(verifyHostSignature(id.publicKey, "nonce-abc", "inst-I", sig)).toBe(true);
    expect(verifyHostSignature(id.publicKey, "nonce-abc", "inst-J", sig)).toBe(false);
  });

  it("refuses a serverId that differs from the target's instanceId", async () => {
    await expect(open().sign("nonce-abc", "inst-J")).rejects.toThrow(/server/i);
  });

  it("refuses when the target's instanceId cannot be fetched", async () => {
    await expect(open({ target: target(new Error("ECONNREFUSED")) }).sign("n", "inst-I")).rejects.toThrow();
  });

  it("rejects non-string / oversize nonce", async () => {
    await expect(open().sign("x".repeat(1000), "inst-I")).rejects.toThrow();
    await expect(open().sign(42 as unknown as string, "inst-I")).rejects.toThrow();
  });
});
