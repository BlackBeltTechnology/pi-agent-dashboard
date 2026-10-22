/**
 * Where "Request access" leads for a given server: the server's own request page
 * (`/pair?request`). One rule shared by the network-denied banner and the Vault
 * callout row. No normalisation of `apiBase`: it is compared to the page origin
 * verbatim, exactly as the banner always did.
 *
 * - empty base or `apiBase === origin` → this page's own server: relative `href`,
 *   same browsing context.
 * - any other base → that server's absolute `href`, a new context (no opener).
 *
 * See change: add-lan-knock-pairing (D10), add-request-access-remedy (D7).
 */
export function requestAccessTarget(apiBase: string, origin: string): { href: string; newContext: boolean } {
  if (apiBase && apiBase !== origin) return { href: `${apiBase}/pair?request`, newContext: true };
  return { href: "/pair?request", newContext: false };
}

/**
 * The pair-action rule (D8) and the request-page URL guard (the round-trip rule the
 * Settings "Connect" button always applied) live in shared, pure; re-exported here
 * so the client has one place that names where "Request access" leads.
 * See change: group-servers-by-identity (D8, test-plan #E7, #E8).
 */
export type { PairAction, PairActionInput } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
export { buildRequestPageUrl, pairAction } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
