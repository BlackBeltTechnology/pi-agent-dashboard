/**
 * Pure config-mutation helpers for the Gateway UI.
 *
 * Two writes ride the existing auth-gated `PUT /api/config` — NO bespoke route:
 *   - **Add HTTPS URL** (task 6.4) → append to `pairing.publicBaseUrls`. The
 *     `pairing` object is NOT in `writeConfigPartial`'s deep-merge allow-list,
 *     so a top-level `pairing` write is a SHALLOW overwrite: the caller must
 *     read the current `pairing`, append, and PUT the FULL object back. These
 *     helpers preserve every sibling field to honour that.
 *   - **Trust / Remove** (task 7.2) → mutate `config.trustedNetworks`.
 *
 * The `https`/`wss` gate here is client-side UX only; the authoritative filter
 * stays server-side at read time in `reachableUrls()` (D4/D14).
 *
 * See change: add-tunnel-providers.
 */

const SECURE_SCHEME = /^(https|wss):\/\/[^\s]+$/i;

/** Client-side UX validation: only `https`/`wss` base URLs are accepted. */
export function isSecureBaseUrl(url: string): boolean {
  return SECURE_SCHEME.test(url.trim());
}

/** A shallow `pairing` config object (only `publicBaseUrls` is typed here). */
export interface PairingConfigShape {
  publicBaseUrls?: string[];
  [k: string]: unknown;
}

/**
 * Append a secure base URL to `pairing.publicBaseUrls`, preserving every
 * sibling field (shallow-overwrite hazard). Dedupes; throws on non-secure.
 */
export function appendPublicBaseUrl(
  pairing: PairingConfigShape | undefined,
  rawUrl: string,
): PairingConfigShape {
  const url = rawUrl.trim();
  if (!isSecureBaseUrl(url)) {
    throw new Error("only https:// or wss:// endpoints are accepted");
  }
  const current = pairing?.publicBaseUrls ?? [];
  const next = current.includes(url) ? current : [...current, url];
  return { ...(pairing ?? {}), publicBaseUrls: next };
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

/** A trust suggestion — the exact host (default) or a wider, riskier subnet. */
export interface TrustSuggestion {
  value: string;
  label: string;
  /** True = grants unauthenticated access to a whole subnet (explicitly riskier). */
  wide: boolean;
}

/**
 * Offer trust entries for a refused IP. The exact `/32` host is the default,
 * safest choice; a mesh/LAN subnet is offered as the wider, explicitly-riskier
 * option (blast radius stated at the confirm step — one entry bypasses auth for
 * every host it covers).
 */
export function suggestTrustEntries(ip: string): TrustSuggestion[] {
  const out: TrustSuggestion[] = [{ value: ip, label: "exact host", wide: false }];
  const octets = ip.split(".").map((o) => Number.parseInt(o, 10));
  if (octets.length === 4 && octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255)) {
    const [a, b] = octets;
    if (a === 100 && b >= 64 && b <= 127) {
      out.push({ value: "100.64.0.0/10", label: "tailnet CGNAT range", wide: true });
    } else if (a === 10) {
      out.push({ value: "10.0.0.0/8", label: "mesh /8 subnet", wide: true });
    } else if (a === 172 && b >= 16 && b <= 31) {
      out.push({ value: `172.${b}.0.0/16`, label: "private /16 subnet", wide: true });
    } else if (a === 192 && b === 168) {
      out.push({ value: `192.168.${octets[2]}.0/24`, label: "home LAN /24", wide: true });
    }
  }
  return out;
}
