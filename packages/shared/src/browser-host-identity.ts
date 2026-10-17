/**
 * Operator browser-host identity primitives (Ed25519, `node:crypto` only).
 *
 * `hostId` = `host-` + first 32 hex chars of SHA-256(SPKI DER public key).
 * Registration signs `"pi-browser-host-v1\n" + nonce + "\n" + serverId`, where
 * `serverId` is the target server's `/api/health` `instanceId`.
 *
 * Wire encoding: public key = base64(SPKI DER); signature = base64.
 * See change: add-operator-browser-relay (design D2).
 */
import { createHash, createPublicKey, verify } from "node:crypto";

export const HOST_SIGNATURE_DOMAIN = "pi-browser-host-v1";
export const HOST_ID_PATTERN = /^host-[0-9a-f]{32}$/;

/** `host-` + 32 hex of SHA-256 over the SPKI DER bytes. */
export function hostIdFromPublicKey(publicKeyBase64: string): string {
  const der = Buffer.from(publicKeyBase64, "base64");
  return `host-${createHash("sha256").update(der).digest("hex").slice(0, 32)}`;
}

/** The exact byte string a host signs to register against `serverId`. */
export function buildHostSignedMessage(nonce: string, serverId: string): string {
  return `${HOST_SIGNATURE_DOMAIN}\n${nonce}\n${serverId}`;
}

/** Verify a registration signature. Never throws — a malformed input is `false`. */
export function verifyHostSignature(
  publicKeyBase64: string,
  nonce: string,
  serverId: string,
  signatureBase64: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyBase64, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(buildHostSignedMessage(nonce, serverId), "utf-8"),
      key,
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}
