/**
 * Browser device-pairing wire helpers — the port of the Electron shell's
 * `packages/shell/src/lib/protocol.ts` handshake bits used by `PairLanding`.
 *
 * The server identity is an Ed25519 keypair; the browser PINS the fingerprint
 * (== `payload.id`) by challenging a fresh random nonce and verifying the
 * returned signature against the returned public key. A url that answers but
 * fails verification is an impostor and MUST be refused.
 *
 * See change: make-pairing-qr-camera-scannable.
 */

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The server ANSWERED, but not with a usable `{success: true}` envelope (non-JSON
 * body, `success: false`, 404 …). Distinct from a transport failure (fetch rejects),
 * so a caller can tell "an older server without this route" from "unreachable".
 * Still an `Error` carrying the same message as before.
 */
export class HttpEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpEnvelopeError";
  }
}

/**
 * The challenge answered but proves nothing usable. `no-proof` = a response
 * without key/signature (older server, 404); `invalid-key` = unparseable key
 * material; `unsupported` = this browser has no WebCrypto Ed25519.
 */
export class IdentityChallengeError extends Error {
  readonly reason: "no-proof" | "invalid-key" | "unsupported";
  constructor(reason: "no-proof" | "invalid-key" | "unsupported", message?: string) {
    super(message ?? reason);
    this.name = "IdentityChallengeError";
    this.reason = reason;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}

/** POST JSON to `<base><path>` and unwrap the `{success,data,error}` envelope. */
export async function postJson<T>(base: string, path: string, body: unknown, timeoutMs?: number): Promise<T> {
  const res = await fetchWithTimeout(
    joinUrl(base, path),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new HttpEnvelopeError(`request failed (${res.status})`);
  }
  if (!json?.success) throw new HttpEnvelopeError(json?.error || `request failed (${res.status})`);
  return json.data as T;
}

interface ChallengeResponse {
  fingerprint: string;
  publicKey: string;
  signature: string;
  v: number;
}

async function importPublicKey(publicKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    b64urlToBytes(publicKeyB64).buffer as ArrayBuffer,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

async function verifyNonce(publicKeyB64: string, signatureB64: string, nonce: string): Promise<boolean> {
  const key = await importPublicKey(publicKeyB64);
  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    b64urlToBytes(signatureB64).buffer as ArrayBuffer,
    new TextEncoder().encode(nonce),
  );
}

/** True when WebCrypto `subtle` exists (secure contexts only) — nothing can be proven without it. */
export function canProveIdentity(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle?.verify === "function";
}

export interface IdentityProof {
  fingerprint: string;
  publicKey: string;
  /** Signature over the nonce verified against `publicKey`. */
  verified: boolean;
}

/**
 * Challenge a server: send a fresh random nonce, verify the returned signature
 * against the returned public key. The CALLER must compare `fingerprint`
 * against the pinned `payload.id` and refuse on mismatch.
 */
export async function challengeIdentity(base: string, timeoutMs?: number): Promise<IdentityProof> {
  const nonce = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
  let data: ChallengeResponse;
  try {
    data = await postJson<ChallengeResponse>(base, "/api/pair/challenge", { nonce }, timeoutMs);
  } catch (e) {
    if (e instanceof HttpEnvelopeError) throw new IdentityChallengeError("no-proof", e.message);
    throw e;
  }
  if (typeof data?.publicKey !== "string" || typeof data.signature !== "string" || typeof data.fingerprint !== "string") {
    throw new IdentityChallengeError("no-proof", "challenge answer has no key or signature");
  }
  let verified: boolean;
  let fingerprint: string;
  try {
    // The fingerprint is RECOMPUTED from the presented key (as the server-side proof does):
    // a server must not be able to claim a fingerprint it does not hold the key for.
    fingerprint = await fingerprintOf(data.publicKey);
    verified = await verifyNonce(data.publicKey, data.signature, nonce);
  } catch (e) {
    // Duck-typed: a DOMException is not always `instanceof Error` across realms (jsdom).
    const err = e as { name?: unknown; message?: unknown } | null;
    throw new IdentityChallengeError(
      err?.name === "NotSupportedError" ? "unsupported" : "invalid-key",
      typeof err?.message === "string" ? err.message : undefined,
    );
  }
  return { fingerprint, publicKey: data.publicKey, verified };
}

/** `sha256:<base64url>` over the SPKI DER key bytes — the derivation the server publishes. */
async function fingerprintOf(publicKeyB64: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", b64urlToBytes(publicKeyB64).buffer as ArrayBuffer);
  return `sha256:${bytesToB64url(new Uint8Array(digest))}`;
}
