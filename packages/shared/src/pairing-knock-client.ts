/**
 * Native LAN-knock client: prove the identity at an address, knock, wait for the
 * operator, return the bearer. Shared by the browser client (WebCrypto prover)
 * and Electron main (`proveServerIdentity`).
 *
 *   prove (proven fingerprint must equal the expected one; mismatch ⇒ NO knock)
 *     → POST /api/pair/request {name}
 *     → response `fingerprint` must equal the proven one (else the bearer is never fetched)
 *     → poll /api/pair/poll until approved / rejected / expired
 *
 * The flow is split so a caller can pause between prove and knock
 * ({@link sendKnock} — Electron's "Send request" confirmation); {@link knockServer}
 * composes both for callers that do not pause.
 *
 * Result union ({@link KnockOutcome}); expected outcomes are values, not exceptions.
 * Transport failures during knock (unreachable server) THROW.
 *
 * Over plain http the check defeats an impostor answering at the address, NOT an
 * on-path relay that forwards the challenge to the genuine server.
 *
 * See change: add-lan-knock-pairing (D11); add-electron-server-windows (D2).
 */

import { truncateUtf8 } from "./display-name.js";
import { isKnockRefusal, type KnockRefusal } from "./pairing-knock.js";

export type KnockRefusalReason = KnockRefusal | "untrusted origin" | "unsupported_media_type" | "unknown";

export type KnockOutcome =
  | { status: "approved"; token: string; fingerprint: string }
  | { status: "identity_mismatch"; expected: string; proven: string | null; stage: "challenge" | "response" }
  | { status: "refused"; reason: KnockRefusalReason; retryAfter?: number; httpStatus: number }
  | { status: "rejected" }
  | { status: "expired" }
  | { status: "cancelled" };

export interface KnockWaiting {
  pendingId: string;
  /** 8-digit code the operator types on the server; show it to the user. */
  confirmCode: string;
  /** Epoch ms after which the knock lapses. */
  expiresAt: number;
}

export interface KnockHooks {
  /** Called once the server admitted the knock and is waiting for the operator. */
  onWaiting?: (info: KnockWaiting) => void;
  /** Abort polling (resolves `cancelled`). */
  signal?: AbortSignal;
  /** Clock injection (default `Date.now`). */
  now?: () => number;
  /** Delay injection (default `setTimeout`). */
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  /** Fetch redirect mode. Browsers leave it unset; Electron main passes `"manual"` (never follow off-origin). */
  redirect?: RequestRedirect;
}

/** Identity proof: `{proven: fingerprint}` or `{refused: reason}`. May throw on transport failure. */
export type ProveFn = (baseUrl: string) => Promise<{ proven: string; publicKey?: string } | { refused: string; identityFailure?: true }>;

const DEFAULT_POLL_MS = 2000;
const REQUEST_TIMEOUT_MS = 10_000;
/** A knock/poll answer is a small JSON envelope; anything larger is hostile or broken. */
const MAX_RESPONSE_BYTES = 8192;
/** The server's own lifetime is minutes; a peer cannot keep a poll loop alive longer than this. */
const MAX_KNOCK_LIFETIME_MS = 30 * 60_000;
const MAX_TOKEN_CHARS = 4096;
/** Device names are capped at 64 UTF-8 bytes (mirrors the server). */
const DEVICE_NAME_MAX_BYTES = 64;

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
  retryAfter?: number;
}

async function post<T>(
  base: string,
  path: string,
  body: unknown,
  redirect?: RequestRedirect,
): Promise<{ status: number; json: Envelope<T> }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(base.replace(/\/+$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
      ...(redirect ? { redirect } : {}),
    });
    return { status: res.status, json: (await readJsonCapped(res)) as Envelope<T> };
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a JSON body up to {@link MAX_RESPONSE_BYTES}; oversize or malformed ⇒ `{}` (a refusal, never a crash). */
async function readJsonCapped(res: Response): Promise<unknown> {
  try {
    const reader = res.body?.getReader();
    if (!reader) return await res.json();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        return {};
      }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    return {};
  }
}

function refusal(status: number, json: Envelope<unknown>): KnockOutcome {
  const e = json.error;
  const reason: KnockRefusalReason =
    isKnockRefusal(e) || e === "untrusted origin" || e === "unsupported_media_type" ? e : "unknown";
  return {
    status: "refused",
    reason,
    ...(typeof json.retryAfter === "number" ? { retryAfter: json.retryAfter } : {}),
    httpStatus: status,
  };
}

/** Request body for `POST /api/pair/request`: empty/whitespace name ⇒ `{}`; otherwise ≤ 64 UTF-8 bytes. */
export function knockRequestBody(name: string): { name?: string } {
  const trimmed = truncateUtf8(name.trim(), DEVICE_NAME_MAX_BYTES).trim();
  return trimmed ? { name: trimmed } : {};
}

