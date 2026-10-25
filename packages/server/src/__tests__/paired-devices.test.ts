import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { PairingManager } from "../pairing/pairing.js";
import { DAY_MS, get, mkRotationApp, rotate, T0, writeRegistryRows } from "./helpers/bearer-rotation-app.js";

let tmpDir: string;
let regPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-paired-"));
  regPath = path.join(tmpDir, "paired-devices.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("PairedDeviceRegistry", () => {
  it("adds a device and returns a plaintext token once (0600 on disk)", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token } = reg.add("My iPhone");
    expect(token.length).toBeGreaterThan(20);
    expect(device.label).toBe("My iPhone");
    expect(fs.existsSync(regPath)).toBe(true);
    // Plaintext token never persisted.
    expect(fs.readFileSync(regPath, "utf-8")).not.toContain(token);
    if (process.platform !== "win32") {
      expect(fs.statSync(regPath).mode & 0o777).toBe(0o600);
    }
  });

  it("verifies a valid token and rejects unknown/revoked tokens", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token } = reg.add("dev");
    // Pairing source with no explicit tier → operate (D1).
    expect(reg.verify(token, "tls")).toEqual({ id: device.id, tier: "operate" });
    expect(reg.verify("bogus-token", "tls")).toBe(null);
    expect(reg.verify(undefined, "tls")).toBe(null);

    expect(reg.revoke(device.id)).toBe(true);
    expect(reg.verify(token, "tls")).toBe(null); // revoked → rejected
    expect(reg.revoke(device.id)).toBe(false); // already gone
  });

  it("updates last-seen on successful verify", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token } = reg.add("dev");
    expect(reg.list().find((d) => d.id === device.id)?.lastSeen).toBe(null);
    reg.verify(token, "tls");
    expect(reg.list().find((d) => d.id === device.id)?.lastSeen).not.toBe(null);
  });

  it("persists across reconstruction (reload)", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token } = reg.add("dev");
    const reg2 = new PairedDeviceRegistry(regPath);
    expect(reg2.verify(token, "tls")).toMatchObject({ id: device.id });
  });
});

// E15 (test-plan: mcp-legacy-clients-and-token-issuance) — rows written before
// `source` existed read as `"pairing"` and the field is added on the next write.
describe("E15 — registry rows without a source field", () => {
  it("list as pairing, still verify, and normalise on the next write", () => {
    const legacyToken = "legacy-plaintext-token";
    const legacyHash = crypto.createHash("sha256").update(legacyToken).digest("hex");
    fs.writeFileSync(
      regPath,
      JSON.stringify([
        { id: "row-1", label: "old", tokenHash: legacyHash, createdAt: "2026-01-01T00:00:00.000Z", lastSeen: null },
      ]),
    );
    const reg = new PairedDeviceRegistry(regPath);

    expect(reg.list()[0]).toMatchObject({ id: "row-1", label: "old", source: "pairing" });
    // The legacy token continues to verify — as `operate` (full access kept).
    expect(reg.verify(legacyToken, "tls")).toMatchObject({ id: "row-1", tier: "operate" });

    // The next write back-fills `source` on the OLD row too.
    reg.add("new-device");
    const rows = JSON.parse(fs.readFileSync(regPath, "utf-8"));
    expect(rows[0].source).toBe("pairing");
    expect(rows[1].source).toBe("pairing");
  });

  it("a manual add records source manual (E16 shape)", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token } = reg.add("cli", "manual");
    expect(device.source).toBe("manual");
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(reg.list()[0].source).toBe("manual");
  });
});

