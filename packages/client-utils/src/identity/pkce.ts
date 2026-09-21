/**
 * OIDC public-client PKCE (RFC 7636) primitives for the browser identity plane
 * (openspec §12.1 / design D-topology-B). Pure functions over WebCrypto —
 * `globalThis.crypto` works in the browser and in the jsdom/Node test env.
 *
 * The verifier is a high-entropy random string; the challenge is
 * `BASE64URL(SHA-256(verifier))` with method `S256` (the only method we send —
 * `plain` is disallowed by RFC 9700 for public clients).
 */

/** A PKCE verifier/challenge pair. `method` is always `S256`. */
export interface PkcePair {
  verifier: string;
  challenge: string;
  method: "S256";
}

/** Base64url (no padding) encode raw bytes — the RFC 7636 A-Z a-z 0-9 -_ set. */
function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generate a code verifier: 32 random bytes → base64url (43 chars), inside the
 * RFC 7636 43–128 length window.
 */
export function createCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

// ---------------------------------------------------------------------------
// Pure-JS SHA-256 fallback (D17/R1). `crypto.subtle` exists only in secure
// contexts (HTTPS or localhost); on a plain-HTTP non-loopback origin — the
// legitimate remote topology-B case, e.g. `http://<tailnet-ip>:<port>` — it is
// undefined and S256 derivation would throw. FIPS 180-4, test-vectored against
// WebCrypto (`pkce-sha256-fallback.test.ts`). Used ONLY when `subtle` is
// absent; `crypto.getRandomValues` is never emulated (it exists everywhere).
// ---------------------------------------------------------------------------

// prettier-ignore
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/**
 * FIPS 180-4 SHA-256 of raw bytes — the insecure-context fallback digest.
 * Exported for known-answer/parity tests only; production callers go through
 * `deriveCodeChallenge`, which prefers WebCrypto when available.
 */
export function sha256Bytes(data: Uint8Array): Uint8Array {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const l = data.length;
  // Smallest multiple of 64 that fits message + 0x80 marker + 64-bit length.
  const padded = new Uint8Array((((l + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[l] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(l / 0x20000000));
  dv.setUint32(padded.length - 4, (l << 3) >>> 0);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
  return out;
}

/**
 * Derive the S256 challenge for a verifier: base64url(SHA-256(verifier)).
 * Prefers WebCrypto; falls back to the pure-JS digest when `crypto.subtle`
 * is unavailable (insecure context — plain-HTTP non-loopback origin, D17/R1).
 * Method stays `S256` either way; RFC 9700 forbids `plain`.
 */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier);
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return base64UrlEncode(new Uint8Array(digest));
  }
  return base64UrlEncode(sha256Bytes(bytes));
}

/** Create a fresh verifier + its S256 challenge. */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = createCodeVerifier();
  const challenge = await deriveCodeChallenge(verifier);
  return { verifier, challenge, method: "S256" };
}

/** A random URL-safe `state`/`nonce` value (32 bytes base64url). */
export function createRandomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
