/**
 * Conditional DPoP (RFC 9449) for the browser identity plane (openspec §12.5).
 *
 * DPoP is OPT-IN and driven entirely by the IdP: the client generates a proof
 * only once the token endpoint has issued a `cnf.jkt`-bound token. When the
 * token is unbound (no `cnf.jkt`), no keypair is created and no proof is ever
 * attached — the plane behaves as a plain bearer client.
 *
 * The signing keypair is a NON-EXTRACTABLE WebCrypto ES256 key: the private key
 * never leaves the browser's key store (cannot be serialized, cannot be
 * exfiltrated by XSS), so a stolen access token is useless without this origin's
 * live key. A fresh proof is minted per REST call and per ticket mint — never
 * reused — each carrying a unique `jti` and the request's `htm`/`htu`.
 */

/** A bound DPoP session: the live keypair + its public JWK (for the proof header). */
export interface DpopKey {
  keyPair: CryptoKeyPair;
  publicJwk: JsonWebKey;
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a non-extractable ES256 keypair + export its public JWK. */
export async function generateDpopKey(): Promise<DpopKey> {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const full = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  // Only the public coordinates go on the wire (RFC 9449 §4.2 `jwk` header).
  const publicJwk: JsonWebKey = { kty: full.kty, crv: full.crv, x: full.x, y: full.y };
  return { keyPair, publicJwk };
}

/**
 * Create a fresh DPoP proof JWT binding an HTTP method (`htm`) + URL (`htu`).
 * `nonce` is included when the server supplied one via `DPoP-Nonce`. Each call
 * mints a unique `jti` + `iat`, so proofs are never reused.
 */
export async function createDpopProof(
  key: DpopKey,
  htm: string,
  htu: string,
  nonce?: string,
): Promise<string> {
  const header = { typ: "dpop+jwt", alg: "ES256", jwk: key.publicJwk };
  const payload: Record<string, unknown> = {
    jti: base64Url(crypto.getRandomValues(new Uint8Array(16))),
    htm: htm.toUpperCase(),
    htu,
    iat: Math.floor(Date.now() / 1000),
    ...(nonce ? { nonce } : {}),
  };
  const signingInput = `${base64Url(new TextEncoder().encode(JSON.stringify(header)))}.${base64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  )}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key.keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(sig)}`;
}

/** True when a token-endpoint response carries a `cnf.jkt` (DPoP-bound). */
export function isDpopBound(tokenResponse: { cnf?: { jkt?: string } } | Record<string, unknown>): boolean {
  const cnf = (tokenResponse as { cnf?: { jkt?: unknown } }).cnf;
  return typeof cnf?.jkt === "string" && cnf.jkt.length > 0;
}
