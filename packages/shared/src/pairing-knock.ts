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

/**
 * Refusal code → user-facing copy (i18n key + English fallback). Shared by the
 * browser `/pair?request` landing and the Electron connecting window so both
 * use identical wording. Unlisted codes use {@link KNOCK_REFUSAL_GENERIC}.
 *
 * See change: add-electron-server-windows (D2).
 */
export const KNOCK_REFUSAL_COPY: Record<string, { key: string; fallback: string }> = {
  knock_disabled: {
    key: "landing.request.err.knock_disabled",
    fallback:
      "This dashboard isn't accepting requests from the network. Its owner can turn on \"Accept requests from devices on this network\" in Gateway ▸ Connect a device. Then try again.",
  },
  knock_not_lan: {
    key: "landing.request.err.knock_not_lan",
    fallback:
      "Requests are only accepted from the same local network. Connect this device to the same network as the dashboard, or ask its owner for a pairing link (QR).",
  },
  knock_pending: {
    key: "landing.request.err.knock_pending",
    fallback:
      "A request from this device is already waiting. Approve it on the dashboard computer, or wait up to 5 minutes for it to expire and request again.",
  },
  knock_rate_limited: {
    key: "landing.request.err.knock_rate_limited",
    fallback: "Too many requests from this device. You can request again in {time}.",
  },
  knock_busy: {
    key: "landing.request.err.knock_busy",
    fallback: "Several devices are already waiting for approval. Try again in a minute.",
  },
};

export const KNOCK_REFUSAL_GENERIC = { key: "landing.request.err.generic", fallback: "This dashboard refused the request." };

/** Copy for a refusal reason (unknown reasons → generic). */
export function knockRefusalCopy(reason: string | undefined): { key: string; fallback: string } {
  return (reason && KNOCK_REFUSAL_COPY[reason]) || KNOCK_REFUSAL_GENERIC;
}

/** Refusal codes where retrying cannot help. */
export const KNOCK_NO_RETRY: ReadonlySet<string> = new Set(["knock_not_lan", "knock_pending"]);
