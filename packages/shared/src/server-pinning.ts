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

/** Max challenge response body accepted by {@link proveServerIdentity}. */
const PROVE_MAX_BODY_BYTES = 4096;

/** `publicKey` (base64url SPKI) is the key whose possession was proven — callers may pin it. */
export type ProveResult =
  | { proven: string; publicKey?: string }
  /** `identityFailure`: the endpoint answered but its key material / signature is invalid (impostor signal, not a transport failure). */
  | { refused: string; identityFailure?: true };

/**
 * Prove which identity answers at `baseUrl`, without a prior pin.
 *
 * Fresh nonce → `POST /api/pair/challenge` (`redirect: "manual"`, 4 KiB body
 * cap, hard timeout) → fingerprint RECOMPUTED from the presented key →
 * signature verified. Callers compare the returned fingerprint with the one
 * they expect. `challengePinnedServer` is untouched (the remote-registration
 * gate relies on its behaviour).
 *
 * See change: stabilize-mdns-server-identity (D5).
 */
export async function proveServerIdentity(
  baseUrl: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ProveResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const nonce = crypto.randomBytes(24).toString("base64url");
  const timeoutMs = opts.timeoutMs ?? 2000;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await doFetch(`${trimTrailingSlashes(baseUrl)}/api/pair/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce }),
      redirect: "manual",
      signal,
    });
    if (res.status !== 200) return { refused: `challenge answered ${res.status}` };
    const text = await readCapped(res, PROVE_MAX_BODY_BYTES, signal);
    if (text === null) return { refused: "challenge response too large" };
    const data = (JSON.parse(text) as { data?: Partial<ChallengeResponse> })?.data;
    if (typeof data?.publicKey !== "string" || typeof data?.signature !== "string") {
      return { refused: "challenge response malformed" };
    }
    const fingerprint = fingerprintFromPublicKeyB64(data.publicKey);
    if (!fingerprint) return { refused: "unparseable key material", identityFailure: true };
    if (!verifyNonceSignature(data.publicKey, nonce, data.signature)) {
      return { refused: "signature invalid", identityFailure: true };
    }
    return { proven: fingerprint, publicKey: data.publicKey };
  } catch {
    return { refused: "challenge failed" };
  }
}

/** Trim trailing `/` by scanning (a `/\/+$/` regex is polynomial on long slash runs). */
function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end--;
  return url.slice(0, end);
}

/** Read a response body up to `max` bytes; `null` when it exceeds the cap. */
async function readCapped(res: Response, max: number, signal: AbortSignal): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    if (signal.aborted) throw new Error("aborted");
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * How a proven identity relates to the pin (the expected server) and to this
 * machine's own dashboard.
 *
 * - `ok`: the pinned server.
 * - `self`: this machine's own dashboard answered (wrong address, never an alarm).
 * - `foreign`: any other fingerprint, or an invalid signature (strict handling).
 * - `unverified`: a transport refusal (nothing proven), or a non-pin proof while `localFp` is still unresolved; treated
 *   like a transport failure until one local proof succeeds.
 *
 * `localFp`: the fingerprint proven against the local server (never read from an
 * advert); `"none"` = no local server (remote mode), so there is no self.
 *
 * See change: harden-peer-address-identity (D2).
 */
export type ProofClass = "ok" | "self" | "foreign" | "unverified";

export function classifyProof(
  proven: ProveResult,
  ctx: { pin: string; localFp: string | "none" | undefined },
): ProofClass {
  if ("proven" in proven && proven.proven === ctx.pin) return "ok";
  // An invalid key/signature is an impostor signal, never downgraded.
  if ("refused" in proven) return proven.identityFailure === true ? "foreign" : "unverified";
  if (ctx.localFp === undefined) return "unverified";
  if ("proven" in proven && ctx.localFp !== "none" && proven.proven === ctx.localFp) return "self";
  return "foreign";
}
