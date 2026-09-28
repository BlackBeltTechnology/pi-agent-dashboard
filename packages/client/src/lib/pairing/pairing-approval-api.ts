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
import type { PairedDeviceView } from "./paired-devices-api.js";

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
}

/** List pending devices. Throws on transport / non-2xx (caller shows nothing). */
export async function listPending(): Promise<PendingPairing[]> {
  const json = await fetchJson<{ success: boolean; data?: PendingPairing[] }>(`${getApiBase()}/api/pair/pending`);
  return json.success && Array.isArray(json.data) ? json.data : [];
}

export type ApprovePendingOutcome =
  | { ok: true; device: PairedDeviceView }
  | { ok: false; error: "mismatch"; attemptsLeft: number }
  | { ok: false; error: string };

/**
 * Approve by pendingId with the typed confirm code. Server outcomes resolve;
 * a transport failure (fetch rejects / non-JSON) throws.
 */
export async function approvePending(
  pendingId: string,
  confirmCode: string,
  label?: string,
): Promise<ApprovePendingOutcome> {
  const { json } = await fetchJsonResponse<{
    success: boolean;
    data?: PairedDeviceView;
    error?: string;
    attemptsLeft?: number;
  }>(`${getApiBase()}/api/pair/approve-pending`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pendingId, confirmCode, ...(label === undefined ? {} : { label }) }),
  });
  if (json.success && json.data) return { ok: true, device: json.data };
  if (json.error === "mismatch" && typeof json.attemptsLeft === "number") {
    return { ok: false, error: "mismatch", attemptsLeft: json.attemptsLeft };
  }
  return { ok: false, error: json.error ?? "unknown" };
}

/** Deny a pending device. `no_pending` resolves `ok:false`; transport throws. */
export async function denyPending(pendingId: string): Promise<{ ok: boolean; error?: string }> {
  const { json } = await fetchJsonResponse<{ success: boolean; error?: string }>(`${getApiBase()}/api/pair/deny`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pendingId }),
  });
  return json.success ? { ok: true } : { ok: false, error: json.error ?? "unknown" };
}
