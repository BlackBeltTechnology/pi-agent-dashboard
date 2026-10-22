/**
 * Browser "Pair with code…": the LOCAL half of the dialog, pure and network-free.
 *
 * Pasted text → payload (`decodePayloadString`) → refuse unless the payload's `id` is the card's
 * fingerprint → pick the first `https` origin the payload names that passes the delivered-route
 * origin validation (https, origin only, DNS name that is not an IP literal / `localhost` / `.local`)
 * → the URL `<origin>/pair#<payload>` the caller opens in a new context (noopener). Nothing is
 * fetched here: the `/pair` landing on that origin proves the payload's fingerprint before it
 * redeems anything, and the code rides the URL fragment, which no server receives.
 *
 * See change: group-servers-by-identity (D8, test-plan #F8).
 */
import { validateDeliveredRoutes } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { decodePayloadString, encodePairingQrUrl } from "./pairing-qr.js";

export type PairWithCodeRefusal =
  /** Not a pairing payload at all. */
  | "malformed"
  /** A payload for another server than the card's. */
  | "wrong-server"
  /** No `https` origin of the payload passes the delivered-route validation. */
  | "no-https-origin";

export type PairWithCodeTarget = { ok: true; url: string; origin: string } | { ok: false; reason: PairWithCodeRefusal };

export function resolvePairWithCode(text: string, fingerprint: string): PairWithCodeTarget {
  let payload: ReturnType<typeof decodePayloadString>;
  try {
    payload = decodePayloadString(text);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (payload.id !== fingerprint) return { ok: false, reason: "wrong-server" };
  const [origin] = validateDeliveredRoutes(payload.urls);
  if (!origin) return { ok: false, reason: "no-https-origin" };
  return { ok: true, origin, url: encodePairingQrUrl(payload, origin) };
}