// E1–E5 (test-plan expand-mcp-tiered-surface) — registry tier + legacy-row
// defaults + unknown-field preservation. See change: expand-mcp-tiered-surface.
describe("tier on the registry (E1–E5)", () => {
  it("E1: add(manual) with no tier defaults to observe", () => {
    const reg = new PairedDeviceRegistry(regPath);
    reg.add("x", "manual");
    expect(reg.list()[0]).toMatchObject({ tier: "observe" });
  });

  it("E2: add(pairing) with no tier defaults to operate", () => {
    const reg = new PairedDeviceRegistry(regPath);
    reg.add("x", "pairing");
    expect(reg.list()[0]).toMatchObject({ tier: "operate" });
  });

  it("E3: an invalid tier throws before minting; the file is byte-identical", () => {
    const reg = new PairedDeviceRegistry(regPath);
    reg.add("seed", "manual"); // create the file
    const before = fs.readFileSync(regPath, "utf-8");
    expect(() => reg.add("x", "manual", "root" as never)).toThrow();
    const after = fs.readFileSync(regPath, "utf-8");
    expect(after).toBe(before);
    expect(Buffer.byteLength(after)).toBe(Buffer.byteLength(before));
    expect(reg.list()).toHaveLength(1);
  });

  it("E4: a legacy row (no tier, no source) verifies as operate and lists pairing/operate", () => {
    const legacyToken = "legacy-plaintext-token";
    const legacyHash = crypto.createHash("sha256").update(legacyToken).digest("hex");
    fs.writeFileSync(
      regPath,
      JSON.stringify([
        { id: "row-1", label: "old", tokenHash: legacyHash, createdAt: "2026-01-01T00:00:00.000Z", lastSeen: null },
      ]),
    );
    const reg = new PairedDeviceRegistry(regPath);
    expect(reg.verify(legacyToken, "tls")).toEqual({ id: "row-1", tier: "operate" });
    expect(reg.list()[0]).toMatchObject({ source: "pairing", tier: "operate" });
  });

  it("E5: unknown fields on a row survive an add + revoke round-trip", () => {
    const legacyToken = "legacy-plaintext-token";
    const legacyHash = crypto.createHash("sha256").update(legacyToken).digest("hex");
    fs.writeFileSync(
      regPath,
      JSON.stringify([
        {
          id: "row-1",
          label: "old",
          tokenHash: legacyHash,
          createdAt: "2026-01-01T00:00:00.000Z",
          lastSeen: null,
          tier: "control",
          source: "manual",
          futureField: 1,
        },
      ]),
    );
    const reg = new PairedDeviceRegistry(regPath);
    const { device } = reg.add("scratch", "manual");
    reg.revoke(device.id);
    const rows = JSON.parse(fs.readFileSync(regPath, "utf-8"));
    const original = rows.find((r: { id: string }) => r.id === "row-1");
    expect(original.futureField).toBe(1);
    expect(original.tier).toBe("control");
  });

  it("an explicit tier is persisted and survives reconstruction", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { token } = reg.add("explicit", "manual", "control");
    const reg2 = new PairedDeviceRegistry(regPath);
    expect(reg2.verify(token, "tls")).toEqual(expect.objectContaining({ tier: "control" }));
  });
});

