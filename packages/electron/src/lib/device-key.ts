/**
 * Main-process device key: an Ed25519 key pair this app uses to prove "this is the same device" to a
 * paired dashboard (`pi-devbind/v1` at pairing / bind, `pi-devcheck/v2` for the device check).
 *
 * - The private key lives in a closure; callers get `pub` (raw 32-byte key, unpadded base64url), the
 *   two signing methods and `exportPrivate()` (PKCS#8 DER, base64) — the last is for the keyring to
 *   encrypt with `safeStorage` and for nothing else. Nothing here is renderer-visible.
 * - `proveWithDeviceNonce` wraps the shared identity prover and also returns the challenge's
 *   server-issued `deviceNonce`, so the knock client can reuse it (≤ 30 s) or re-run the challenge.
 *
 * Electron-free; unit-tested in `__tests__/device-key.test.ts`.
 *
 * See change: device-key-mutual-check (D3, D9).
 */
import crypto, { type KeyObject } from "node:crypto";
import {
  bytesToBase64url,
  devbindMessage,
  devcheckMessage,
  isDeviceNonce,
} from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { type ProveResult, proveServerIdentity } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";

export interface DeviceKey {
  /** Raw 32-byte Ed25519 public key, unpadded base64url (43 chars). */
  readonly pub: string;
  /** Signature (64 bytes, base64url) over `pi-devbind/v1`, `fingerprint`, `deviceNonce`. */
  signDevbind(fingerprint: string, deviceNonce: string): string;
  /** Signature (64 bytes, base64url) over `pi-devcheck/v2`, `fingerprint`, `deviceNonce`. */
  signDevcheck(fingerprint: string, deviceNonce: string): string;
  /** PKCS#8 DER, base64 — for encryption at rest only; never log, never send. */
  exportPrivate(): string;
}

function rawPub(publicKey: KeyObject): string {
  const x = publicKey.export({ format: "jwk" }).x;
  if (typeof x !== "string") throw new Error("not an Ed25519 key");
  return x;
}

function wrap(privateKey: KeyObject): DeviceKey {
  const pub = rawPub(crypto.createPublicKey(privateKey));
  const sign = (message: string): string => bytesToBase64url(crypto.sign(null, Buffer.from(message, "utf8"), privateKey));
  return {
    pub,
    signDevbind: (fp, nonce) => sign(devbindMessage(fp, nonce)),
    signDevcheck: (fp, nonce) => sign(devcheckMessage(fp, nonce)),
    exportPrivate: () => privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };
}

/** A new key pair, held in memory only. */
export function generateDeviceKey(): DeviceKey {
  return wrap(crypto.generateKeyPairSync("ed25519").privateKey);
}

/**
 * Rebuild a key from {@link DeviceKey.exportPrivate} output. `null` when it does not parse, is not
 * Ed25519, or its public half differs from `expectedPub` (a mismatching pair is dropped, not trusted).
 */
export function deviceKeyFromPrivate(pkcs8Base64: string, expectedPub?: string): DeviceKey | null {
  try {
    const privateKey = crypto.createPrivateKey({ key: Buffer.from(pkcs8Base64, "base64"), format: "der", type: "pkcs8" });
    if (privateKey.asymmetricKeyType !== "ed25519") return null;
    const key = wrap(privateKey);
    return expectedPub !== undefined && key.pub !== expectedPub ? null : key;
  } catch {
    return null;
  }
}

/**
 * `proveServerIdentity` that also returns the challenge reply's `deviceNonce` (when it is well formed).
 * Verification is the shared prover's; this only reads the nonce off a clone of the same reply.
 */
export async function proveWithDeviceNonce(
  baseUrl: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ProveResult & { deviceNonce?: string }> {
  const inner = opts.fetchImpl ?? fetch;
  let deviceNonce: string | undefined;
  const capturing: typeof fetch = async (input, init) => {
    const res = await inner(input, init);
    try {
      const nonce = ((await res.clone().json()) as { data?: { deviceNonce?: unknown } })?.data?.deviceNonce;
      if (isDeviceNonce(nonce)) deviceNonce = nonce;
    } catch {
      /* no nonce: an older server, or an unreadable body — the proof itself still stands */
    }
    return res;
  };
  const proof = await proveServerIdentity(baseUrl, { ...opts, fetchImpl: capturing });
  return "proven" in proof && deviceNonce ? { ...proof, deviceNonce } : proof;
}
