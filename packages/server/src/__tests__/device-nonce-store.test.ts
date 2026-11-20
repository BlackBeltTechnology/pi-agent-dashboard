/**
 * Device-check nonce store + proof verifier (test-plan E4, E3 consumption rule).
 * See change: device-key-mutual-check (D1).
 */
import crypto from "node:crypto";
import { devcheckMessage, isDeviceNonce } from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { describe, expect, it } from "vitest";
import { DEVICE_NONCE_MAX, DeviceNonceStore, verifyDeviceSignature, verifyNonceProof } from "../auth/device-proof.js";

function deviceKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { pub: jwk.x, sign: (m: string) => crypto.sign(null, Buffer.from(m), privateKey).toString("base64url") };
}

describe("DeviceNonceStore", () => {
  it("issues 32 random bytes as 43 base64url chars", () => {
    const store = new DeviceNonceStore();
    const a = store.issue();
    const b = store.issue();
    expect(isDeviceNonce(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
  });

  it("is single use", () => {
    const store = new DeviceNonceStore();
    const n = store.issue();
    expect(store.consume(n)).toBe(true);
    expect(store.consume(n)).toBe(false);
  });

  it("refuses unknown nonces and non-strings", () => {
    const store = new DeviceNonceStore();
    expect(store.consume("x".repeat(43))).toBe(false);
    expect(store.consume(undefined)).toBe(false);
    expect(store.consume(42)).toBe(false);
  });

  it("expires after 60 s (injected clock)", () => {
    let t = 1_000_000;
    const store = new DeviceNonceStore({ now: () => t });
    const early = store.issue();
    const late = store.issue();
    t += 59_999;
    expect(store.consume(early)).toBe(true);
    t += 1_100;
    expect(store.consume(late)).toBe(false);
  });

  it("a used or expired nonce is deleted, not retained", () => {
    let t = 0;
    const store = new DeviceNonceStore({ now: () => t });
    store.issue();
    store.issue();
    t = 61_000;
    const n = store.issue();
    expect(store.size()).toBe(3);
    store.consume(n);
    expect(store.size()).toBe(2);
  });

  it("is bounded to 10 000 with the oldest unused evicted first", () => {
    expect(DEVICE_NONCE_MAX).toBe(10_000);
    const store = new DeviceNonceStore();
    const first = store.issue();
    let last = first;
    for (let i = 0; i < DEVICE_NONCE_MAX; i += 1) last = store.issue(); // 10 001 issued in total
    expect(store.size()).toBe(DEVICE_NONCE_MAX);
    expect(store.consume(first)).toBe(false);
    expect(store.consume(last)).toBe(true);
  });

  it("9 999 and 10 000 issued keep the first nonce", () => {
    const store = new DeviceNonceStore();
    const first = store.issue();
    for (let i = 1; i < DEVICE_NONCE_MAX; i += 1) store.issue();
    expect(store.consume(first)).toBe(true);
  });
});

describe("verifyDeviceSignature / verifyNonceProof", () => {
  it("verifies a raw-key Ed25519 signature and rejects tampering", () => {
    const k = deviceKey();
    const sig = k.sign("hello");
    expect(verifyDeviceSignature(k.pub, "hello", sig)).toBe(true);
    expect(verifyDeviceSignature(k.pub, "hellO", sig)).toBe(false);
    expect(verifyDeviceSignature(deviceKey().pub, "hello", sig)).toBe(false);
    expect(verifyDeviceSignature("short", "hello", sig)).toBe(false);
    expect(verifyDeviceSignature(k.pub, "hello", "short")).toBe(false);
  });

  it("consumes the nonce on first presentation even when the signature is invalid", () => {
    const store = new DeviceNonceStore();
    const k = deviceKey();
    const nonce = store.issue();
    const msg = (n: string) => devcheckMessage("sha256:fp", n);
    const bad = { deviceNonce: nonce, pub: k.pub, sig: deviceKey().sign(msg(nonce)) };
    expect(verifyNonceProof(store, bad, msg)).toBe(false);
    const good = { deviceNonce: nonce, pub: k.pub, sig: k.sign(msg(nonce)) };
    expect(verifyNonceProof(store, good, msg)).toBe(false); // nonce already spent
  });

  it("accepts a fresh, correctly signed proof once", () => {
    const store = new DeviceNonceStore();
    const k = deviceKey();
    const nonce = store.issue();
    const msg = (n: string) => devcheckMessage("sha256:fp", n);
    const proof = { deviceNonce: nonce, pub: k.pub, sig: k.sign(msg(nonce)) };
    expect(verifyNonceProof(store, proof, msg)).toBe(true);
    expect(verifyNonceProof(store, proof, msg)).toBe(false);
  });

  it("a proof signed for another server fingerprint never verifies", () => {
    const store = new DeviceNonceStore();
    const k = deviceKey();
    const nonce = store.issue();
    const proof = { deviceNonce: nonce, pub: k.pub, sig: k.sign(devcheckMessage("sha256:other", nonce)) };
    expect(verifyNonceProof(store, proof, (n) => devcheckMessage("sha256:fp", n))).toBe(false);
  });
});
