/**
 * Pure config-mutation helpers for the Gateway UI.
 *
 * Two writes ride the existing auth-gated `PUT /api/config` — NO bespoke route:
 *   - **Add HTTPS URL** (task 6.4) → append to the top-level `publicBaseUrls`
 *     list. The legacy nested `pairing.publicBaseUrls` is read as a fallback
 *     and SEEDED into the first top-level write, so an operator's existing
 *     entries do not vanish from the QR the moment the top-level key appears
 *     (D7/D12).
 *   - **Trust / Remove** (task 7.2) → mutate `config.trustedNetworks`.
 *
 * `appendPublicBaseUrl` is the single writer for that list (D12 task 10.7):
 * the gateway action opts out of the `https`/`wss` gate for an `http://`
 * gateway, so the two callers cannot drift apart. The gate is client-side UX
 * only either way; the authoritative pairing-payload filter stays server-side
 * at read time in `reachableUrls()` (D4/D8/D14).
 *
 * See changes: add-tunnel-providers, config-override-oauth-redirect-base.
 */

import {
  type TrustSuggestion,
  wellKnownContainingRange,
} from "@blackbelt-technology/pi-dashboard-shared/bind-reachability.js";

const SECURE_SCHEME = /^(https|wss):\/\/[^\s]+$/i;

/** Client-side UX validation: only `https`/`wss` base URLs are accepted. */
export function isSecureBaseUrl(url: string): boolean {
  return SECURE_SCHEME.test(url.trim());
}

/** A shallow `pairing` config object (only `publicBaseUrls` is typed here). */
interface PairingConfigShape {
  publicBaseUrls?: string[];
  [k: string]: unknown;
}

/** The slice of `GET /api/config` this module reads the URL list from. */
export interface PublicBaseUrlsConfigShape {
  publicBaseUrls?: string[];
  pairing?: PairingConfigShape;
}

/**
 * Top-level `publicBaseUrls` when present, else the legacy
 * `pairing.publicBaseUrls`. Mirrors the server-side resolver so the UI shows
 * what the server reads.
 */
export function resolvePublicBaseUrls(config: PublicBaseUrlsConfigShape | undefined): string[] {
  return config?.publicBaseUrls ?? config?.pairing?.publicBaseUrls ?? [];
}

/**
 * Append a base URL to the top-level `publicBaseUrls`, seeding from the legacy
 * nested key on the first top-level write. Dedupes. Throws on a non-secure URL
 * unless `allowInsecure` is set (the `http://` gateway path, D12).
 *
 * Returns only the top-level key — `publicBaseUrls` is a plain array, so
 * `writeConfigPartial` overwrites it wholesale and no sibling is at risk.
 */
export function appendPublicBaseUrl(
  config: PublicBaseUrlsConfigShape | undefined,
  rawUrl: string,
  opts: { allowInsecure?: boolean } = {},
): { publicBaseUrls: string[] } {
  const url = rawUrl.trim();
  if (!opts.allowInsecure && !isSecureBaseUrl(url)) {
    throw new Error("only https:// or wss:// endpoints are accepted");
  }
  const current = resolvePublicBaseUrls(config);
  return { publicBaseUrls: current.includes(url) ? current : [...current, url] };
}

/** Add an entry to `trustedNetworks`, deduped. */
export function addTrustedNetwork(list: string[] | undefined, entry: string): string[] {
  const current = list ?? [];
  return current.includes(entry) ? current : [...current, entry];
}

/** Remove an entry from `trustedNetworks`. */
export function removeTrustedNetwork(list: string[] | undefined, entry: string): string[] {
  return (list ?? []).filter((e) => e !== entry);
}

/**
 * Offer trust entries for a refused IP. The exact `/32` host is the default,
 * safest choice; a mesh/LAN subnet is offered as the wider, explicitly-riskier
 * option (blast radius stated at the confirm step — one entry bypasses auth for
 * every host it covers).
 *
 * The wide range comes from the SHARED well-known-range table, the same one the
 * `/api/network-interfaces` suggestions read, so the block-event path and the
 * interface path cannot give contradictory advice for one address (H4).
 * See change: warn-unreachable-trusted-networks.
 */
export function suggestTrustEntries(ip: string): TrustSuggestion[] {
  const out: TrustSuggestion[] = [{ value: ip, label: "exact host", wide: false }];
  const wide = wellKnownContainingRange(ip);
  if (wide) out.push({ ...wide, wide: true });
  return out;
}

export type { BindReachability, TrustSuggestion } from "@blackbelt-technology/pi-dashboard-shared/bind-reachability.js";
export {
  collectTrustedEntries,
  dedupeInterfaceOffers,
  isLoopbackOnlyEntry,
  isValidTrustEntry,
  pendingEffectiveHost,
  trustEntryCovers,
  unreachableTrustedEntries,
  wellKnownContainingRange,
} from "@blackbelt-technology/pi-dashboard-shared/bind-reachability.js";
