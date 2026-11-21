/**
 * Revoked = held state (test-plan E14, E15, E16, E20, E21, X17).
 * See change: device-key-mutual-check (D6).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PairedDeviceRegistry, REVOKED_RETENTION_MS } from "../pairing/paired-devices.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2030, 0, 1);

let dir: string;
let file: string;
let revFile: string;

const mkPub = (): string => crypto.generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x as string;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const readRev = () => JSON.parse(fs.readFileSync(revFile, "utf-8"));
const mode = (f: string) => fs.statSync(f).mode & 0o777;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-revoked-"));
  file = path.join(dir, "paired-devices.json");
  revFile = path.join(dir, "revoked-devices.json");
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

function seedActive(rows: Record<string, unknown>[]) {
  fs.writeFileSync(
    file,
    JSON.stringify(
      rows.map((r) => ({ label: "x", createdAt: new Date(T0).toISOString(), lastSeen: null, source: "pairing", tier: "control", ...r })),
    ),
  );
}
function seedRevoked(rows: Record<string, unknown>[]) {
  fs.writeFileSync(
    revFile,
    JSON.stringify(
      rows.map((r) => ({ label: "x", createdAt: new Date(T0).toISOString(), lastSeen: null, source: "pairing", tier: "control", tokenHash: sha("t"), revokedBy: "local", ...r })),
    ),
  );
}

describe("revoke → held", () => {
  it("writes the whole row to a 0600 revoked file, removes it from active, refuses the token", () => {
    const reg = new PairedDeviceRegistry(file);
    const { device, token } = reg.add("phone");
    const k = mkPub();
    reg.bindKey(device.id, k);
    expect(reg.revoke(device.id, "session:alice")).toBe(true);
    expect(reg.verify(token, "tls")).toBeNull();
    expect(reg.list()).toEqual([]);
    const rec = readRev()[0];
    expect(rec).toMatchObject({ id: device.id, tokenHash: sha(token), keys: { pub: k }, revokedBy: "session:alice", revokedAt: T0 });
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual([]);
    if (process.platform !== "win32") {
      expect(mode(revFile)).toBe(0o600);
      expect(mode(file)).toBe(0o600);
    }
    expect(reg.deviceKeyStatus(k)).toEqual({ status: "revoked" });
  });

  it("unknown or already-revoked id → false and nothing changes (E14)", () => {
    const reg = new PairedDeviceRegistry(file);
    const { device } = reg.add("a");
    expect(reg.revoke("nope")).toBe(false);
    expect(reg.revoke(device.id)).toBe(true);
    const before = fs.readFileSync(revFile, "utf-8");
    expect(reg.revoke(device.id)).toBe(false);
    expect(fs.readFileSync(revFile, "utf-8")).toBe(before);
  });

  it("notifies onRevoked listeners with the id after success only", () => {
    const reg = new PairedDeviceRegistry(file);
    const { device } = reg.add("a");
    const seen: string[] = [];
    const off = reg.onRevoked((id) => seen.push(id));
    reg.revoke("nope");
    expect(seen).toEqual([]);
    reg.revoke(device.id);
    expect(seen).toEqual([device.id]);
    off();
  });

  it("a failed first write keeps the device active and throws (X17)", () => {
    const reg = new PairedDeviceRegistry(file);
    const { device, token } = reg.add("a");
    fs.mkdirSync(revFile); // revoked path unwritable (a directory)
    expect(() => reg.revoke(device.id)).toThrow();
    expect(reg.verify(token, "tls")).toEqual({ id: device.id, tier: "operate" });
    expect(reg.list()).toHaveLength(1);
  });
});

describe("state machine (E14)", () => {
  it("restore / delete-now codes", () => {
    const reg = new PairedDeviceRegistry(file);
    const d1 = reg.add("d1").device;
    const d2 = reg.add("d2").device;
    reg.revoke(d2.id);
    expect(reg.restore("nope")).toBe("not-found");
    expect(reg.deleteRevoked("nope")).toBe("not-found");
    expect(reg.restore(d1.id)).toBe("active");
    expect(reg.deleteRevoked(d1.id)).toBe("active");
    expect(reg.restore(d2.id)).toBe("restored");
    expect(reg.restore(d2.id)).toBe("active");
    expect(reg.deleteRevoked(d2.id)).toBe("active");
    expect(reg.listRevoked().devices).toEqual([]);
    reg.revoke(d2.id);
    expect(reg.deleteRevoked(d2.id)).toBe("deleted");
    expect(reg.restore(d2.id)).toBe("not-found");
    expect(readRev()).toEqual([]);
    expect(reg.list().map((d) => d.id)).toEqual([d1.id]);
  });

  it("listRevoked shows who/when without token material", () => {
    const reg = new PairedDeviceRegistry(file);
    const { device, token } = reg.add("d");
    reg.revoke(device.id, "local");
    const { devices, warning } = reg.listRevoked();
    expect(warning).toBeUndefined();
    expect(devices[0]).toMatchObject({ id: device.id, revokedBy: "local", revokedAt: T0 });
    expect(JSON.stringify(devices)).not.toContain(token);
    expect(JSON.stringify(devices)).not.toContain(sha(token));
  });
});

describe("restore returns the whole record (E15)", () => {
  it("field-for-field, token verifies again, lastSeen not rewound", () => {
    const H = sha("tok");
    seedActive([
      { id: "d1", tokenHash: H, tier: "control", label: "Roberts-MacBook-Pro", source: "pairing", keys: { pub: "K", createdAt: "c" },
        companions: [{ id: "c1", pub: "C", origin: "http://192.168.16.31:8000", createdAt: "c" }],
        expiresAt: T0 + 5 * DAY, pairedAt: T0 - DAY, previousHash: sha("old"), previousExpiresAt: T0 + 5 * DAY, "x-future": { a: 1 } },
    ]);
    const reg = new PairedDeviceRegistry(file);
    const original = JSON.parse(fs.readFileSync(file, "utf-8"))[0];
    expect(reg.verify("tok", "tls")?.id).toBe("d1"); // advances in-memory lastSeen
    const seen = (reg as unknown as { devices: { lastSeen: string }[] }).devices[0].lastSeen;
    reg.revoke("d1");
    vi.setSystemTime(T0 + 1000);
    expect(reg.restore("d1")).toBe("restored");
    const restored = JSON.parse(fs.readFileSync(file, "utf-8"))[0];
    expect({ ...restored, lastSeen: null }).toEqual({ ...original, lastSeen: null });
    expect(restored.lastSeen).toBe(seen);
    expect(reg.verify("tok", "tls")?.id).toBe("d1");
  });
});

describe("retention (E16)", () => {
  it("purges at start, on list and on check at age >= 90 d; keeps 90 d - 1 s", () => {
    const kOld = mkPub();
    const kNew = mkPub();
    seedRevoked([
      { id: "old", revokedAt: T0 - REVOKED_RETENTION_MS - 1000, keys: { pub: kOld, createdAt: "c" } },
      { id: "new", revokedAt: T0 - REVOKED_RETENTION_MS + 1000, keys: { pub: kNew, createdAt: "c" } },
      { id: "exact", revokedAt: T0 - REVOKED_RETENTION_MS },
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const reg = new PairedDeviceRegistry(file);
    expect(reg.listRevoked().devices.map((d) => d.id)).toEqual(["new"]);
    expect(readRev().map((r: { id: string }) => r.id)).toEqual(["new"]);
    expect(reg.deviceKeyStatus(kOld)).toEqual({ status: "unknown" });
    expect(reg.deviceKeyStatus(kNew)).toEqual({ status: "revoked" });
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines).toContain("[pairing] purged id=old");
    expect(lines).toContain("[pairing] purged id=exact");

    // ages past 90 d while running → purged by the next check, and (separately) the next list
    vi.setSystemTime(T0 + 2000);
    expect(reg.deviceKeyStatus(kNew)).toEqual({ status: "unknown" });
    expect(reg.listRevoked().devices).toEqual([]);
  });

  it("purge by list read when no check ran", () => {
    seedRevoked([{ id: "a", revokedAt: T0 - REVOKED_RETENTION_MS + 1000 }]);
    const reg = new PairedDeviceRegistry(file);
    expect(reg.listRevoked().devices).toHaveLength(1);
    vi.setSystemTime(T0 + 1000);
    expect(reg.listRevoked().devices).toEqual([]);
  });
});

describe("expiry while held (E20)", () => {
  const T = T0 + 7 * DAY;
  const mk = (id: string, tok: string) => ({ id, tokenHash: sha(tok), pairedAt: T0, expiresAt: T });

  it("Undo never extends expiry; a record that expired while held comes back expired", () => {
    seedActive([mk("da", "ta"), mk("db", "tb"), mk("dc", "tc")]);
    const reg = new PairedDeviceRegistry(file);
    vi.setSystemTime(T - DAY);
    reg.revoke("da");
    reg.revoke("db");
    reg.revoke("dc");
    vi.setSystemTime(T - DAY / 2);
    reg.restore("da");
    expect(reg.verify("ta", "tls")?.id).toBe("da");
    vi.setSystemTime(T - 3_600_000);
    expect(reg.verify("ta", "tls")?.id).toBe("da");
    vi.setSystemTime(T);
    expect(reg.verifyDetailed("ta", "tls")).toEqual({ status: "expired", id: "da" });
    const row = JSON.parse(fs.readFileSync(file, "utf-8"))[0];
    expect(row).toMatchObject({ expiresAt: T, pairedAt: T0 });

    vi.setSystemTime(T + 2 * DAY);
    reg.restore("db");
    expect(reg.verifyDetailed("tb", "tls")).toEqual({ status: "expired", id: "db" });
    expect(reg.deviceKeyStatus(mkPubFor(reg, "db"))).toEqual({ status: "expired" });
    // Dc stays held: revoked wins over expired
    expect(reg.verifyDetailed("tc", "tls")).toEqual({ status: "invalid" });
  });

  function mkPubFor(reg: PairedDeviceRegistry, id: string): string {
    const k = mkPub();
    expect(reg.bindKey(id, k)).toBe("bound");
    return k;
  }

  it("while held (past expiry) the key answers revoked, never expired", () => {
    seedActive([mk("dc", "tc")]);
    const reg = new PairedDeviceRegistry(file);
    const k = mkPubFor(reg, "dc");
    reg.revoke("dc");
    vi.setSystemTime(T + DAY);
    expect(reg.deviceKeyStatus(k)).toEqual({ status: "revoked" });
  });
});

describe("grace window (E21)", () => {
  const setup = () => {
    const reg = new PairedDeviceRegistry(file);
    const { token: O } = reg.add("d", "pairing", undefined, "browser");
    return { reg, O };
  };

  it("revoke kills old and new bearer; held record keeps both hashes; Undo does not restart grace", () => {
    for (const restoreAfter of [30_000, 5 * 60_000]) {
      fs.rmSync(file, { force: true });
      fs.rmSync(revFile, { force: true });
      vi.setSystemTime(T0);
      const { reg, O } = setup();
      const r = reg.rotate(O, true, { channel: "tls" });
      if (!r.ok) throw new Error("rotate failed");
      const N = r.token;
      vi.setSystemTime(T0 + 10_000);
      const id = r.id;
      reg.revoke(id);
      expect(reg.verifyDetailed(O, "tls")).toEqual({ status: "invalid" });
      expect(reg.verifyDetailed(N, "tls")).toEqual({ status: "invalid" });
      const held = readRev()[0];
      expect(held.previousHash).toBe(sha(O));
      expect(held.tokenHash).toBe(sha(N));
      expect(held.previousExpiresAt).toBe(T0 + 60_000);
      vi.setSystemTime(T0 + restoreAfter);
      reg.restore(id);
      expect(reg.verify(N, "tls")?.id).toBe(id);
      if (restoreAfter === 30_000) {
        expect(reg.verify(O, "tls")?.id).toBe(id);
        vi.setSystemTime(T0 + 60_000);
        expect(reg.verify(O, "tls")).toBeNull();
      } else {
        expect(reg.verify(O, "tls")).toBeNull();
      }
    }
  });
});

describe("two-file consistency and unreadable store (X17)", () => {
  it("id in both files at start → revoked wins, removed from active, token refused", () => {
    seedActive([{ id: "both", tokenHash: sha("t") }, { id: "keep", tokenHash: sha("k") }]);
    seedRevoked([{ id: "both", revokedAt: T0 - 1000 }]);
    const reg = new PairedDeviceRegistry(file);
    expect(reg.verify("t", "tls")).toBeNull();
    expect(reg.list().map((d) => d.id)).toEqual(["keep"]);
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).map((r: { id: string }) => r.id)).toEqual(["keep"]);
    expect(reg.restore("both")).toBe("restored"); // operator can restore again
  });

  it("crash between the two revoke writes: revoked wins after restart", () => {
    const reg = new PairedDeviceRegistry(file);
    const { device, token } = reg.add("a");
    const real = fs.renameSync;
    let n = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((a, b) => {
      // first rename = revoked file; second = active file → fail
      if (++n === 2) throw new Error("crash");
      return real(a, b);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(reg.revoke(device.id)).toBe(true);
    vi.restoreAllMocks();
    // on-disk active file still lists the device; revoked record exists
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).map((r: { id: string }) => r.id)).toEqual([device.id]);
    const reg2 = new PairedDeviceRegistry(file);
    expect(reg2.verify(token, "tls")).toBeNull();
    expect(reg2.list()).toEqual([]);
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["wrong shape", JSON.stringify({ not: "an array" })],
    ["wrong row shape", JSON.stringify([{ id: 1 }])],
  ])("%s revoked file is set aside; error logged; warning; active unaffected", (_n, content) => {
    const reg0 = new PairedDeviceRegistry(file);
    const { token } = reg0.add("a");
    fs.writeFileSync(revFile, content);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const reg = new PairedDeviceRegistry(file);
    expect(err).toHaveBeenCalled();
    expect(fs.existsSync(revFile)).toBe(false);
    expect(fs.readdirSync(dir).some((f) => /^revoked-devices\.corrupt-\d+\.json$/.test(f))).toBe(true);
    expect(reg.listRevoked()).toEqual({ devices: [], warning: "unreadable" });
    expect(reg.verify(token, "tls")?.tier).toBe("operate");
  });

  it("an empty (0 byte) revoked file is an empty list, not an error", () => {
    fs.writeFileSync(revFile, "");
    const reg = new PairedDeviceRegistry(file);
    expect(reg.listRevoked()).toEqual({ devices: [] });
    expect(fs.existsSync(revFile)).toBe(true);
  });
});
