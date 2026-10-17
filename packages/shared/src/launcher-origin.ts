/**
 * The one rule deciding whether an origin is one `pi-dashboard open` may mint a
 * local-proof code for: a loopback host on the CONFIGURED server port. Shared by
 * the server's `authorize-browser` remedy builder and `cmdOpen --url`, so the
 * offer and the acceptance cannot drift.
 * See change: fix-pairing-approval-credential (D7).
 */

const IPV4_LOOPBACK = /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** `localhost`, `127.0.0.0/8` or `[::1]` (case-insensitive; brackets optional). */
function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "[::1]" || h === "::1" || IPV4_LOOPBACK.test(h);
}

/**
 * @param hostname URL hostname (IPv6 literals bracketed or not)
 * @param port explicit-or-default port of the origin; empty/undefined means 80
 * @param configPort the server's configured port
 */
export function isLauncherOrigin(hostname: string, port: string | number | undefined, configPort: number): boolean {
  if (!isLoopbackHostname(hostname)) return false;
  const effective = port === undefined || port === "" ? 80 : Number(port);
  return Number.isInteger(effective) && effective === configPort;
}
