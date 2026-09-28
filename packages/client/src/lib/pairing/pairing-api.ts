/**
 * Client-side fetch helpers for the operator pairing flow.
 *
 * Wires the two shipped-but-uncalled dashboard pairing endpoints:
 *   - `GET  /api/pair/payload`  — mint the `{ v, id, code, urls[] }` QR payload.
 *   - `POST /api/pair/approve`  — D12 typed compare-code approval.
 *   - `GET /api/pair/pending`, `POST /api/pair/approve-pending`,
 *     `POST /api/pair/deny` — the app-wide approval dialog
 *     (change: add-pairing-approval-dialog).
 *
 * Mirrors `paired-devices-api.ts`. See change: wire-nonzrok-pairing-view.
 */
import { getApiBase } from "../api/api-context.js";
import { fetchJson, fetchJsonResponse } from "../api/fetch-json.js";
import type { PairedDeviceView } from "./paired-devices-api.js";

/** QR / copy-string pairing payload minted by `GET /api/pair/payload`. */
export interface PairingPayload {
  /** Negotiated pairing protocol version. */
  v: number;
  /** Server fingerprint (`sha256:<base64url>`) — the pinned identity. */
  id: string;
  /** One-time pairing code (TTL ~60s). */
  code: string;
  /** Advertised secure endpoints (`wss://`/`https://`) the device may reach. */
  urls: string[];
}

export type PairPayloadResult =
  | { ok: true; payload: PairingPayload }
  | { ok: false; error: string };

/**
 * Mint a pairing payload. On `no_reachable_endpoint` the server returns HTTP
 * 200 with `{ success: false, error }`, so a missing secure road is surfaced
 * as `{ ok: false, error }` — not a thrown transport error.
 */
export async function getPairPayload(): Promise<PairPayloadResult> {
  const { json } = await fetchJsonResponse<{ success: boolean; data?: PairingPayload; error?: string }>(
    `${getApiBase()}/api/pair/payload`,
  );
  if (json.success && json.data) return { ok: true, payload: json.data };
  return { ok: false, error: json.error ?? "unknown" };
}

/**
 * Approve a pending device by typed confirm code (D12). `code` is the payload's
 * one-time code; `confirmCode` is the numeric code shown on the physical device.
 * Rejects with the server error (`expired`, `no_pending`, `mismatch`,
 * `locked_out`, …) on failure.
 */
export async function approvePairing(
  code: string,
  confirmCode: string,
  label?: string,
): Promise<PairedDeviceView> {
  const { json } = await fetchJsonResponse<{ success: boolean; data?: PairedDeviceView; error?: string }>(
    `${getApiBase()}/api/pair/approve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, confirmCode, label }),
    },
  );
  if (!json.success || !json.data) throw new Error(json.error ?? "approve failed");
  return json.data;
}

// ── App-wide approval dialog (change: add-pairing-approval-dialog) ────────
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
