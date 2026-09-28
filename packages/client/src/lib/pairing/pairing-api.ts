/**
 * Client-side fetch helpers for the operator pairing flow.
 *
 * Wires the two shipped-but-uncalled dashboard pairing endpoints:
 *   - `GET  /api/pair/payload`  — mint the `{ v, id, code, urls[] }` QR payload.
 *   - `POST /api/pair/approve`  — D12 typed compare-code approval.
 *
 * Mirrors `paired-devices-api.ts`. See change: wire-nonzrok-pairing-view.
 */
import { getApiBase } from "../api/api-context.js";
import { fetchJsonResponse } from "../api/fetch-json.js";
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
