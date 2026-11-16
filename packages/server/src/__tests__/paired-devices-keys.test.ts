/**
 * Registry device keys + companions (test-plan E8, E9 registry half, E19, E22).
 * See change: device-key-mutual-check (D3, D5).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_COMPANIONS } from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyIdOf, PairedDeviceRegistry } from "../pairing/paired-devices.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2030, 0, 1);
const ORIGIN = "http://192.168.16.31:8000";

let dir: string;
let file: string;

const mkPub = (): string => crypto.generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x as string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-keys-"));
  file = path.join(dir, "paired-devices.json");
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("bindKey / lookupKey", () => {
  it("binds, then replaces the device's own key; the old key is free again", () => {
    const reg = new PairedDeviceRegistry(file);
    const { device } = reg.add("a");
    const k1 = mkPub();
    const k2 = mkPub();
    expect(reg.bindKey(device.id, k1)).toBe("bound");
    expect(reg.bindKey(device.id, k1)).toBe("bound"); // same key: idempotent
    expect(reg.bindKey(device.id, k2)).toBe("replaced");
    expect(reg.lookupKey(k1)).toBeNull();
    expect(reg.lookupKey(k2)).toMatchObject({ kind: "primary", state: "active", device: { id: device.id } });
    expect(reg.list()[0].keyId).toBe(keyIdOf(k2));
    expect(keyIdOf(k2)).toMatch(/^dk:[A-Za-z0-9_-]{12}$/);
  });

  it("refuses an unknown device and a key held by another row (primary or companion, active or revoked)", () => {
    const reg = new PairedDeviceRegistry(file);
    const a = reg.add("a").device;
    const b = reg.add("b").device;
    const c = reg.add("c").device;
    const ka = mkPub();
    const kc = mkPub();
    const kr = mkPub();
    expect(reg.bindKey("nope", ka)).toBe("no-device");
    expect(reg.bindKey(a.id, ka)).toBe("bound");
    expect(reg.bindKey(b.id, ka)).toBe("held");
    expect(reg.addCompanion(c.id, { pub: kc, origin: ORIGIN })).toBe("added");
    expect(reg.bindKey(b.id, kc)).toBe("held");
    // a revoked row keeps holding its keys
    reg.bindKey(b.id, kr);
    reg.revoke(b.id);
    expect(reg.bindKey(a.id, kr)).toBe("held");
    expect(reg.addCompanion(a.id, { pub: kr, origin: ORIGIN })).toBe("held");
    expect(reg.bindKey("b-is-revoked-now", kr)).toBe("no-device");
    expect(reg.bindKey(b.id, mkPub())).toBe("no-device");
  });

  it("a device's own companion key cannot also become its primary key", () => {
    const reg = new PairedDeviceRegistry(file);
    const d = reg.add("a").device;
    const k = mkPub();
    reg.addCompanion(d.id, { pub: k, origin: ORIGIN });
    expect(reg.bindKey(d.id, k)).toBe("held");
  });

  it("looks up full and status-only keys; active before revoked; isKeyHeld", () => {
    const reg = new PairedDeviceRegistry(file);
    const d = reg.add("a").device;
    const kp = mkPub();
    const kc = mkPub();
    reg.bindKey(d.id, kp);
    reg.addCompanion(d.id, { pub: kc, origin: ORIGIN });
    expect(reg.lookupKey(kp)?.kind).toBe("primary");
    const hit = reg.lookupKey(kc);
    expect(hit).toMatchObject({ kind: "companion", state: "active" });
    expect(hit?.companion?.origin).toBe(ORIGIN);
    expect(reg.lookupKey(mkPub())).toBeNull();
    expect(reg.isKeyHeld(kp)).toBe(true);
    reg.revoke(d.id);
    expect(reg.lookupKey(kp)).toMatchObject({ state: "revoked" });
    expect(reg.isKeyHeld(kc)).toBe(true);
  });

  it("persists keys and preserves unknown fields on rewrite", () => {
    const reg = new PairedDeviceRegistry(file);
    const d = reg.add("a").device;
    const rows = JSON.parse(fs.readFileSync(file, "utf-8"));
    rows[0]["x-future"] = { a: 1 };
    fs.writeFileSync(file, JSON.stringify(rows));
    const reg2 = new PairedDeviceRegistry(file);
    const k = mkPub();
    reg2.bindKey(d.id, k);
    reg2.addCompanion(d.id, { pub: mkPub(), origin: ORIGIN });
    const disk = JSON.parse(fs.readFileSync(file, "utf-8"))[0];
    expect(disk["x-future"]).toEqual({ a: 1 });
    expect(disk.keys.pub).toBe(k);
    expect(disk.companions).toHaveLength(1);
    expect(new PairedDeviceRegistry(file).lookupKey(k)?.device.id).toBe(d.id);
  });

  it("a failed persist leaves the row unchanged and throws", () => {
    const reg = new PairedDeviceRegistry(file);
    const d = reg.add("a").device;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    expect(() => reg.bindKey(d.id, mkPub())).toThrow("disk full");
    spy.mockRestore();
    expect(reg.list()[0].keyId).toBeUndefined();
  });
});

describe("companions (E8)", () => {
  it("caps at 4, stores the origin stripped, removes one alone", () => {
    const reg = new PairedDeviceRegistry(file);
    const d = reg.add("a").device;
    const kp = mkPub();
    reg.bindKey(d.id, kp);
    const cs = Array.from({ length: MAX_COMPANIONS }, () => mkPub());
    cs.forEach((pub, i) => {
      expect(reg.addCompanion(d.id, { pub, origin: i === 0 ? "http://192.168.16.31:8000\u202e" : `http://h${i}:80` })).toBe("added");
    });
    const fifth = mkPub();
    expect(reg.addCompanion(d.id, { pub: fifth, origin: ORIGIN })).toBe("cap");
    expect(reg.lookupKey(fifth)).toBeNull();
    expect(reg.list()[0].companions).toHaveLength(4);
    expect(reg.list()[0].companions?.[0].origin).toBe(ORIGIN);
    expect(reg.addCompanion("nope", { pub: mkPub(), origin: ORIGIN })).toBe("no-device");

    const c2 = reg.lookupKey(cs[1])?.companion?.id as string;
    expect(reg.removeCompanion(d.id, c2)).toBe(true);
    expect(reg.removeCompanion(d.id, c2)).toBe(false);
    expect(reg.deviceKeyStatus(kp)).toMatchObject({ status: "paired", scope: "full" });
    expect(reg.deviceKeyStatus(cs[1])).toEqual({ status: "unknown" });
    const c1 = reg.deviceKeyStatus(cs[0]);
    expect(c1).toEqual({ status: "paired", scope: "status-only" });
    expect(c1).not.toHaveProperty("tier");
  });

  it("a companion never authenticates: no bearer verifies through it", () => {
    const reg = new PairedDeviceRegistry(file);
    const { device } = reg.add("a");
    const kc = mkPub();
    reg.addCompanion(device.id, { pub: kc, origin: ORIGIN });
    expect(reg.verify(kc, "tls")).toBeNull();
  });
});

describe("add() with key and companions (E9, registry half)", () => {
  it("stores a free key; drops a held one and a companion equal to the key", () => {
    const reg = new PairedDeviceRegistry(file);
    const k = mkPub();
    const first = reg.add("a", "pairing", undefined, undefined, { key: k });
    expect(first.keyBound).toBe(true);
    const second = reg.add("b", "pairing", undefined, undefined, { key: k });
    expect(second.keyBound).toBe(false);
    expect(reg.lookupKey(k)?.device.id).toBe(first.device.id);

    const k2 = mkPub();
    const third = reg.add("c", "pairing", undefined, undefined, { key: k2, companions: [{ pub: k2, origin: ORIGIN }, { pub: k, origin: ORIGIN }] });
    expect(third.keyBound).toBe(true);
    expect(third.companionsAdded).toBe(0);
    const fourth = reg.add("d", "pairing", undefined, undefined, { companions: [{ pub: mkPub(), origin: ORIGIN }] });
    expect(fourth.device.companions).toHaveLength(1);
  });
});

describe("rotation keeps key and companions (E22)", () => {
  it("same row, same key id and companion after rotate; binding the key elsewhere still refused", () => {
    const reg = new PairedDeviceRegistry(file);
    const { device, token } = reg.add("a", "pairing", undefined, "browser");
    const k = mkPub();
    const kc = mkPub();
    reg.bindKey(device.id, k);
    reg.addCompanion(device.id, { pub: kc, origin: ORIGIN });
    const before = reg.deviceKeyStatus(k);
    const r = reg.rotate(token, true, { channel: "tls" });
    expect(r.ok).toBe(true);
    expect(reg.list()[0].keyId).toBe(keyIdOf(k));
    expect(reg.list()[0].companions?.[0].origin).toBe(ORIGIN);
    expect(reg.deviceKeyStatus(k)).toEqual(before);
    expect(reg.deviceKeyStatus(kc)).toEqual({ status: "paired", scope: "status-only" });
    const other = reg.add("b").device;
    expect(reg.bindKey(other.id, k)).toBe("held");
  });
});

describe("deviceKeyStatus expiry (E19)", () => {
  const seed = (rows: Record<string, unknown>[]) => {
    fs.writeFileSync(
      file,
      JSON.stringify(
        rows.map((r, i) => ({
          id: `dev-${i}`,
          label: "x",
          tokenHash: crypto.createHash("sha256").update(`t${i}`).digest("hex"),
          createdAt: new Date(T0).toISOString(),
          lastSeen: null,
          source: "pairing",
          tier: "control",
          ...r,
        })),
      ),
    );
  };
  const kA = mkPub();
  const kB = mkPub();
  const kC = mkPub();
  const kD = mkPub();
  const kE = mkPub();
  const kComp = mkPub();

  it("D1: paired until expiresAt, then expired — same instant the bearer is refused", () => {
    seed([{ pairedAt: T0, expiresAt: T0 + 7 * DAY, keys: { pub: kA, createdAt: "x" }, companions: [{ id: "c", pub: kComp, origin: ORIGIN, createdAt: "x" }] }]);
    const reg = new PairedDeviceRegistry(file);
    vi.setSystemTime(T0 + 7 * DAY - 1);
    expect(reg.deviceKeyStatus(kA)).toEqual({ status: "paired", scope: "full", tier: "control" });
    vi.setSystemTime(T0 + 7 * DAY);
    const exp = reg.deviceKeyStatus(kA);
    expect(exp).toEqual({ status: "expired" });
    expect(reg.deviceKeyStatus(kComp)).toEqual({ status: "expired" });
  });

  it("D2: absolute 30 d ceiling; D4 no expiresAt never expires; D5 unparseable fails closed", () => {
    seed([
      { pairedAt: T0, expiresAt: T0 + 40 * DAY, keys: { pub: kB, createdAt: "x" } },
      { keys: { pub: kC, createdAt: "x" } },
      { expiresAt: "abc", keys: { pub: kD, createdAt: "x" } },
    ]);
    const reg = new PairedDeviceRegistry(file);
    vi.setSystemTime(T0 + 30 * DAY - 1);
    expect(reg.deviceKeyStatus(kB).status).toBe("paired");
    vi.setSystemTime(T0 + 30 * DAY);
    expect(reg.deviceKeyStatus(kB)).toEqual({ status: "expired" });
    vi.setSystemTime(T0 + 3650 * DAY);
    expect(reg.deviceKeyStatus(kC).status).toBe("paired");
    expect(reg.deviceKeyStatus(kD)).toEqual({ status: "expired" });
  });

  it("D3: previous-bearer grace keeps the key paired until previousExpiresAt", () => {
    const T = T0 + 7 * DAY;
    seed([{ pairedAt: T0, expiresAt: T, previousHash: "ab".repeat(32), previousExpiresAt: T + 30_000, keys: { pub: kE, createdAt: "x" } }]);
    const reg = new PairedDeviceRegistry(file);
    vi.setSystemTime(T + 10_000);
    expect(reg.deviceKeyStatus(kE).status).toBe("paired");
    vi.setSystemTime(T + 31_000);
    expect(reg.deviceKeyStatus(kE)).toEqual({ status: "expired" });
  });

  it("unknown key → unknown", () => {
    expect(new PairedDeviceRegistry(file).deviceKeyStatus(mkPub())).toEqual({ status: "unknown" });
  });
});
