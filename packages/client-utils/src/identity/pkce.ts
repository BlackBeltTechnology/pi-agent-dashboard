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

/** Derive the S256 challenge for a verifier: base64url(SHA-256(verifier)). */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
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
