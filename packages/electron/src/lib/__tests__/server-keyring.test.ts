/**
 * Server keyring: MRU/heal, encryption posture, file hygiene, corruption, atomic write.
 * See change: add-electron-server-windows (test-plan E5–E11).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DeviceKey, generateDeviceKey } from "../device-key.js";
import type { HostRef } from "../server-discovery.js";
import { type CryptoPort, type FsPort, loadKeyring, nodeFsPort, type ServerKeyring } from "../server-keyring.js";

const F = `sha256:${"A".repeat(43)}`;
const http = (host: string, port = 8000): HostRef => ({ scheme: "http", host, port });
const https = (host: string, port = 8443): HostRef => ({ scheme: "https", host, port });

/** Reversible fake "encryption" so file bytes never contain the plaintext. */
function fakeCrypto(over: Partial<CryptoPort> = {}): CryptoPort {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`ENC:${Buffer.from(s).reverse().toString("hex")}`),
    decryptString: (b) => {
      const t = b.toString();
      if (!t.startsWith("ENC:")) throw new Error("bad blob");
      return Buffer.from(Buffer.from(t.slice(4), "hex").reverse()).toString();
    },
    ...over,
  };
}

let dir: string;
let logs: string[];
const log = (l: string) => logs.push(l);
const open = (over: { crypto?: CryptoPort; fs?: FsPort; now?: () => number } = {}): ServerKeyring =>
  loadKeyring({ dir, crypto: over.crypto ?? fakeCrypto(), fs: over.fs, log, now: over.now });
const file = () => path.join(dir, "server-keyring.json");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "keyring-"));
  logs = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const pair = (k: ServerKeyring, host: HostRef = http("192.168.16.204"), bearer = "B1-secret-bearer") =>
  k.savePaired({ fingerprint: F, label: "home-imac", host, bearer, pinnedPubkey: "PUB" });

describe("MRU cap + heal (E5, E6)", () => {
  it("E5: lengths 4,5,5; newest first; oldest dropped at 6th", () => {
    const k = open();
    pair(k, http("h1"));
    const lens: number[] = [];
    for (const h of ["h2", "h3", "h4"]) {
      k.heal(F, http(h));
    }
    lens.push(k.get(F)!.lastHosts.length);
    k.heal(F, http("h5"));
    lens.push(k.get(F)!.lastHosts.length);
    k.heal(F, http("h6"));
    lens.push(k.get(F)!.lastHosts.length);
    expect(lens).toEqual([4, 5, 5]);
    expect(k.get(F)!.lastHosts.map((h) => h.host)).toEqual(["h6", "h5", "h4", "h3", "h2"]);
  });

  it("E6: a healed http host never precedes an https host", () => {
    const k = open();
    pair(k, https("dash.lan"));
    expect(k.heal(F, http("192.168.16.77"))).toBe(true);
    const hosts = k.get(F)!.lastHosts;
    expect(hosts[0]).toEqual(https("dash.lan"));
    expect(hosts[1]).toEqual(http("192.168.16.77"));
  });

  it("heal logs short fingerprint + host; unchanged heal is a no-op", () => {
    const k = open();
    pair(k, http("a"));
    k.heal(F, http("b"));
    expect(logs.some((l) => l.includes("heal") && l.includes("sha256:AAAAAAAAAAAAAAAA") && l.includes("b:8000"))).toBe(true);
    expect(k.heal(F, http("b"))).toBe(false);
  });
});

describe("encryption posture (E7, E8)", () => {
  it("E7: encryption unavailable ⇒ bearer off disk, not remembered, memory-only this run", () => {
    const k = open({ crypto: fakeCrypto({ isEncryptionAvailable: () => false }) });
    pair(k);
    const disk = fs.readFileSync(file(), "utf8");
    expect(disk).not.toContain("B1-secret-bearer");
    const entry = JSON.parse(disk).servers[F];
    expect(entry.bearer).toBeNull();
    expect(entry.remembered).toBe(false);
    expect(k.get(F)!.remembered).toBe(false);
    expect(k.bearerFor(F)).toBe("B1-secret-bearer"); // still usable this run
  });

  it("E7: Linux basic_text backend counts as unavailable", () => {
    const k = open({ crypto: fakeCrypto({ getSelectedStorageBackend: () => "basic_text" }) });
    pair(k);
    expect(k.get(F)!.remembered).toBe(false);
    expect(fs.readFileSync(file(), "utf8")).not.toContain("B1-secret-bearer");
    // a fresh start shows it as needing pairing (nothing remembered)
    expect(open({ crypto: fakeCrypto({ getSelectedStorageBackend: () => "basic_text" }) }).get(F)).toMatchObject({
      needsPairing: true,
      remembered: false,
    });
  });

  it("E8: bearer not clear text; mode 0600; a 0644 file is tightened on load", () => {
    const k = open();
    pair(k);
    const disk = fs.readFileSync(file(), "utf8");
    expect(disk).not.toContain("B1-secret-bearer");
    if (process.platform !== "win32") {
      expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
      fs.chmodSync(file(), 0o644);
      open();
      expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
    }
    // round-trips through decrypt
    expect(open().bearerFor(F)).toBe("B1-secret-bearer");
    expect(open().get(F)).toMatchObject({ remembered: true, needsPairing: false, pinnedPubkey: "PUB" });
  });
});

