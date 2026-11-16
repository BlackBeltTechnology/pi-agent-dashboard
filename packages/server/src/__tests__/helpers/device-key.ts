/**
 * Test-side device key: raw Ed25519 public key (base64url) + signer, and builders for the
 * proof bodies the server accepts. See change: device-key-mutual-check.
 */
import crypto from "node:crypto";
import { companionMessage, devbindMessage, devcheckMessage } from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";

export interface TestDeviceKey {
  pub: string;
  sign(message: string): string;
}

export function newDeviceKey(): TestDeviceKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pub = (publicKey.export({ format: "jwk" }) as { x: string }).x;
  return { pub, sign: (m) => crypto.sign(null, Buffer.from(m, "utf8"), privateKey).toString("base64url") };
}

export const statusProof = (k: TestDeviceKey, fp: string, deviceNonce: string) => ({
  deviceNonce,
  pub: k.pub,
  sig: k.sign(devcheckMessage(fp, deviceNonce)),
});

export const bindProof = (k: TestDeviceKey, fp: string, deviceNonce: string) => ({
  deviceNonce,
  pub: k.pub,
  sig: k.sign(devbindMessage(fp, deviceNonce)),
});

export const companionClaim = (k: TestDeviceKey, fp: string, origin: string, ts: number) => ({
  pub: k.pub,
  ts,
  origin,
  sig: k.sign(companionMessage(fp, origin, ts)),
});
