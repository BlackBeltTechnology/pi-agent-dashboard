/**
 * Mint a fresh, single-use bridge ticket for a REMOTE endpoint.
 *
 * Returns undefined for a local endpoint (nothing to mint) and THROWS when a
 * remote endpoint cannot be authorised, so ConnectionManager retries on its
 * backoff rather than dialling a credential-less upgrade the gateway will
 * refuse. The cause is logged once per attempt: "refused" means the bearer is
 * missing, unpaired or revoked; "wrong-origin" means the HTTP origin is wrong.
 *
 * The HTTP origin comes from `resolveDashboardHttpOrigin` (the gateway port is
 * NOT the HTTP port). A change of origin is logged once through both channels
 * — console and the transport diagnostics — deduped on `origin|source`. The
 * bearer is never logged.
 *
 * Extracted from `bridge.ts` so it is testable without a live bridge.
 *
 * See change: fix-remote-bridge-ticket-origin (D2, D4).
 */
import { mintBridgeTicket, readDeviceToken, withTicket } from "./bridge-ticket-client.js";
import { resolveDashboardHttpOrigin } from "./dashboard-http-origin.js";
import { isRemoteEndpoint } from "./remote-registration-gate.js";

export interface RemoteUpgradePreparerDeps {
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  log: Pick<Console, "log" | "error">;
  /** Mirror of a diagnostic line over the wire (`transportDiagnostics.record`). */
  record: (d: { event: "endpoint_resolved"; detail: string }) => void;
}

export type RemoteUpgradePreparer = ((endpoint: string) => Promise<{ url?: string } | undefined>) & {
  /** Resolve + log the HTTP origin for a remote endpoint (deduped) without minting. */
  noteOrigin: (endpoint: string) => void;
};

export function createRemoteUpgradePreparer(deps: RemoteUpgradePreparerDeps): RemoteUpgradePreparer {
  let lastEmitted: string | undefined;

  /** Resolve, and emit one `http origin …` line whenever the outcome differs from the last one. */
  function resolveAndNote(endpoint: string) {
    const resolved = resolveDashboardHttpOrigin(endpoint, deps.env);
    const key = resolved.ok ? `${resolved.origin}|${resolved.source}` : `${resolved.cause}|${endpoint}`;
    if (key !== lastEmitted) {
      lastEmitted = key;
      const line = resolved.ok
        ? `http origin ${resolved.origin} (${resolved.source})`
        : `http origin unresolved: ${resolved.cause}: ${resolved.reason}`;
      deps.log.log(`[dashboard] ${line}`);
      deps.record({ event: "endpoint_resolved", detail: line });
    }
    return resolved;
  }

  const prepare = async (endpoint: string): Promise<{ url?: string } | undefined> => {
    if (!isRemoteEndpoint(endpoint)) return undefined;
    const resolved = resolveAndNote(endpoint);
    if (!resolved.ok) {
      deps.log.error(`[dashboard] bridge ticket ${resolved.cause}: ${resolved.reason}`);
      throw new Error(resolved.reason);
    }
    const minted = await mintBridgeTicket({
      httpBase: resolved.origin,
      token: readDeviceToken(deps.env),
      originSource: resolved.source,
      fetchImpl: deps.fetchImpl,
    });
    if (!minted.ok) {
      deps.log.error(`[dashboard] bridge ticket ${minted.cause}: ${minted.reason}`);
      throw new Error(minted.reason);
    }
    return { url: withTicket(endpoint, minted.ticket) };
  };

  return Object.assign(prepare, {
    noteOrigin: (endpoint: string) => {
      if (isRemoteEndpoint(endpoint)) resolveAndNote(endpoint);
    },
  });
}
