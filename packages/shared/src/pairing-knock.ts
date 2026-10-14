/**
 * Shared vocabulary for LAN knock pairing (server route + client landing).
 *
 * - `KnockRefusal` — the distinct `error` codes `POST /api/pair/request` can
 *   answer with, so the requesting device can explain WHY it was refused.
 * - `PairingProvenance` — how a pending device entered the approval flow.
 *   Clients treat an absent provenance as `"qr"`.
 *
 * See change: add-lan-knock-pairing.
 */

export const KNOCK_REFUSALS = [
  "host_not_admitted",
  "knock_not_lan",
  "knock_disabled",
  "knock_rate_limited",
  "knock_pending",
  "knock_busy",
] as const;

export type KnockRefusal = (typeof KNOCK_REFUSALS)[number];

export type PairingProvenance = "qr" | "knock";

/** Type guard for a server-supplied refusal code. */
export function isKnockRefusal(v: unknown): v is KnockRefusal {
  return typeof v === "string" && (KNOCK_REFUSALS as readonly string[]).includes(v);
}
