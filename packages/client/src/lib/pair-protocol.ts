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

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
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
export async function postJson<T>(base: string, path: string, body: unknown): Promise<T> {
  const res = await fetchWithTimeout(joinUrl(base, path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success) throw new Error(json.error || `request failed (${res.status})`);
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
export async function challengeIdentity(base: string): Promise<IdentityProof> {
  const nonce = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
  const data = await postJson<ChallengeResponse>(base, "/api/pair/challenge", { nonce });
  const verified = await verifyNonce(data.publicKey, data.signature, nonce);
  return { fingerprint: data.fingerprint, publicKey: data.publicKey, verified };
}
