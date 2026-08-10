/**
 * Gateway "Accessible at" endpoints + QR transport split (D1 corrected, D4).
 *
 * Two QR kinds, split by transport:
 *   - **Pairing QR** — the secure `{ v, id, code, urls[] }` payload. `urls[]`
 *     carries TLS endpoints ONLY (`https`/`wss`). D14 stays intact.
 *   - **Link QR** — for no-TLS `http` mesh/LAN endpoints, encodes the bare URL
 *     string only (no pairing payload, no crypto, no bearer over the wire).
 *
 * The scheme is authoritative here, NOT the advisory `tls` tag — a drifted
 * `tls:true` on an `http://` url is still excluded from pairing. The server's
 * `reachableUrls()` gate is the ultimate authority; this is the client mirror
 * so the UI can render the two QR kinds and label endpoints correctly.
 *
 * See change: add-tunnel-providers.
 */

import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { getApiBase } from "../api/api-context.js";
import { fetchJsonResponse } from "../api/fetch-json.js";

// Requires a non-empty authority after the scheme, matching `SECURE_SCHEME` in
// gateway-config-ops.ts so a bare `https://` (no host) is never pairing-eligible.
const TLS_SCHEME = /^(https|wss):\/\/[^\s]+$/i;

/** A TLS (`https`/`wss`) endpoint is eligible for the secure pairing payload. */
export function isPairingEligible(ep: TunnelEndpoint): boolean {
  return TLS_SCHEME.test(ep.url.trim());
}

/**
 * Partition endpoints by transport: TLS endpoints ride the pairing QR; every
 * no-TLS endpoint is link-QR only.
 */
export function splitEndpoints(endpoints: TunnelEndpoint[]): {
  pairing: TunnelEndpoint[];
  link: TunnelEndpoint[];
} {
  const pairing: TunnelEndpoint[] = [];
  const link: TunnelEndpoint[] = [];
  for (const ep of endpoints) {
    (isPairingEligible(ep) ? pairing : link).push(ep);
  }
  return { pairing, link };
}

/**
 * Guard (task 8.3): refuse to place any non-TLS URL into the pairing payload.
 * Returns the list unchanged when every entry is `https`/`wss`; throws
 * otherwise. Defence-in-depth on top of the server-side read-time gate.
 */
export function guardPairingUrls(urls: string[]): string[] {
  const bad = urls.filter((u) => !TLS_SCHEME.test(u.trim()));
  if (bad.length > 0) {
    throw new Error(`refusing non-TLS url(s) in pairing payload: ${bad.join(", ")}`);
  }
  return urls;
}

/** One tagged endpoint from `GET /api/tunnel/endpoints`. */
export type GatewayEndpoint = TunnelEndpoint;

/** Fetch every address the dashboard answers on (auth-gated). */
export async function getGatewayEndpoints(): Promise<GatewayEndpoint[]> {
  const { json } = await fetchJsonResponse<{
    success: boolean;
    data?: { endpoints: GatewayEndpoint[] };
    error?: string;
  }>(`${getApiBase()}/api/tunnel/endpoints`);
  if (json.success && json.data) return json.data.endpoints;
  return [];
}