// ── Browser-held bearer expiry (change: harden-auth-credentials, D5) ──
// AE34, AE45, AE51, AE72, AP1, AP5. Fake clock: Date only.
describe("browser bearer expiry — registry", () => {
  const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
  const rows = () => JSON.parse(fs.readFileSync(regPath, "utf8")) as Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("AE34 holder:browser pairing → expiresAt = T+604 800 s and pairedAt = T; a plain pairing never expires", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const mgr = new PairingManager({ registry: reg, getFingerprint: () => "fp", getReachableUrls: () => ["https://a.example"] });
    const pair = (holder?: string) => {
      const p = mgr.createPayload()!;
      const r = mgr.redeem(p.code, holder === undefined ? {} : { holder });
      if (!r.ok) throw new Error("redeem failed");
      expect(mgr.approve(p.code, r.confirmCode, holder ?? "plain").ok).toBe(true);
      const polled = mgr.poll(r.pendingId);
      if (polled.status !== "approved") throw new Error("poll failed");
      return polled;
    };
    const browser = pair("browser");
    const plain = pair();
    const byLabel = (l: string) => rows().find((r) => r.label === l) as Record<string, unknown>;
    expect(byLabel("browser")).toMatchObject({ expiresAt: T0 + 604_800_000, pairedAt: T0 });
    expect("expiresAt" in byLabel("plain")).toBe(false);
    expect(browser.expiresAt).toBe(T0 + 604_800_000);
    expect(plain.expiresAt).toBeUndefined();
    vi.setSystemTime(T0 + 400 * DAY_MS);
    expect(reg.verify(plain.token, "tls")).not.toBe(null);
    expect(reg.verify(browser.token, "tls")).toBe(null);
  });

  it("AE45 rows written by pre-change code never expire (absent, null, pairedAt-only)", async () => {
    const a = await mkRotationApp({
      seed: (f) =>
        writeRegistryRows(f, [
          { token: "t-none" },
          { token: "t-null", expiresAt: null },
          { token: "t-paired", pairedAt: T0 - 400 * DAY_MS },
        ]),
    });
    try {
      vi.setSystemTime(T0 + 400 * DAY_MS);
      for (const t of ["t-none", "t-null", "t-paired"]) {
        const res = await get(a, t);
        expect(res.statusCode).toBe(200);
        expect(res.json().code).toBeUndefined();
      }
    } finally {
      await a.close();
    }
  });

  it("AE51 plaintext is returned once: file 0600 and free of A/B, list has no hash fields", async () => {
    const a = await mkRotationApp();
    try {
      const d = a.reg.add("L", "pairing", "operate", "browser");
      const res = await rotate(a, d.token);
      const B = res.json().token as string;
      const file = a.bytes();
      expect(file).not.toContain(d.token);
      expect(file).not.toContain(B);
      if (process.platform !== "win32") expect(fs.statSync(a.file).mode & 0o777).toBe(0o600);
      const listJson = JSON.stringify(a.reg.list());
      expect(listJson).not.toContain(d.token);
      expect(listJson).not.toContain(B);
      expect(listJson).not.toMatch(/tokenHash|previousHash|previousExpiresAt/);
      // Rotating again hands out a NEW bearer; nothing ever re-serves B.
      const again = await rotate(a, B);
      expect(again.json().token).not.toBe(B);
      expect(again.body).not.toContain(B);
    } finally {
      await a.close();
    }
  });

  it("AE72 malformed expiresAt / pairedAt fail closed (401 bearer_expired); null stays non-expiring; load keeps rows", async () => {
    const bad: unknown[] = ["garbage", "-1", -1, 0, "", {}, true];
    const good = { pairedAt: T0, expiresAt: T0 + DAY_MS };
    const specs: Array<{ token: string } & Record<string, unknown>> = [];
    bad.forEach((v, i) => {
      specs.push({ token: `exp-${i}`, ...good, expiresAt: v });
      specs.push({ token: `paired-${i}`, ...good, pairedAt: v });
    });
    specs.push({ token: "control", expiresAt: null });
    const a = await mkRotationApp({ seed: (f) => writeRegistryRows(f, specs) });
    try {
      const loaded = a.bytes();
      expect(a.reg.list()).toHaveLength(specs.length);
      for (const spec of specs.filter((x) => x.token !== "control")) {
        const res = await get(a, spec.token);
        expect(res.statusCode, spec.token).toBe(401);
        expect(res.json().code, spec.token).toBe("bearer_expired");
      }
      expect((await get(a, "control")).statusCode).toBe(200);
      // Malformed rows are neither dropped nor rewritten (only last-seen of the valid control row may move).
      const after = JSON.parse(a.bytes()) as Array<Record<string, unknown>>;
      const before = JSON.parse(loaded) as Array<Record<string, unknown>>;
      expect(after.filter((r) => r.label === "legacy")).toHaveLength(specs.length);
      for (const [i, r] of before.entries()) {
        if (i === specs.length - 1) continue;
        expect(after[i]).toEqual(r);
      }
    } finally {
      await a.close();
    }
  });

  it("AP1 1000 rotations accumulate no state: file size is constant, only the newest two bearers verify", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const first = reg.add("L", "pairing", "operate", "browser");
    const issued: string[] = [first.token];
    let sizeAfterFirst = 0;
    for (let i = 1; i <= 1000; i++) {
      vi.setSystemTime(T0 + i * 61_000);
      const res = reg.rotate(issued[i - 1], false);
      if (!res.ok) throw new Error(`rotation ${i}: ${res.reason}`);
      issued.push(res.token);
      if (i === 1) sizeAfterFirst = fs.statSync(regPath).size;
    }
    expect(fs.statSync(regPath).size).toBe(sizeAfterFirst);
    const [row] = rows();
    expect(Object.keys(row).filter((k) => k.startsWith("previous")).sort()).toEqual(["previousExpiresAt", "previousHash"]);
    expect(reg.verify(issued[1000], "tls")).not.toBe(null);
    expect(reg.verify(issued[999], "tls")).not.toBe(null);
    for (let i = 0; i <= 998; i++) expect(reg.verify(issued[i], "tls")).toBe(null);
    expect(sha(issued[1000])).toBe(row.tokenHash);
  });

  it("AP5 verifies run on in-memory state: 0 sync file reads/writes/renames across 10 000 mixed verifies", () => {
    const reg = new PairedDeviceRegistry(regPath);
    vi.setSystemTime(T0 - 8 * DAY_MS);
    const expiring = reg.add("exp", "pairing", "operate", "browser"); // expired by T0
    vi.setSystemTime(T0);
    const legacy = reg.add("legacy", "manual", "observe");
    const live = reg.add("live", "pairing", "operate", "browser");
    const old = reg.add("old", "pairing", "operate", "browser");
    const rotated = reg.rotate(old.token, false);
    if (!rotated.ok) throw new Error("rotate failed");
    vi.setSystemTime(T0 + 30_000); // grace window for `old`
    // Warm the pre-existing throttled last-seen write (once per device per 60 s) so only the
    // verify hot path is measured; rows are registry-loaded state either way.
    for (const t of [legacy.token, live.token, rotated.token]) reg.verify(t, "tls");
    const reads = vi.spyOn(fs, "readFileSync");
    const writes = vi.spyOn(fs, "writeFileSync");
    const renames = vi.spyOn(fs, "renameSync");
    const mix = [legacy.token, live.token, old.token /* grace */, expiring.token /* expired */, "unknown"];
    try {
      for (let i = 0; i < 10_000; i++) reg.verify(mix[i % mix.length], "tls");
      expect(reads).not.toHaveBeenCalled();
      expect(writes).not.toHaveBeenCalled();
      expect(renames).not.toHaveBeenCalled();
    } finally {
      reads.mockRestore();
      writes.mockRestore();
      renames.mockRestore();
    }
  });
});

