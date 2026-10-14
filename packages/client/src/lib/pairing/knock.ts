/**
 * knockServer — native-consumer LAN knock: pin the discovered identity, knock,
 * wait for the operator, return the bearer.
 *
 *   challenge (proven fingerprint must equal the advertised one; mismatch ⇒ NO knock)
 *     → POST /api/pair/request {name}
 *     → response `fingerprint` must equal the proven one (else the bearer is never fetched)
 *     → poll /api/pair/poll until approved / rejected / expired
 *
 * Result union (`KnockOutcome`); expected outcomes are values, not exceptions:
 *   approved           { token, fingerprint }
 *   identity_mismatch  { expected, proven: string|null, stage: "challenge"|"response" }
 *   refused            { reason: KnockRefusal | "untrusted origin" | "unsupported_media_type" | "unknown",
 *                        retryAfter?: seconds, httpStatus }
 *   rejected | expired | cancelled
 * Transport failures (unreachable server, malformed challenge) THROW.
 *
 * Over plain http the check defeats an impostor answering at the discovered
 * address, NOT an on-path relay that forwards the challenge to the genuine server.
 *
 * See change: add-lan-knock-pairing (D11, spec "Native knocking clients verify
 * the discovered identity first").
 */
import { isKnockRefusal, type KnockRefusal } from "@blackbelt-technology/pi-dashboard-shared/pairing-knock.js";
import { challengeIdentity } from "./pair-protocol.js";

type KnockRefusalReason = KnockRefusal | "untrusted origin" | "unsupported_media_type" | "unknown";

export type KnockOutcome =
  | { status: "approved"; token: string; fingerprint: string }
  | { status: "identity_mismatch"; expected: string; proven: string | null; stage: "challenge" | "response" }
  | { status: "refused"; reason: KnockRefusalReason; retryAfter?: number; httpStatus: number }
  | { status: "rejected" }
  | { status: "expired" }
  | { status: "cancelled" };

interface KnockWaiting {
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
}

const DEFAULT_POLL_MS = 2000;
const REQUEST_TIMEOUT_MS = 10_000;

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
  retryAfter?: number;
}

async function post<T>(base: string, path: string, body: unknown): Promise<{ status: number; json: Envelope<T> }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(base.replace(/\/+$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Envelope<T>;
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
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

export async function knockServer(
  baseUrl: string,
  expectedFingerprint: string,
  name: string,
  hooks: KnockHooks = {},
): Promise<KnockOutcome> {
  // 1. CHALLENGE — never knock an address that cannot prove the advertised identity.
  const proof = await challengeIdentity(baseUrl);
  if (!proof.verified || proof.fingerprint !== expectedFingerprint) {
    return {
      status: "identity_mismatch",
      expected: expectedFingerprint,
      proven: proof.verified ? proof.fingerprint : null,
      stage: "challenge",
    };
  }

  // 2. KNOCK
  const trimmed = name.trim();
  const knock = await post<{ pendingId: string; confirmCode: string; expiresAt: number; fingerprint: string }>(
    baseUrl,
    "/api/pair/request",
    trimmed ? { name: trimmed } : {},
  );
  const data = knock.json.data;
  if (!knock.json.success || !data) return refusal(knock.status, knock.json);

  // 3. The knock answer must come from the identity we proved — otherwise the
  // bearer is never fetched.
  if (data.fingerprint !== proof.fingerprint) {
    return { status: "identity_mismatch", expected: proof.fingerprint, proven: data.fingerprint ?? null, stage: "response" };
  }
  hooks.onWaiting?.({ pendingId: data.pendingId, confirmCode: data.confirmCode, expiresAt: data.expiresAt });

  return pollForOutcome(baseUrl, data.pendingId, data.expiresAt, proof.fingerprint, hooks);
}

type PollEnvelope = Awaited<ReturnType<typeof post<{ status: string; token?: string }>>>;

/** One poll request; a transport failure is returned, not thrown, so the loop can decide. */
async function tryPoll(
  baseUrl: string,
  pendingId: string,
): Promise<{ ok: true; poll: PollEnvelope } | { ok: false; error: unknown }> {
  try {
    return { ok: true, poll: await post<{ status: string; token?: string }>(baseUrl, "/api/pair/poll", { pendingId }) };
  } catch (error) {
    return { ok: false, error };
  }
}

/** A terminal outcome for one poll answer, or null while the request is still pending and unexpired. */
function classifyPoll(poll: PollEnvelope, fingerprint: string, elapsed: boolean): KnockOutcome | null {
  const p = poll.json.data;
  if (p?.status === "approved" && p.token) return { status: "approved", token: p.token, fingerprint };
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
    const attempt = await tryPoll(baseUrl, pendingId);
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
