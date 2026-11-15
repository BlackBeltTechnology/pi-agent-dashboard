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

/** Key + signing operations behind the companion fragment; injectable so tests need no WebCrypto. */
export interface CompanionDeps {
  supported(): Promise<boolean>;
  ensureKey(fingerprint: string): Promise<string>;
  signCompanion(fingerprint: string, origin: string): Promise<CompanionClaim | null>;
}

const defaultCompanionDeps: CompanionDeps = { supported: detectDeviceKeySupport, ensureKey, signCompanion };

/**
 * The address a browser's "Request access…" opens: `base` (the round-tripped
 * `http://<host>:<port>/pair?request`) plus `#companion=<pub>.<ts>.<sig>&from=<own origin>` only when
 * the entry holds a pinned or advertised fingerprint, this browser can do Ed25519, and the fragment
 * fits 512 chars. Anything else — or any failure — yields `base` unchanged. Local work only: the key
 * lives in IndexedDB and nothing is sent anywhere before the navigation.
 *
 * See change: device-key-mutual-check (D5, D11, task 5.9, test-plan F3).
 */
export async function requestAccessHref(
  base: string,
  fingerprint: string | undefined,
  ownOrigin: string,
  deps: CompanionDeps = defaultCompanionDeps,
): Promise<string> {
  if (!fingerprint) return base;
  try {
    if (!(await deps.supported())) return base;
    await deps.ensureKey(fingerprint);
    const claim = await deps.signCompanion(fingerprint, ownOrigin);
    if (!claim) return base;
    const fragment = encodeCompanionFragment(claim);
    return fragment.length > COMPANION_FRAGMENT_MAX ? base : `${base}#${fragment}`;
  } catch {
    return base;
  }
}

/**
 * The pair-action rule (D8) and the request-page URL guard (the round-trip rule the
 * Settings "Connect" button always applied) live in shared, pure; re-exported here
 * so the client has one place that names where "Request access" leads.
 * See change: group-servers-by-identity (D8, test-plan #E7, #E8).
 */
import { COMPANION_FRAGMENT_MAX, type CompanionClaim, encodeCompanionFragment } from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { detectDeviceKeySupport, ensureKey, signCompanion } from "./device-key.js";

export type { PairAction, PairActionInput } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
export { buildRequestPageUrl, pairAction } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