/** Prove the identity at `baseUrl` and compare it with `expectedFingerprint`. Null ⇒ proven and equal. */
export async function proveExpected(
  baseUrl: string,
  expectedFingerprint: string,
  prove: ProveFn,
): Promise<{ fingerprint: string; publicKey?: string } | Extract<KnockOutcome, { status: "identity_mismatch" }>> {
  const proof = await prove(baseUrl);
  if ("refused" in proof || proof.proven !== expectedFingerprint) {
    return {
      status: "identity_mismatch",
      expected: expectedFingerprint,
      proven: "proven" in proof ? proof.proven : null,
      stage: "challenge",
    };
  }
  return { fingerprint: proof.proven, ...(proof.publicKey ? { publicKey: proof.publicKey } : {}) };
}

/**
 * Knock step only: `provenFingerprint` has already been proven at `baseUrl`.
 * POST the request, check the response fingerprint, then poll.
 */
export async function sendKnock(
  baseUrl: string,
  provenFingerprint: string,
  name: string,
  hooks: KnockHooks = {},
): Promise<KnockOutcome> {
  const knock = await post<{ pendingId: string; confirmCode: string; expiresAt: number; fingerprint: string }>(
    baseUrl,
    "/api/pair/request",
    knockRequestBody(name),
    hooks.redirect,
  );
  const data = knock.json.data;
  if (!knock.json.success || !data) return refusal(knock.status, knock.json);
  // A malformed admission is a refusal: the code is shown to the user and the expiry bounds the poll loop.
  if (!/^\d{8}$/.test(String(data.confirmCode)) || typeof data.pendingId !== "string" || !Number.isFinite(data.expiresAt)) {
    return refusal(knock.status, {});
  }
  const expiresAt = Math.min(data.expiresAt, (hooks.now ?? Date.now)() + MAX_KNOCK_LIFETIME_MS);

  // The knock answer must come from the identity we proved — otherwise the bearer is never fetched.
  if (data.fingerprint !== provenFingerprint) {
    return { status: "identity_mismatch", expected: provenFingerprint, proven: data.fingerprint ?? null, stage: "response" };
  }
  hooks.onWaiting?.({ pendingId: data.pendingId, confirmCode: data.confirmCode, expiresAt });

  return pollForOutcome(baseUrl, data.pendingId, expiresAt, provenFingerprint, hooks);
}

/** Prove-then-knock for callers that do not pause between the two steps. */
export async function knockServerWith(
  prove: ProveFn,
  baseUrl: string,
  expectedFingerprint: string,
  name: string,
  hooks: KnockHooks = {},
): Promise<KnockOutcome> {
  // CHALLENGE — never knock an address that cannot prove the expected identity.
  const proof = await proveExpected(baseUrl, expectedFingerprint, prove);
  if ("status" in proof) return proof;
  return sendKnock(baseUrl, proof.fingerprint, name, hooks);
}

type PollEnvelope = Awaited<ReturnType<typeof post<{ status: string; token?: string }>>>;

/** One poll request; a transport failure is returned, not thrown, so the loop can decide. */
async function tryPoll(
  baseUrl: string,
  pendingId: string,
  redirect?: RequestRedirect,
): Promise<{ ok: true; poll: PollEnvelope } | { ok: false; error: unknown }> {
  try {
    return { ok: true, poll: await post<{ status: string; token?: string }>(baseUrl, "/api/pair/poll", { pendingId }, redirect) };
  } catch (error) {
    return { ok: false, error };
  }
}

/** A terminal outcome for one poll answer, or null while the request is still pending and unexpired. */
function classifyPoll(poll: PollEnvelope, fingerprint: string, elapsed: boolean): KnockOutcome | null {
  const p = poll.json.data;
  if (p?.status === "approved" && typeof p.token === "string" && p.token.length > 0 && p.token.length <= MAX_TOKEN_CHARS) return { status: "approved", token: p.token, fingerprint };
  if (p?.status === "rejected") return { status: "rejected" };
  return !poll.json.success || p?.status !== "pending" || elapsed ? { status: "expired" } : null;
}

/** Poll `/api/pair/poll`: only `pending` keeps waiting; any other status is terminal. */
async function pollForOutcome(
  baseUrl: string,
  pendingId: string,
  expiresAt: number,
  fingerprint: string,
  hooks: KnockHooks,
): Promise<KnockOutcome> {
  const now = hooks.now ?? Date.now;
  const sleep = hooks.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const interval = hooks.pollIntervalMs ?? DEFAULT_POLL_MS;
  while (!hooks.signal?.aborted) {
    const attempt = await tryPoll(baseUrl, pendingId, hooks.redirect);
    if (hooks.signal?.aborted) break;
    if (!attempt.ok) {
      // A transient transport blip mid-wait is not an outcome: keep waiting until the request expires.
      if (now() >= expiresAt) throw attempt.error;
      await sleep(interval);
      continue;
    }
    const outcome = classifyPoll(attempt.poll, fingerprint, now() >= expiresAt);
    if (outcome) return outcome;
    await sleep(interval);
  }
  return { status: "cancelled" };
}
