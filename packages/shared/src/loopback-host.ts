/**
 * One loopback predicate for the live trust query, shared by the bridge
 * (`isRemoteBridge`: is the dashboard endpoint remote?) and the server
 * (admission: is the peer genuinely local?) so the two sides never disagree.
 * Loopback = `localhost`, `127.0.0.0/8`, `::1`, and IPv4-mapped `::ffff:127.x`
 * (optionally bracketed).
 *
 * See change: mirror-dashboard-trust-live-remote (D1, test-plan #E25).
 */
import { isLoopbackLiteral } from "./local-credential-proof.js";

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === "localhost" || h === "[localhost]") return true;
  return isLoopbackLiteral(h);
}

/** A WHATWG URL's host (ws/wss/http/https) is loopback; an unparseable value is not. */
export function isLoopbackEndpoint(endpoint: string): boolean {
  if (endpoint.startsWith("ws+unix:")) return true;
  try {
    return isLoopbackHost(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}
