/**
 * Main-process device key: Ed25519 signing helpers + nonce-returning prover.
 * See change: device-key-mutual-check (D3, D9).
 */
import crypto from "node:crypto";
import {
  base64urlToBytes,
  devbindMessage,
  devcheckMessage,
  isDevicePub,
  isDeviceSig,
  rawEd25519PubToSpki,
} from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { describe, expect, it } from "vitest";
import { deviceKeyFromPrivate, generateDeviceKey, proveWithDeviceNonce } from "../device-key.js";

const F = `sha256:${"A".repeat(43)}`;
const NONCE = `${"n".repeat(42)}o`;

const verify = (pub: string, message: string, sig: string): boolean =>
  crypto.verify(
    null,
    Buffer.from(message),
    crypto.createPublicKey({ key: Buffer.from(rawEd25519PubToSpki(base64urlToBytes(pub))), format: "der", type: "spki" }),
    Buffer.from(base64urlToBytes(sig)),
  );

describe("generateDeviceKey", () => {
  it("exports a raw 32-byte unpadded base64url pub and signs devbind / devcheck over the shared messages", () => {
    const k = generateDeviceKey();
    expect(isDevicePub(k.pub)).toBe(true);
    const bind = k.signDevbind(F, NONCE);
    const check = k.signDevcheck(F, NONCE);
    expect(isDeviceSig(bind)).toBe(true);
    expect(verify(k.pub, devbindMessage(F, NONCE), bind)).toBe(true);
    expect(verify(k.pub, devcheckMessage(F, NONCE), check)).toBe(true);
    // The two proof kinds are domain-separated.
    expect(verify(k.pub, devcheckMessage(F, NONCE), bind)).toBe(false);
  });

  it("two keys differ", () => {
    expect(generateDeviceKey().pub).not.toBe(generateDeviceKey().pub);
  });
});

describe("deviceKeyFromPrivate", () => {
  it("round-trips an exported private key to the same pub and a verifying signature", () => {
    const k = generateDeviceKey();
    const back = deviceKeyFromPrivate(k.exportPrivate(), k.pub);
    expect(back?.pub).toBe(k.pub);
    expect(verify(k.pub, devbindMessage(F, NONCE), back!.signDevbind(F, NONCE))).toBe(true);
  });

  it("garbage, a non-Ed25519 key and a mismatching expected pub are all null", () => {
    expect(deviceKeyFromPrivate("not-a-key")).toBeNull();
    const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    expect(deviceKeyFromPrivate(rsa)).toBeNull();
    const k = generateDeviceKey();
    expect(deviceKeyFromPrivate(k.exportPrivate(), generateDeviceKey().pub)).toBeNull();
  });
});

describe("proveWithDeviceNonce", () => {
  it("returns the challenge reply's deviceNonce next to the shared proof", async () => {
    const id = crypto.generateKeyPairSync("ed25519");
    const spki = id.publicKey.export({ format: "der", type: "spki" });
    const publicKey = Buffer.from(spki).toString("base64url");
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      const nonce = (JSON.parse(String(init?.body)) as { nonce: string }).nonce;
      const signature = crypto.sign(null, Buffer.from(nonce), id.privateKey).toString("base64url");
      return new Response(JSON.stringify({ success: true, data: { publicKey, signature, deviceNonce: NONCE } }), { status: 200 });
    }) as typeof fetch;
    const r = await proveWithDeviceNonce("https://h.example", { fetchImpl });
    expect(r).toMatchObject({ proven: expect.stringMatching(/^sha256:/), publicKey, deviceNonce: NONCE });
  });

  it("an older server (no deviceNonce) or a malformed one yields the plain proof", async () => {
    const id = crypto.generateKeyPairSync("ed25519");
    const publicKey = Buffer.from(id.publicKey.export({ format: "der", type: "spki" })).toString("base64url");
    for (const extra of [{}, { deviceNonce: "short" }]) {
      const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
        const nonce = (JSON.parse(String(init?.body)) as { nonce: string }).nonce;
        const signature = crypto.sign(null, Buffer.from(nonce), id.privateKey).toString("base64url");
        return new Response(JSON.stringify({ success: true, data: { publicKey, signature, ...extra } }), { status: 200 });
      }) as typeof fetch;
      const r = await proveWithDeviceNonce("https://h.example", { fetchImpl });
      expect("proven" in r).toBe(true);
      expect("deviceNonce" in r).toBe(false);
    }
  });

  it("a refused challenge passes through unchanged", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    expect(await proveWithDeviceNonce("https://h.example", { fetchImpl })).toEqual({ refused: "challenge answered 500" });
  });
});
