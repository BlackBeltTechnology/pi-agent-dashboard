/**
 * Client-side pinning of the dashboard's Ed25519 server identity (D8).
 *
 * The server already publishes a stable fingerprint and signs a client nonce at
 * `POST /api/pair/challenge` (`auth/identity.ts`, `routes/pairing-routes.ts`).
 * What was missing is the other half: a bridge that PINS that fingerprint at
 * pairing time and refuses, before registering, any endpoint that cannot prove
 * possession of the pinned key.
 *
 * That is what makes the hijack class unrepresentable rather than guarded — an
 * address is not an identity, so a stale or hostile server reachable at the
 * expected URL still cannot answer the challenge.
 *
 * Pure decision + thin probe, split so the decision table is enumerable in a
 * test without any I/O.
 *
 * See change: add-pi-gateway-transport-identity (D8, tasks 7.1–7.5).
 */
import crypto from "node:crypto";

/** What a bridge stores at pairing time — the identity, never an address. */
export interface ServerPin {
  /** `sha256:<base64url>` over the SPKI DER public key. */
  fingerprint: string;
  /** SPKI DER public key, base64url. */
  publicKeyB64: string;
}

/** The `/api/pair/challenge` answer. */
export interface ChallengeResponse {
  fingerprint: string;
  publicKey: string;
  signature: string;
}

/** Distinct causes, so a refusal is loggable and triageable (task 7.3). */
export type PinVerdictCause =
  | "verified"
  | "not-pinned"
  | "fingerprint-mismatch"
  | "signature-invalid"
  | "unreachable";

export interface PinVerdict {
  accept: boolean;
  cause: PinVerdictCause;
  reason: string;
}

/** Derive `sha256:<base64url>` from base64url SPKI DER; `null` if unparseable. */
export function fingerprintFromPublicKeyB64(publicKeyB64: string): string | null {
  try {
    const der = Buffer.from(publicKeyB64, "base64url");
    // Reject anything that is not actually a public key before hashing it.
    crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    return `sha256:${crypto.createHash("sha256").update(der).digest("base64url")}`;
  } catch {
    return null;
  }
}

/**
 * Verify a nonce signature against base64url SPKI DER key material.
 *
 * Mirrors the server's own `verifyNonceSignature`; lives here because the
 * verifying side is the CLIENT, which must not import the server package.
 */
export function verifyNonceSignature(
  publicKeyB64: string,
  nonce: string,
  signatureB64: string,
): boolean {
  try {
    const der = Buffer.from(publicKeyB64, "base64url");
    const publicKey = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    return crypto.verify(
      null,
      Buffer.from(nonce, "utf-8"),
      publicKey,
      Buffer.from(signatureB64, "base64url"),
    );
  } catch {
    return false;
  }
}

export interface PinDecisionInput {
  pin: ServerPin | undefined;
  nonce: string;
  response: ChallengeResponse;
}

/**
 * Decide whether the server that answered is the pinned one.
 *
 * Order matters: the fingerprint is recomputed from the PRESENTED key rather
 * than read from the response body, so an impostor cannot claim the pinned
 * fingerprint while signing with its own key. Only then is possession checked.
 *
 * Fail-closed with no pin: this runs on the remote path, where "trust whatever
 * answered" is the very failure D8 removes.
 */
export function decidePinnedIdentity({ pin, nonce, response }: PinDecisionInput): PinVerdict {
  if (!pin) {
    return {
      accept: false,
      cause: "not-pinned",
      reason: "refused: no pinned server identity — pair before registering",
    };
  }
  const presented = fingerprintFromPublicKeyB64(response.publicKey);
  if (presented !== pin.fingerprint) {
    return {
      accept: false,
      cause: "fingerprint-mismatch",
      reason: `refused: pinned ${pin.fingerprint}, endpoint presented ${presented ?? "unparseable key material"}`,
    };
  }
  if (!verifyNonceSignature(response.publicKey, nonce, response.signature)) {
    return {
      accept: false,
      cause: "signature-invalid",
      reason: `refused: ${pin.fingerprint} answered but could not prove possession of the private key`,
    };
  }
  return { accept: true, cause: "verified", reason: `verified: server identity ${pin.fingerprint}` };
}

export interface ChallengeInput {
  /** Origin of the dashboard, e.g. `https://host:8000`. */
  baseUrl: string;
  pin: ServerPin | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Challenge the server at `baseUrl` and apply {@link decidePinnedIdentity}. */
export async function challengePinnedServer(input: ChallengeInput): Promise<PinVerdict> {
  const doFetch = input.fetchImpl ?? fetch;
  // Fresh per challenge — a captured signature must not replay.
  const nonce = crypto.randomBytes(24).toString("base64url");
  let response: ChallengeResponse;
  try {
    const res = await doFetch(`${input.baseUrl.replace(/\/+$/, "")}/api/pair/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 5000),
    });
    if (!res.ok) {
      return {
        accept: false,
        cause: "unreachable",
        reason: `refused: ${input.baseUrl} answered ${res.status} to the identity challenge`,
      };
    }
    const body = (await res.json()) as { data?: Partial<ChallengeResponse> };
    const data = body?.data;
    if (
      typeof data?.fingerprint !== "string" ||
      typeof data?.publicKey !== "string" ||
      typeof data?.signature !== "string"
    ) {
      return {
        accept: false,
        cause: "unreachable",
        reason: `refused: ${input.baseUrl} returned no usable identity challenge answer`,
      };
    }
    response = { fingerprint: data.fingerprint, publicKey: data.publicKey, signature: data.signature };
  } catch {
    return {
      accept: false,
      cause: "unreachable",
      reason: `refused: ${input.baseUrl} did not answer the identity challenge`,
    };
  }
  return decidePinnedIdentity({ pin: input.pin, nonce, response });
}
