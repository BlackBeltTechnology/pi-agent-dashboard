import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { PAIRING_PROTOCOL_VERSION, PairingManager } from "../pairing/pairing.js";

let tmpDir: string;
let clock: number;
let urls: string[];

function mkManager(): { mgr: PairingManager; reg: PairedDeviceRegistry } {
  const reg = new PairedDeviceRegistry(path.join(tmpDir, "paired.json"));
  const mgr = new PairingManager({
    registry: reg,
    getFingerprint: () => "sha256:test-fp",
    getReachableUrls: () => urls,
    now: () => clock,
  });
  return { mgr, reg };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pairing-"));
  clock = 1_000_000;
  urls = ["https://abc.share.zrok.io", "https://pi.example.com/"];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("payload + reachable URLs (D14)", () => {
  it("emits only secure origins, deduped, trailing slash stripped", () => {
    urls = ["https://a.io/", "http://insecure.lan:8000", "https://a.io", "wss://b.io"];
    const { mgr } = mkManager();
    const payload = mgr.createPayload();
    expect(payload).not.toBeNull();
    expect(payload!.urls).toEqual(["https://a.io", "wss://b.io"]);
    expect(payload!.id).toBe("sha256:test-fp");
    expect(payload!.v).toBe(PAIRING_PROTOCOL_VERSION);
  });

  it("NEVER admits a loopback http origin without PI_E2E_SEED (D14 intact)", () => {
    const prev = process.env.PI_E2E_SEED;
    delete process.env.PI_E2E_SEED;
    try {
      urls = ["http://localhost:18000", "http://127.0.0.1:8000", "http://evil.lan"];
      const { mgr } = mkManager();
      expect(mgr.reachableUrls()).toEqual([]);
      expect(mgr.createPayload()).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.PI_E2E_SEED;
      else process.env.PI_E2E_SEED = prev;
    }
  });

  it("admits ONLY loopback http (not other http) under PI_E2E_SEED (e2e harness)", () => {
    const prev = process.env.PI_E2E_SEED;
    process.env.PI_E2E_SEED = "1";
    try {
      urls = ["http://localhost:18000/", "http://127.0.0.1:8000", "http://evil.lan:8000", "https://a.io"];
      const { mgr } = mkManager();
      expect(mgr.reachableUrls()).toEqual([
        "http://localhost:18000",
        "http://127.0.0.1:8000",
        "https://a.io",
      ]);
    } finally {
      if (prev === undefined) delete process.env.PI_E2E_SEED;
      else process.env.PI_E2E_SEED = prev;
    }
  });

  it("returns null when no secure endpoint exists (empty-state)", () => {
    urls = ["http://192.168.1.5:8000"];
    const { mgr } = mkManager();
    expect(mgr.createPayload()).toBeNull();
  });
});

describe("one-time code TTL", () => {
  it("rejects an expired code on redeem", () => {
    const { mgr } = mkManager();
    const p = mgr.createPayload()!;
    clock += 61_000;
    expect(mgr.redeem(p.code)).toEqual({ ok: false, error: "expired" });
  });

  it("rejects an unknown code", () => {
    const { mgr } = mkManager();
    expect(mgr.redeem("nope")).toEqual({ ok: false, error: "invalid_code" });
  });

  it("restarts the approval window on redeem so a late scan still has time to approve", () => {
    const { mgr } = mkManager();
    const p = mgr.createPayload()!; // expiresAt = mint + 60s
    // Phone scans 55s later — 5s before the original code TTL would lapse.
    clock += 55_000;
    const r = mgr.redeem(p.code);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 30s after redeem — PAST the original mint window, but the redeem restarted it.
    clock += 30_000;
    // The pending device must still be visible (not swept to "unknown")...
    expect(mgr.poll(r.pendingId).status).toBe("pending");
    // ...and the operator can still type+approve.
    expect(mgr.approve(p.code, r.confirmCode).ok).toBe(true);
  });
});

describe("D12 compare-code approval", () => {
  it("premature redemption does NOT lock out the legitimate device", () => {
    const { mgr } = mkManager();
    const p = mgr.createPayload()!;
    // Attacker redeems first.
    const attacker = mgr.redeem(p.code);
    expect(attacker.ok).toBe(true);
    // Legitimate device redeems → overwrites the single pending slot, still ok.
    const legit = mgr.redeem(p.code);
    expect(legit.ok).toBe(true);
    if (legit.ok && attacker.ok) {
      expect(legit.pendingId).not.toBe(attacker.pendingId);
    }
  });

  it("approves only on matching typed confirm code, then mints a token", () => {
    const { mgr, reg } = mkManager();
    const p = mgr.createPayload()!;
    const r = mgr.redeem(p.code);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Wrong code → mismatch, no token.
    expect(mgr.approve(p.code, "00000000")).toEqual({ ok: false, error: "mismatch" });
    // Right code → device recorded + token issued.
    const ok = mgr.approve(p.code, r.confirmCode, "My iPhone");
    expect(ok.ok).toBe(true);
    expect(reg.list().some((d) => d.label === "My iPhone")).toBe(true);

    // Device polls and collects its token exactly once.
    const poll = mgr.poll(r.pendingId);
    expect(poll.status).toBe("approved");
    if (poll.status === "approved") {
      expect(reg.verify(poll.token)).not.toBe(null);
    }
    // Second poll → code consumed, unknown.
    expect(mgr.poll(r.pendingId).status).toBe("unknown");
  });

  it("rejects approval of an expired code even without an intervening sweep", () => {
    const { mgr } = mkManager();
    const p = mgr.createPayload()!;
    const r = mgr.redeem(p.code); // restarts expiresAt to now + 60s
    if (!r.ok) throw new Error("redeem failed");
    // Let the restarted window lapse with NO poll()/createPayload() sweep between.
    clock += 61_000;
    expect(mgr.approve(p.code, r.confirmCode)).toEqual({ ok: false, error: "expired" });
  });

  it("locks out after repeated wrong confirm codes", () => {
    const { mgr } = mkManager();
    const p = mgr.createPayload()!;
    const r = mgr.redeem(p.code);
    if (!r.ok) throw new Error("redeem failed");
    for (let i = 0; i < 5; i++) mgr.approve(p.code, "11111111");
    expect(mgr.approve(p.code, r.confirmCode)).toEqual({ ok: false, error: "locked_out" });
  });

  it("code is consumed only on approval (redemption alone leaves it usable)", () => {
    const { mgr } = mkManager();
    const p = mgr.createPayload()!;
    mgr.redeem(p.code);
    // Still redeemable after a bare redemption.
    expect(mgr.redeem(p.code).ok).toBe(true);
    const r = mgr.redeem(p.code);
    if (!r.ok) throw new Error("redeem failed");
    mgr.approve(p.code, r.confirmCode);
    // After approval the pairing code no longer starts a new pending flow.
    const after = mgr.redeem(p.code);
    expect(after.ok).toBe(false);
  });

  it("rate-limits redemption floods (bounded pending)", () => {
    const { mgr } = mkManager();
    const p = mgr.createPayload()!;
    let lastOk = true;
    for (let i = 0; i < 12; i++) lastOk = mgr.redeem(p.code).ok;
    expect(lastOk).toBe(false); // hit MAX_REDEEM_ATTEMPTS
  });
});
