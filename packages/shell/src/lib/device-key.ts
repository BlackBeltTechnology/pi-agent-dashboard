/**
 * Per-server device key for the neutral shell (WebCrypto Ed25519).
 *
 * Created only when pairing starts, private part non-extractable, stored
 * with the keyring entry. No Ed25519 (no `crypto.subtle`, or no algorithm
 * support) → no key and no error: the shell pairs exactly as before.
 *
 * The signed text duplicates `packages/shared/src/device-key-proof.ts`
 * (`pi-devbind/v1`, fingerprint, deviceNonce, LF-joined) — this package has
 * no dependency on the shared package.
 *
 * See change: device-key-mutual-check (D3, task 5.7).
 */
import { bytesToB64url } from "./protocol.js";

export interface ShellDeviceKey {
  /** Raw 32-byte Ed25519 public key, unpadded base64url. */
  pub: string;
  /** Non-extractable private key (IndexedDB stores it by structured clone). */
  privateKey: CryptoKey;
}

export interface DeviceKeyProof {
  deviceNonce: string;
  pub: string;
  sig: string;
}

export function devbindMessage(fingerprint: string, deviceNonce: string): string {
  return `pi-devbind/v1\n${fingerprint}\n${deviceNonce}`;
}

async function generate(): Promise<ShellDeviceKey | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const pair = (await subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
    const raw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
    return { pub: bytesToB64url(raw), privateKey: pair.privateKey };
  } catch {
    return null;
  }
}

export async function supportsDeviceKey(): Promise<boolean> {
  return (await generate()) !== null;
}

export function createDeviceKey(): Promise<ShellDeviceKey | null> {
  return generate();
}

export async function deviceKeyProofForRedeem(
  key: ShellDeviceKey,
  fingerprint: string,
  deviceNonce: string,
): Promise<DeviceKeyProof> {
  const sig = await globalThis.crypto.subtle.sign(
    { name: "Ed25519" },
    key.privateKey,
    new TextEncoder().encode(devbindMessage(fingerprint, deviceNonce)),
  );
  return { deviceNonce, pub: key.pub, sig: bytesToB64url(new Uint8Array(sig)) };
}
