/**
 * Wire protocol helpers shared by the pairing and connect flows.
 *
 * All server JSON responses are `{ success, data?, error? }`. The server
 * identity is an Ed25519 keypair; the shell PINS the fingerprint + public key
 * at pairing time and re-verifies a signed nonce on every (re)connect so an
 * impostor reusing a URL is rejected.
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** QR / copy-string pairing payload. */
export interface PairingPayload {
  v: number;
  /** Server fingerprint (`sha256:<base64url>`) — the pinned identity. */
  id: string;
  /** Short-lived one-time pairing code. */
  code: string;
  /** https base origins the server is reachable at. */
  urls: string[];
}

// ── base64url ────────────────────────────────────────────────────────────

export function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode a copy-string (base64url of the payload JSON) into a payload. */
export function decodePayloadString(raw: string): PairingPayload {
  const trimmed = raw.trim();
  // Accept both a raw JSON string and the base64url-encoded form.
  let json: string;
  if (trimmed.startsWith("{")) {
    json = trimmed;
  } else {
    json = new TextDecoder().decode(b64urlToBytes(trimmed));
  }
  const obj = JSON.parse(json) as PairingPayload;
  if (
    typeof obj !== "object" ||
    obj === null ||
    typeof obj.id !== "string" ||
    typeof obj.code !== "string" ||
    !Array.isArray(obj.urls)
  ) {
    throw new Error("malformed pairing payload");
  }
  return obj;
}

// ── HTTP ─────────────────────────────────────────────────────────────────

/** Default per-request timeout so an unresponsive host can't hang URL racing. */
const REQUEST_TIMEOUT_MS = 10_000;

/** fetch with an AbortController timeout. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** POST JSON to `<base><path>` and unwrap the `{success,data,error}` envelope. */
export async function postJson<T>(
  base: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchWithTimeout(joinUrl(base, path), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success) throw new Error(json.error || `request failed (${res.status})`);
  return json.data as T;
}

/** GET `<base><path>` with a bearer token and unwrap the envelope. */
export async function getJson<T>(base: string, path: string, token: string): Promise<T> {
  const res = await fetchWithTimeout(joinUrl(base, path), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success) throw new Error(json.error || `request failed (${res.status})`);
  return json.data as T;
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}

// ── Ed25519 identity verification ─────────────────────────────────────────

interface ChallengeResponse {
  fingerprint: string;
  publicKey: string;
  signature: string;
  v: number;
}

/** Import a base64url SPKI DER Ed25519 public key for verification. */
async function importPublicKey(publicKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    b64urlToBytes(publicKeyB64).buffer as ArrayBuffer,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

async function verifyNonce(
  publicKeyB64: string,
  signatureB64: string,
  nonce: string,
): Promise<boolean> {
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
 * against the returned public key. Returns the proven identity or throws.
 * The CALLER must compare `fingerprint`/`publicKey` against the pinned values.
 */
export async function challengeIdentity(base: string): Promise<IdentityProof> {
  const nonce = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
  const data = await postJson<ChallengeResponse>(base, "/api/pair/challenge", { nonce });
  const verified = await verifyNonce(data.publicKey, data.signature, nonce);
  return { fingerprint: data.fingerprint, publicKey: data.publicKey, verified };
}