describe("failure modes (E9–E11)", () => {
  it("E9: undecryptable bearer ⇒ entry kept with pin, needsPairing, bearer dropped", () => {
    pair(open());
    const k = open({ crypto: fakeCrypto({ decryptString: () => { throw new Error("keychain reset"); } }) });
    expect(k.get(F)).toMatchObject({ label: "home-imac", pinnedPubkey: "PUB", needsPairing: true });
    expect(k.bearerFor(F)).toBeNull();
    expect(logs.some((l) => l.includes("undecryptable"))).toBe(true);
  });

  it.each([["truncated", "{"], ["unknown version", JSON.stringify({ version: 2, servers: {} })]])(
    "E10: %s file ⇒ empty keyring, set aside, one log line, no throw",
    (_n, content) => {
      fs.writeFileSync(file(), content);
      const k = open({ now: () => 1234 });
      expect(k.list()).toEqual([]);
      expect(fs.existsSync(path.join(dir, "server-keyring.corrupt-1234.json"))).toBe(true);
      expect(fs.existsSync(file())).toBe(false);
      expect(logs.filter((l) => l.includes("set aside"))).toHaveLength(1);
    },
  );

  it("E11: failure between write and rename leaves the previous file intact, no partial file", () => {
    const k = open();
    pair(k);
    const before = fs.readFileSync(file(), "utf8");
    const failing: FsPort = { ...nodeFsPort, rename: vi.fn(() => { throw new Error("EXDEV"); }) };
    const k2 = open({ fs: failing });
    // pairing must surface a failed write (the credential would otherwise be lost silently)…
    expect(() => pair(k2, http("10.1.1.1"))).toThrow(/EXDEV/);
    // …while heal / unpair / forget are best effort: logged, memory stays authoritative, no throw.
    expect(() => k2.heal(F, http("10.2.2.2"))).not.toThrow();
    expect(k2.get(F)!.lastHosts[0]).toEqual(http("10.2.2.2"));
    expect(logs.some((l) => l.includes("keyring write failed"))).toBe(true);
    expect(fs.readFileSync(file(), "utf8")).toBe(before);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("state transitions", () => {
  it("markNeedsPairing drops the bearer, keeps pin/label/hosts, persists", () => {
    const k = open();
    pair(k);
    k.markNeedsPairing(F);
    expect(k.bearerFor(F)).toBeNull();
    expect(k.get(F)).toMatchObject({ needsPairing: true, label: "home-imac", pinnedPubkey: "PUB" });
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).servers[F].bearer).toBeNull();
  });

  it("remove drops the entry and notifies; list never exposes a bearer", () => {
    const k = open();
    const changed = vi.fn();
    k.onChange(changed);
    pair(k);
    expect(JSON.stringify(k.list())).not.toContain("B1-secret-bearer");
    expect(k.remove(F)).toBe(true);
    expect(k.has(F)).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("findByHost matches a stored host", () => {
    const k = open();
    pair(k, http("192.168.16.204"));
    expect(k.findByHost("192.168.16.204", 8000)?.fingerprint).toBe(F);
    expect(k.findByHost("10.9.9.9", 22)).toBeUndefined();
  });
});

// ── group-servers-by-identity: host source + delivered routes (D7, D10; test-plan X12, X15) ──

describe("host source (#X15, task 8.4)", () => {
  it("#X15: savePaired records the host source; it round-trips through the file", () => {
    const k = open();
    k.savePaired({ fingerprint: F, label: "home-imac", host: { ...http("192.168.16.204"), source: "mdns" }, bearer: "B1" });
    expect(k.get(F)!.lastHosts[0]).toEqual({ ...http("192.168.16.204"), source: "mdns" });
    expect(open().get(F)!.lastHosts[0]).toEqual({ ...http("192.168.16.204"), source: "mdns" });
  });

  it("#X15: an entry written by the previous version (no source) loads as unknown and keeps working", () => {
    const k = open();
    pair(k, http("a"));
    const disk = JSON.parse(fs.readFileSync(file(), "utf8"));
    expect(disk.servers[F].lastHosts[0]).toEqual(http("a")); // nothing invents a source
    const reloaded = open();
    expect(reloaded.get(F)!.lastHosts).toEqual([http("a")]);
    expect(reloaded.get(F)!.lastHosts[0]).not.toHaveProperty("source");
    expect(reloaded.findByHost("a", 8000)?.fingerprint).toBe(F);
  });

  it("#X15: an unknown source value on disk is read as unknown, not trusted", () => {
    const k = open();
    pair(k, http("a"));
    const disk = JSON.parse(fs.readFileSync(file(), "utf8"));
    disk.servers[F].lastHosts[0].source = "config";
    fs.writeFileSync(file(), JSON.stringify(disk));
    expect(open().get(F)!.lastHosts[0]).toEqual(http("a"));
  });

  it("#X15: re-learning a known host keeps its recorded source", () => {
    const k = open();
    k.savePaired({ fingerprint: F, label: "home-imac", host: { ...http("a"), source: "saved" }, bearer: "B1" });
    k.heal(F, { ...http("a"), source: "mdns" });
    expect(k.get(F)!.lastHosts[0]).toMatchObject({ host: "a", source: "saved" });
  });
});

describe("delivered routes (#X15, task 8.4)", () => {
  const deliveredHosts = (n: number): HostRef[] => Array.from({ length: n }, (_, i) => https(`r${i + 1}.share.zrok.io`, 443));

  it("#X15: 8 valid delivered routes ⇒ only the first 3 stored (source pairing), 5-host cap keeps 3 https first + 2 most-recent http", () => {
    const k = open();
    pair(k, http("h1"));
    for (const h of ["h2", "h3", "h4", "h5"]) k.heal(F, http(h)); // five http hosts: h5 h4 h3 h2 h1
    expect(k.get(F)!.lastHosts).toHaveLength(5);
    expect(k.addDeliveredHosts(F, deliveredHosts(8))).toBe(3);
    const hosts = k.get(F)!.lastHosts;
    expect(hosts.map((h) => h.host)).toEqual(["r1.share.zrok.io", "r2.share.zrok.io", "r3.share.zrok.io", "h5", "h4"]);
    expect(hosts.slice(0, 3).every((h) => h.scheme === "https" && h.source === "pairing")).toBe(true);
    expect(hosts).toHaveLength(5);
  });

  it("#X15: only https delivered hosts are accepted, and an unknown entry stores nothing", () => {
    const k = open();
    pair(k, http("h1"));
    expect(k.addDeliveredHosts(F, [http("evil.example")])).toBe(0);
    expect(k.addDeliveredHosts(`sha256:${"Z".repeat(43)}`, deliveredHosts(1))).toBe(0);
    expect(k.get(F)!.lastHosts).toEqual([http("h1")]);
  });

  it("#X15: delivered hosts persist and reload with source pairing; a delivered https host leads an existing http host", () => {
    const k = open();
    pair(k, http("h1"));
    k.addDeliveredHosts(F, deliveredHosts(1));
    expect(open().get(F)!.lastHosts).toEqual([{ ...https("r1.share.zrok.io", 443), source: "pairing" }, http("h1")]);
  });
});

describe("encryption unavailable with a code-redeemed credential (#X12)", () => {
  it("#X12: safeStorage unavailable / Linux basic_text ⇒ bearer absent from disk, memory-only, not remembered", () => {
    for (const crypto of [fakeCrypto({ isEncryptionAvailable: () => false }), fakeCrypto({ getSelectedStorageBackend: () => "basic_text" })]) {
      fs.rmSync(file(), { force: true });
      const k = open({ crypto });
      k.savePaired({ fingerprint: F, label: "build-box", host: { ...https("b.share.zrok.io", 443), source: "pairing" }, bearer: "BEARER-ZZ9" });
      expect(fs.readFileSync(file(), "utf8")).not.toContain("BEARER-ZZ9");
      expect(k.bearerFor(F)).toBe("BEARER-ZZ9");
      expect(k.get(F)).toMatchObject({ remembered: false, needsPairing: false });
    }
  });
});

describe("device key per entry (device-key-mutual-check, X11/X12)", () => {
  const BEARER = "B1-secret-bearer";
  const pairKeyed = (k: ServerKeyring, key: DeviceKey = generateDeviceKey()) => {
    k.savePaired({ fingerprint: F, label: "home-imac", host: http("192.168.16.204"), bearer: BEARER, pinnedPubkey: "PUB", deviceKey: key });
    return key;
  };
  /** Every textual form a private key could take in a file. */
  const privateForms = (key: DeviceKey): string[] => {
    const der = Buffer.from(key.exportPrivate(), "base64");
    return [key.exportPrivate(), der.toString("base64url"), der.toString("hex"), der.subarray(-32).toString("base64"), der.subarray(-32).toString("base64url")];
  };

  it("persists pub in clear and the private part encrypted; no clear private key in the file; mode 0600; reload signs with the same key", () => {
    const key = pairKeyed(open());
    const raw = fs.readFileSync(file(), "utf8");
    expect(raw).toContain(key.pub);
    expect(raw).not.toContain(BEARER);
    for (const form of privateForms(key)) expect(raw).not.toContain(form);
    expect(JSON.parse(raw).servers[F].deviceKey).toEqual({ pub: key.pub, priv: { enc: "safeStorage", data: expect.any(String) } });
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
    const back = open().deviceKeyFor(F);
    expect(back?.pub).toBe(key.pub);
    expect(back?.exportPrivate()).toBe(key.exportPrivate());
    expect(open().get(F)).toMatchObject({ keyHeld: true, needsPairing: false });
  });

  it("X5: setDeviceKey stores a bound key for a credential-holding keyless entry only (encrypted, reload signs the same)", () => {
    const k = open();
    k.savePaired({ fingerprint: F, label: "home-imac", host: http("192.168.16.204"), bearer: BEARER, pinnedPubkey: "PUB" });
    const key = generateDeviceKey();
    expect(k.setDeviceKey(F, key)).toBe(true);
    expect(k.get(F)).toMatchObject({ keyHeld: true, needsPairing: false });
    const raw = fs.readFileSync(file(), "utf8");
    expect(raw).toContain(key.pub);
    for (const form of privateForms(key)) expect(raw).not.toContain(form);
    expect(open().deviceKeyFor(F)?.pub).toBe(key.pub);
    // a held key is never replaced; an unknown or credential-less entry takes none
    expect(k.setDeviceKey(F, generateDeviceKey())).toBe(false);
    expect(k.deviceKeyFor(F)?.pub).toBe(key.pub);
    expect(k.setDeviceKey(`sha256:${"Z".repeat(43)}`, generateDeviceKey())).toBe(false);
    k.markNeedsPairing(F);
    expect(k.setDeviceKey(F, generateDeviceKey())).toBe(false);
  });

  it("X11: safeStorage unavailable ⇒ key and bearer stay in memory, nothing secret on disk, not remembered, window still opens", () => {
    for (const crypto of [fakeCrypto({ isEncryptionAvailable: () => false }), fakeCrypto({ getSelectedStorageBackend: () => "basic_text" })]) {
      fs.rmSync(file(), { force: true });
      const k = open({ crypto });
      const key = pairKeyed(k);
      const raw = fs.readFileSync(file(), "utf8");
      expect(raw).not.toContain(BEARER);
      for (const form of privateForms(key)) expect(raw).not.toContain(form);
      expect(JSON.parse(raw).servers[F].deviceKey).toBeUndefined();
      expect(k.bearerFor(F)).toBe(BEARER);
      expect(k.deviceKeyFor(F)?.pub).toBe(key.pub);
      expect(k.get(F)).toMatchObject({ remembered: false, needsPairing: false, keyHeld: true });
    }
  });

  it("X11: an undecryptable private key alone is dropped; the entry keeps its credential and reads key-pending", () => {
    pairKeyed(open());
    const disk = JSON.parse(fs.readFileSync(file(), "utf8"));
    disk.servers[F].deviceKey.priv.data = Buffer.from("garbage").toString("base64");
    fs.writeFileSync(file(), JSON.stringify(disk));
    const k = open();
    expect(k.bearerFor(F)).toBe(BEARER);
    expect(k.get(F)).toMatchObject({ needsPairing: false, remembered: true, keyHeld: false });
    expect(k.deviceKeyFor(F)).toBeNull();
    expect(logs.some((l) => l.includes("device key undecryptable"))).toBe(true);
    k.heal(F, http("10.0.0.9"));
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).servers[F].deviceKey).toBeUndefined();
  });

  it("a decrypted private key that does not match the stored pub (or does not parse) is dropped too", () => {
    const key = pairKeyed(open());
    const crypto = fakeCrypto();
    const disk = JSON.parse(fs.readFileSync(file(), "utf8"));
    disk.servers[F].deviceKey.pub = generateDeviceKey().pub;
    fs.writeFileSync(file(), JSON.stringify(disk));
    expect(open().get(F)).toMatchObject({ keyHeld: false, needsPairing: false });
    disk.servers[F].deviceKey = { pub: key.pub, priv: { enc: "safeStorage", data: crypto.encryptString("not a key").toString("base64") } };
    fs.writeFileSync(file(), JSON.stringify(disk));
    expect(open().get(F)).toMatchObject({ keyHeld: false, needsPairing: false });
  });

  it("X11: list/get never carry a bearer, a private key, a `privateKey` field or the key object", () => {
    const k = open();
    const key = pairKeyed(k);
    for (const answer of [JSON.stringify(k.list()), JSON.stringify(k.get(F))]) {
      expect(answer).not.toContain(BEARER);
      expect(answer).not.toContain("privateKey");
      for (const form of privateForms(key)) expect(answer).not.toContain(form);
    }
    expect(Object.keys(k.get(F)!)).not.toContain("deviceKey");
  });

  it("re-pairing without a key does not inherit the old one; markNeedsPairing drops the key with the bearer", () => {
    const k = open();
    pairKeyed(k);
    k.savePaired({ fingerprint: F, label: "home-imac", host: http("192.168.16.204"), bearer: "B2" });
    expect(k.get(F)).toMatchObject({ keyHeld: false });
    pairKeyed(k);
    k.markNeedsPairing(F);
    expect(k.deviceKeyFor(F)).toBeNull();
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).servers[F].deviceKey).toBeUndefined();
  });

  it("X12: the previous field-by-field loader keeps label/hosts/bearer and drops the key on save; the current build then reads key-pending", () => {
    const key = pairKeyed(open());
    // The pre-change loader copied known fields only; replay that logic on the same file.
    const OLD_FIELDS = ["label", "pinnedPubkey", "lastHosts", "bearer", "remembered", "needsPairing", "pairedAt"] as const;
    const disk = JSON.parse(fs.readFileSync(file(), "utf8")) as { version: number; servers: Record<string, Record<string, unknown>> };
    const resaved = { version: disk.version, servers: {} as Record<string, Record<string, unknown>> };
    for (const [fp, e] of Object.entries(disk.servers)) {
      resaved.servers[fp] = Object.fromEntries(OLD_FIELDS.filter((f) => f in e).map((f) => [f, e[f]]));
    }
    expect(resaved.servers[F]).toMatchObject({ label: "home-imac", bearer: { enc: "safeStorage" }, pinnedPubkey: "PUB" });
    fs.writeFileSync(file(), JSON.stringify(resaved));
    expect(fs.readFileSync(file(), "utf8")).not.toContain(key.pub);
    const k = open();
    expect(k.bearerFor(F)).toBe(BEARER);
    expect(k.get(F)).toMatchObject({ label: "home-imac", needsPairing: false, keyHeld: false });
    expect(k.get(F)!.lastHosts).toEqual([http("192.168.16.204")]);
  });

  it("X12: a corrupt file holding keyed entries is set aside under a distinct name, the keyring starts empty, it is logged", () => {
    pairKeyed(open());
    fs.writeFileSync(file(), `${fs.readFileSync(file(), "utf8")}}{`);
    const k = open({ now: () => 4321 });
    expect(k.list()).toEqual([]);
    expect(k.deviceKeyFor(F)).toBeNull();
    expect(fs.existsSync(path.join(dir, "server-keyring.corrupt-4321.json"))).toBe(true);
    expect(fs.existsSync(file())).toBe(false);
    expect(logs.filter((l) => l.includes("set aside"))).toHaveLength(1);
  });
});
