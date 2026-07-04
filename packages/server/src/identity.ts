/**
 * Persistent Ed25519 server identity (D2 — Model 1, TOFU/SSH-style pinning).
 *
 * On startup the server ensures a persistent Ed25519 keypair at
 * `~/.pi/dashboard/identity.key` (0600) and reuses it across restarts. The
 * public-key fingerprint is the server's stable identity, independent of the
 * URL(s) by which it is reached. A client pins the fingerprint at first pairing
 * and, on each connect, sends a nonce the server signs with its private key so
 * the client can detect an impostor even when a URL is reused.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const IDENTITY_FILENAME = "identity.key";

export interface ServerIdentity {
  /** Ed25519 private key (never leaves the server). */
  privateKey: crypto.KeyObject;
  /** Ed25519 public key. */
  publicKey: crypto.KeyObject;
  /** SPKI DER public key, base64url — the shareable identity material. */
  publicKeyB64: string;
  /** `sha256:<base64url>` fingerprint over the SPKI DER public key. */
  fingerprint: string;
}

/** Default identity file path: `~/.pi/dashboard/identity.key`. */
export function defaultIdentityPath(): string {
  return path.join(os.homedir(), ".pi", "dashboard", IDENTITY_FILENAME);
}

/** Base64url of the SPKI DER public key. */
function exportPublicKeyB64(publicKey: crypto.KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return der.toString("base64url");
}

/** `sha256:<base64url>` over the SPKI DER public key (stable, URL-safe). */
export function computeFingerprint(publicKey: crypto.KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const digest = crypto.createHash("sha256").update(der).digest("base64url");
  return `sha256:${digest}`;
}

function buildIdentity(privateKey: crypto.KeyObject): ServerIdentity {
  // createPublicKey accepts a private KeyObject at runtime; some @types/node
  // versions omit KeyObject from the parameter union, hence the cast.
  const publicKey = crypto.createPublicKey(privateKey as unknown as crypto.PublicKeyInput);
  return {
    privateKey,
    publicKey,
    publicKeyB64: exportPublicKeyB64(publicKey),
    fingerprint: computeFingerprint(publicKey),
  };
}

/**
 * Ensure a persistent Ed25519 identity keypair exists. Generates + writes it
 * (0600) on first call, reuses the stored key on later calls / restarts.
 */
export function ensureServerIdentity(identityPath = defaultIdentityPath()): ServerIdentity {
  if (fs.existsSync(identityPath)) {
    const pem = fs.readFileSync(identityPath, "utf-8");
    const privateKey = crypto.createPrivateKey(pem);
    return buildIdentity(privateKey);
  }

  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  fs.mkdirSync(path.dirname(identityPath), { recursive: true });
  // Write with 0600 from the start (mode on writeFileSync applies at create).
  fs.writeFileSync(identityPath, pem, { mode: 0o600 });
  // Enforce 0600 even if the file pre-existed with a looser umask-derived mode.
  fs.chmodSync(identityPath, 0o600);
  return buildIdentity(privateKey);
}

/** Sign a client-supplied nonce with the server private key (Ed25519). */
export function signNonce(identity: ServerIdentity, nonce: Buffer | string): string {
  const data = typeof nonce === "string" ? Buffer.from(nonce, "utf-8") : nonce;
  return crypto.sign(null, data, identity.privateKey).toString("base64url");
}

/**
 * Verify a nonce signature against a base64url SPKI DER public key. Used by the
 * client to prove a reachable server holds the pinned identity.
 */
export function verifyNonceSignature(
  publicKeyB64: string,
  nonce: Buffer | string,
  signatureB64: string,
): boolean {
  try {
    const der = Buffer.from(publicKeyB64, "base64url");
    const publicKey = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    const data = typeof nonce === "string" ? Buffer.from(nonce, "utf-8") : nonce;
    const sig = Buffer.from(signatureB64, "base64url");
    return crypto.verify(null, data, publicKey, sig);
  } catch {
    return false;
  }
}
