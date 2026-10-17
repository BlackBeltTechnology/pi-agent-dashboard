/**
 * Fetch helpers for the app-wide pairing approval dialog (change:
 * add-pairing-approval-dialog): `GET /api/pair/pending`,
 * `POST /api/pair/approve-pending`, `POST /api/pair/deny`.
 *
 * Kept apart from `pairing-api.ts` on purpose: that module is on the eager
 * entry (Gateway view), while these are used only by the lazily-loaded
 * approval host — a shared module would drag them into the entry chunk
 * (`mdi-chunk-size` gzip cap).
 */
import { getApiBase } from "../api/api-context.js";
import { fetchJson, fetchJsonResponse } from "../api/fetch-json.js";
import type { PairedDeviceView, Tier } from "./paired-devices-api.js";

// All three routes are operator-only on the server (`operatorGuard`); a
// paired-device browser gets 401/403 and never learns request details.

/** One pending device as listed by `GET /api/pair/pending` — never a code. */
export interface PendingPairing {
  pendingId: string;
  /** Untrusted redeemer User-Agent (≤256 chars) — render as text only. */
  userAgent?: string;
  /** Host header the device arrived through (untrusted). */
  viaHost?: string;
  /** Socket peer address. */
  remoteAddress?: string;
  /** First `X-Forwarded-For` hop — proxy-reported, untrusted. */
  forwardedFor?: string;
  createdAt: number;
  expiresAt: number;
  attemptsLeft: number;
  /** How the request arrived; absent ⇒ `qr` (older servers). See change: add-lan-knock-pairing. */
  provenance?: "qr" | "knock";
  /** Name the requester typed (knock only) — untrusted display text, never HTML. */
  requesterName?: string;
  /** Knock arrived over plain http (knock only). */
  unencrypted?: boolean;
}

/** List pending devices. Throws on transport / non-2xx (caller shows nothing). */
export async function listPending(): Promise<PendingPairing[]> {
  const json = await fetchJson<{ success: boolean; data?: PendingPairing[] }>(`${getApiBase()}/api/pair/pending`);
  return json.success && Array.isArray(json.data) ? json.data : [];
}

/**
 * What a credential refusal (401) tells the operator to do. Both are absent on
 * an older server's bare two-key body; `remedies` values are NOT validated here
 * (a newer server may add some) — the dialog ignores the ones it doesn't know.
 * See change: fix-pairing-approval-credential.
 */
export interface RefusalRemedies {
  reason?: string;
  remedies?: string[];
}

/** The 401 body's exact `error` string for a missing operator credential. */
const CREDENTIAL_REFUSAL_ERROR = "operator credential required";

/** True for the 401 errors of the approval guard (this change's body + the older auth gate's). */
export function isCredentialRefusalError(error: string): boolean {
  return error === CREDENTIAL_REFUSAL_ERROR || error === "Authentication required";
}

/** Read the optional `reason` / `remedies` off a refusal body; malformed → undefined. */
function refusalRemedies(json: { reason?: unknown; remedies?: unknown }): RefusalRemedies {
  const out: RefusalRemedies = {};
  if (typeof json.reason === "string") out.reason = json.reason;
  if (Array.isArray(json.remedies)) out.remedies = json.remedies.filter((r): r is string => typeof r === "string");
  return out;
}

export type ApprovePendingOutcome =
  | { ok: true; device: PairedDeviceView }
  | { ok: false; error: "mismatch"; attemptsLeft: number }
  | ({ ok: false; error: string } & RefusalRemedies);

/**
 * Approve by pendingId with the typed confirm code. Server outcomes resolve;
 * a transport failure (fetch rejects / non-JSON) throws.
 */
export async function approvePending(
  pendingId: string,
  confirmCode: string,
  label?: string,
  /** Omitted ⇒ not sent ⇒ the server defaults to operate. */
  tier?: Tier,
): Promise<ApprovePendingOutcome> {
  const { json } = await fetchJsonResponse<{
    success: boolean;
    data?: PairedDeviceView;
    error?: string;
    attemptsLeft?: number;
    reason?: unknown;
    remedies?: unknown;
  }>(`${getApiBase()}/api/pair/approve-pending`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pendingId,
      confirmCode,
      ...(label === undefined ? {} : { label }),
      ...(tier === undefined ? {} : { tier }),
    }),
  });
  if (json.success && json.data) return { ok: true, device: json.data };
  if (json.error === "mismatch" && typeof json.attemptsLeft === "number") {
    return { ok: false, error: "mismatch", attemptsLeft: json.attemptsLeft };
  }
  return { ok: false, error: json.error ?? "unknown", ...refusalRemedies(json) };
}

/** Deny a pending device. `no_pending` resolves `ok:false`; transport throws. */
export async function denyPending(pendingId: string): Promise<{ ok: boolean; error?: string } & RefusalRemedies> {
  const { json } = await fetchJsonResponse<{ success: boolean; error?: string; reason?: unknown; remedies?: unknown }>(
    `${getApiBase()}/api/pair/deny`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pendingId }),
    },
  );
  return json.success ? { ok: true } : { ok: false, error: json.error ?? "unknown", ...refusalRemedies(json) };
}