// ── prove-vault-bridge-tls: bearer exposure record (D4) + TLS-only tokens (D9) ───────────────────

describe("PairedDeviceRegistry exposure record", () => {
  const rowsOf = (): Array<Record<string, any>> => JSON.parse(fs.readFileSync(regPath, "utf-8"));

  it("E10 writes the first exposure exactly once", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token } = reg.add("dev", "manual", "operate", undefined, { channel: "tls" });
    expect(reg.deviceTrust(device.id)).toBe("eligible");
    reg.verify(token, "plain"); // first exposure → one registry write
    const writes = vi.spyOn(fs, "writeFileSync");
    try {
      const seenAt = rowsOf()[0].exposure.plaintextSeenAt;
      expect(typeof seenAt).toBe("string");
      for (const n of [1, 2, 50]) {
        for (let i = 0; i < n; i++) reg.verify(token, "plain");
      }
      expect(writes).not.toHaveBeenCalled();
      expect(rowsOf()[0].exposure.plaintextSeenAt).toBe(seenAt);
      expect(reg.deviceTrust(device.id)).toBe("exposed");
    } finally {
      writes.mockRestore();
    }
  });

  it("E11 a legacy row reads history-unknown; a tracked row keeps its exposure bytes across an unrelated persist", () => {
    const legacyHash = crypto.createHash("sha256").update("legacy-token").digest("hex");
    const trackedHash = crypto.createHash("sha256").update("tracked-token").digest("hex");
    fs.writeFileSync(
      regPath,
      JSON.stringify([
        { id: "legacy", label: "l", tokenHash: legacyHash, createdAt: "2026-01-01T00:00:00.000Z", lastSeen: null, source: "manual", tier: "operate" },
        {
          id: "tracked", label: "t", tokenHash: trackedHash, createdAt: "2026-01-01T00:00:00.000Z", lastSeen: null, source: "manual", tier: "operate",
          exposure: { trackedSince: "2026-02-01T00:00:00.000Z", plaintextSeenAt: "2026-03-01T00:00:00.000Z" },
        },
      ]),
    );
    const reg = new PairedDeviceRegistry(regPath);
    expect(reg.deviceTrust("legacy")).toBe("history-unknown");
    expect(reg.deviceTrust("tracked")).toBe("exposed");
    expect(reg.deviceTrust("nope")).toBe("inactive");
    reg.add("another", "manual", "observe"); // unrelated persist rewrites every row
    const rows = rowsOf();
    expect(rows.find((r) => r.id === "legacy")?.exposure).toBeUndefined();
    expect(rows.find((r) => r.id === "tracked")?.exposure).toEqual({
      trackedSince: "2026-02-01T00:00:00.000Z",
      plaintextSeenAt: "2026-03-01T00:00:00.000Z",
    });
  });

  it("add: a plain-channel issue is born exposed; a proven one is not; no channel makes no decision", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const plain = reg.add("a", "manual", "operate", undefined, { channel: "plain" });
    const tls = reg.add("b", "manual", "operate", undefined, { channel: "tls" });
    const proof = reg.add("c", "manual", "operate", undefined, { channel: "local-proof" });
    const none = reg.add("d", "pairing");
    expect(reg.deviceTrust(plain.device.id)).toBe("exposed");
    expect(reg.deviceTrust(tls.device.id)).toBe("eligible");
    expect(reg.deviceTrust(proof.device.id)).toBe("eligible");
    expect(reg.deviceTrust(none.device.id)).toBe("eligible");
  });

  it("add: purpose bridge mints pi_tls_ on a proven channel and refuses a non-proven one", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { token } = reg.add("bridge", "manual", "operate", undefined, { channel: "tls", purpose: "bridge" });
    expect(token.startsWith("pi_tls_")).toBe(true);
    expect(() => reg.add("bridge", "manual", "operate", undefined, { channel: "plain", purpose: "bridge" })).toThrow(/bridge_token_requires_https/);
    expect(reg.list()).toHaveLength(1); // the refused issue created no row
    const mcp = reg.add("mcp", "manual", "observe", undefined, { channel: "tls" });
    expect(mcp.token.startsWith("pi_tls_")).toBe(false);
  });

  it("E8 a pi_tls_ bearer on a non-proven channel is marked exposed, then refused", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token } = reg.add("bridge", "manual", "operate", undefined, { channel: "tls", purpose: "bridge" });
    expect(reg.verifyDetailed(token, "tls")).toMatchObject({ status: "ok", id: device.id });
    expect(reg.verifyDetailed(token, "plain")).toEqual({ status: "tls_only_refused", id: device.id });
    expect(reg.deviceTrust(device.id)).toBe("exposed");
    expect(reg.verify(token, "plain")).toBe(null);
    expect(reg.verify(token, "tls")).toMatchObject({ id: device.id }); // still authenticates over TLS (non-vault use)
  });

  it("E7 rotation keeps the token form and never clears exposure", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const exposed = reg.add("a", "manual", "operate", undefined, { channel: "plain" });
    const r1 = reg.rotate(exposed.token, true, { channel: "tls" });
    if (!r1.ok) throw new Error("rotate failed");
    expect(r1.token.startsWith("pi_tls_")).toBe(false);
    expect(reg.deviceTrust(exposed.device.id)).toBe("exposed");

    const bridge = reg.add("b", "manual", "operate", undefined, { channel: "tls", purpose: "bridge" });
    const r2 = reg.rotate(bridge.token, true, { channel: "tls" });
    if (!r2.ok) throw new Error("rotate failed");
    expect(r2.token.startsWith("pi_tls_")).toBe(true);
    expect(reg.deviceTrust(bridge.device.id)).toBe("eligible");
  });

  it("E7 the exposure mark is persisted on its own before a rotation; a failed rotation write rolls back only the rotation", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token } = reg.add("mcp", "manual", "operate", undefined, { channel: "tls" });
    const before = rowsOf()[0].tokenHash;
    let calls = 0;
    const real = fs.writeFileSync;
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(((...args: Parameters<typeof fs.writeFileSync>) => {
      calls += 1;
      if (calls >= 2) throw new Error("disk full"); // the first (exposure) write lands, the rotation write fails
      return real(...args);
    }) as typeof fs.writeFileSync);
    try {
      const r = reg.rotate(token, true, { channel: "plain" });
      expect(r).toMatchObject({ ok: false, reason: "persist_failed" });
    } finally {
      spy.mockRestore();
    }
    expect(rowsOf()[0].tokenHash).toBe(before);
    expect(typeof rowsOf()[0].exposure.plaintextSeenAt).toBe("string");
    expect(reg.deviceTrust(device.id)).toBe("exposed");
    expect(reg.verify(token, "tls")).toMatchObject({ id: device.id }); // old token still valid
  });

  it("markDelivered marks a plain delivery without re-minting or touching expiry", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token, expiresAt } = reg.add("qr", "pairing", "operate", "browser");
    reg.markDelivered(device.id, "plain");
    expect(reg.deviceTrust(device.id)).toBe("exposed");
    expect(reg.verify(token, "tls")).toMatchObject({ id: device.id });
    expect(rowsOf()[0].expiresAt).toBe(expiresAt);
    const other = reg.add("qr2", "pairing");
    reg.markDelivered(other.device.id, "tls");
    expect(reg.deviceTrust(other.device.id)).toBe("eligible");
  });

  it("X1 a failed exposure write fails closed: reads exposed, exposurePending true, retried on the next persist", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const { device, token } = reg.add("dev", "manual", "operate", undefined, { channel: "tls" });
    const listener = vi.fn();
    reg.onChange(listener);
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("EIO");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      reg.verify(token, "plain");
      expect(reg.deviceTrust(device.id)).toBe("exposed");
      expect(reg.exposurePending()).toBe(true);
      expect(errors).toHaveBeenCalled();
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      errors.mockRestore();
    }
    reg.add("other", "manual", "observe", undefined, { channel: "tls" }); // any later persist retries
    expect(reg.exposurePending()).toBe(false);
    expect(typeof rowsOf().find((r) => r.id === device.id)?.exposure.plaintextSeenAt).toBe("string");
  });

  it("onChange fires on add, revoke, rotate and first exposure; activeIds drops an expired row", () => {
    const reg = new PairedDeviceRegistry(regPath);
    const events: number[] = [];
    reg.onChange(() => events.push(1));
    const a = reg.add("a", "manual", "operate", undefined, { channel: "tls" }); // 1
    reg.verify(a.token, "plain"); // 2 (first exposure)
    reg.verify(a.token, "plain"); // none
    const r = reg.rotate(a.token, true, { channel: "tls" }); // 3
    expect(r.ok).toBe(true);
    reg.revoke(a.device.id); // 4
    expect(events).toHaveLength(4);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      const b = reg.add("b", "pairing", "operate", "browser", { channel: "tls" });
      expect(reg.activeIds().has(b.device.id)).toBe(true);
      vi.setSystemTime(T0 + 8 * DAY_MS);
      expect(reg.activeIds().has(b.device.id)).toBe(false);
      expect(reg.deviceTrust(b.device.id)).toBe("inactive");
    } finally {
      vi.useRealTimers();
    }
  });
});
