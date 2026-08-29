/**
 * The poisoned advertisement, exactly as it occurred (proposal, "Root cause").
 *
 * A stale dashboard from a git worktree bound itself to `127.0.0.1` ONLY, then
 * advertised itself over mDNS under the machine's LAN hostname. Anyone who
 * believed the record — including a process on the SAME machine — resolved
 * `home-imac-54922.local` to a non-loopback address the loopback-bound server
 * never answered on. `GET http://home-imac-54922.local:8478/api/health`
 * returned 000 (unreachable) while the process was alive and healthy on
 * `127.0.0.1`.
 *
 * The migration scenarios consume this shape (not an invented one) so the
 * tests exercise the failure as it happened: a plausible-looking discovery
 * result whose endpoint cannot work.
 */

export const POISONED_ADVERTISEMENT = {
  /** What mDNS published as the host (the machine's LAN hostname). */
  mdnsHost: "home-imac-54922.local",
  /** The HTTP port the record named. */
  httpPort: 8478,
  /** The gateway (WebSocket) port the record named. */
  piPort: 9594,
  /** The address the stale server was ACTUALLY bound to. */
  boundAddress: "127.0.0.1",
} as const;

/** The WebSocket endpoint a consumer builds from the poisoned record. */
export const POISONED_CANDIDATE_URL = `ws://${POISONED_ADVERTISEMENT.mdnsHost}:${POISONED_ADVERTISEMENT.piPort}`;

/** The health URL a consumer would probe before adopting the record. */
export const POISONED_HEALTH_URL = `http://${POISONED_ADVERTISEMENT.mdnsHost}:${POISONED_ADVERTISEMENT.httpPort}/api/health`;
