/**
 * Which listeners the bridge gateway binds (D10, tasks 8.1/8.6, D6 task 5.2).
 *
 * Until this change the gateway bound `host:piPort` unconditionally, and the
 * shipped container published `0.0.0.0:9999` — an unauthenticated port anyone
 * on the network could register a session against. The default is now the unix
 * socket, whose filesystem ownership answers entitlement without a port
 * existing at all; TCP survives as an explicit opt-in (D10b) with bridge auth
 * mandatory, and as the loopback fallback where a socket is unrepresentable.
 *
 * Pure decision — the binding itself stays in `pi-gateway.ts`.
 *
 * See change: add-pi-gateway-transport-identity.
 */
import type { LocalGatewayEndpoint } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** `PI_GATEWAY_TCP` — the explicit opt-in. Absent means "no TCP listener". */
export function isTcpOptIn(env: Record<string, string | undefined>): boolean {
  return TRUTHY.has((env.PI_GATEWAY_TCP ?? "").trim().toLowerCase());
}

export interface ListenerPolicyInput {
  local: LocalGatewayEndpoint;
  tcpOptIn: boolean;
  /** The dashboard's configured bind host. */
  host: string;
  piPort: number;
}

export interface ListenerPolicy {
  socketPath?: string;
  tcp?: { host: string; port: number };
  /** Task 10.1 — the chosen shape is logged, never inferred from symptoms. */
  reason: string;
}

/**
 * Decide the listener set.
 *
 * The fallback listener is pinned to `127.0.0.1` regardless of the configured
 * bind host: it exists to serve THIS host's bridges (authorised by the local
 * token), so widening it to the configured host would publish an unintended
 * network port — the exact default this change removes. Only an explicit
 * opt-in widens it.
 */
export function decideGatewayListeners(input: ListenerPolicyInput): ListenerPolicy {
  const { local, tcpOptIn, host, piPort } = input;
  if (local.transport === "unix") {
    if (!tcpOptIn) {
      return { socketPath: local.path, reason: `bridge socket ${local.path}; no TCP listener` };
    }
    return {
      socketPath: local.path,
      tcp: { host, port: piPort },
      reason: `bridge socket ${local.path} + opt-in TCP ${host}:${piPort} (PI_GATEWAY_TCP)`,
    };
  }
  const bindHost = tcpOptIn ? host : "127.0.0.1";
  return {
    tcp: { host: bindHost, port: piPort },
    reason: `no unix socket here (${local.reason}); bridge TCP ${bindHost}:${piPort}`,
  };
}
