/**
 * `network_not_allowed` denial signal shared by the server's generic 403 body and
 * the additive `GET /api/health` `networkAccess` field.
 *
 * Own dependency-free module (not `rest-api.ts`) because the browser client value-imports it.
 *
 * See change: surface-network-denial-on-health (D4).
 */
export const NETWORK_NOT_ALLOWED = "network_not_allowed" as const;
export const GENERIC_NETWORK_DENIED_HINT = "Pair this device (Request access) or sign in.";

/** The additive `/api/health` field: present iff the caller's own request would be refused by the network guard. */
export interface HealthNetworkAccessField {
  networkAccess?: { error: typeof NETWORK_NOT_ALLOWED; hint: string };
}
