/**
 * "Is the server behind this remote endpoint the one I paired with?" — asked
 * BEFORE a session is registered, not after (D8, tasks 7.2/7.3).
 *
 * Local endpoints are out of scope: a unix socket's filesystem ownership (D5)
 * and the loopback token (D6) already answer entitlement there, and the
 * instance check in `instance-verification.ts` answers *which* instance. This
 * gate covers the case those cannot reach — a server across a network, where an
 * address proves nothing at all.
 *
 * The challenge is injected so the decision table is testable without I/O.
 *
 * See change: add-pi-gateway-transport-identity (D8), fix-remote-bridge-ticket-origin (D2).
 */
import type { PinVerdict, ServerPin } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import { challengePinnedServer, TLS_VERIFY_ENV, tlsVerifyDisabled } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import { resolveDashboardHttpOrigin } from "./dashboard-http-origin.js";
import type { PinnedServer, ServerPinStore } from "./server-pin-store.js";
import { resolvePinForEndpoint } from "./server-pin-store.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** A socket or loopback endpoint is local; anything else crosses a network. */
export function isRemoteEndpoint(endpoint: string): boolean {
  if (endpoint.startsWith("ws+unix:")) return false;
  try {
    const u = new URL(endpoint);
    return !LOOPBACK_HOSTS.has(u.hostname) && !LOOPBACK_HOSTS.has(u.host);
  } catch {
    return false;
  }
}

type GateCause = PinVerdict["cause"] | "local" | "unpinned-legacy" | "bad-http-url" | "no-http-origin";

export interface GateResult {
  allow: boolean;
  cause: GateCause;
  reason: string;
  /** The identity that was verified, when one was. */
  fingerprint?: string;
}

export interface GateInput {
  endpoint: string;
  store: ServerPinStore;
  /** Required, not optional: an omitted env would silently drop `PI_DASHBOARD_HTTP_URL`. */
  env: Record<string, string | undefined>;
  challenge?: (baseUrl: string, pin: ServerPin) => Promise<PinVerdict>;
}

/**
 * Decide whether this bridge may register over `endpoint`.
 *
 * A bridge that has never paired keeps working against a remote URL — refusing
 * would break every existing `PI_DASHBOARD_URL` deployment on upgrade — but the
 * connection is reported as unverified, on the same deprecation horizon as the
 * unauthenticated TCP path (D10b, task 8.5). Once ANY pin exists, the fail-open
 * is over: an uncovered endpoint is refused rather than pinned on sight.
 */
export async function gateRemoteRegistration(input: GateInput): Promise<GateResult> {
  if (!isRemoteEndpoint(input.endpoint)) {
    return { allow: true, cause: "local", reason: `local endpoint ${input.endpoint} — authorised by the transport` };
  }
  if (input.store.servers.length === 0) {
    return {
      allow: true,
      cause: "unpinned-legacy",
      reason: `unverified: ${input.endpoint} is remote and this bridge has pinned no server identity — pair to verify it`,
    };
  }
  const pin: PinnedServer | undefined = resolvePinForEndpoint(input.store, input.endpoint);
  if (!pin) {
    return {
      allow: false,
      cause: "not-pinned",
      reason: `refused: ${input.endpoint} matches no pinned server identity`,
    };
  }
  // The challenge goes to the dashboard HTTP listener (it holds the server key),
  // not to the gateway port the bridge dials.
  const origin = resolveDashboardHttpOrigin(input.endpoint, input.env);
  if (!origin.ok) {
    return { allow: false, cause: origin.cause, reason: `refused: ${origin.reason}` };
  }
  // TLS origin with validation disabled in the process: no request at all (D7).
  if (/^https:/i.test(origin.origin) && tlsVerifyDisabled(input.env)) {
    return {
      allow: false,
      cause: "tls-verify-disabled",
      reason: `refused: ${TLS_VERIFY_ENV}=0 disables certificate validation; ${origin.origin} is not contacted (trust a private CA with NODE_EXTRA_CA_CERTS instead)`,
    };
  }
  const challenge = input.challenge ?? ((baseUrl: string, p: ServerPin) => challengePinnedServer({ baseUrl, pin: p, env: input.env }));
  const verdict = await challenge(origin.origin, pin);
  return {
    allow: verdict.accept,
    cause: verdict.cause,
    reason: verdict.reason,
    fingerprint: verdict.accept ? pin.fingerprint : undefined,
  };
}
