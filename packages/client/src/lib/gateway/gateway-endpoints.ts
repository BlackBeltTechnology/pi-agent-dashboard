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
  // Loopback http mirrors the server's own test-only exception
  // (`isTestLoopbackOrigin`, server pairing.ts): a browser grants http://localhost
  // a genuine secure context, so crypto.subtle — the payload signature check —
  // still works on the device. NOTE: unlike the server gate this exemption is
  // NOT env-gated — the client cannot see PI_E2E_SEED — but it is safe
  // unconditionally: the server is the authority on payload urls[], prod never
  // emits loopback http, and localhost resolves only to the operator's own
  // machine. Every OTHER non-TLS entry stays fail-closed (spec:
  // qr-device-pairing → "TLS re-guard before encoding is fail-closed").
  const LOOPBACK_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
  const bad = urls.filter((u) => {
    const trimmed = u.trim();
    return !TLS_SCHEME.test(trimmed) && !LOOPBACK_HTTP.test(trimmed);
  });
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
