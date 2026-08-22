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
 * See change: add-pi-gateway-transport-identity (D8).
 */
import type { PinVerdict, ServerPin } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import { challengePinnedServer } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
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

/** The http origin serving `/api/pair/challenge` for a ws endpoint. */
export function httpBaseUrlFor(endpoint: string): string | null {
  try {
    const u = new URL(endpoint);
    if (u.protocol === "ws:") return `http://${u.host}`;
    if (u.protocol === "wss:") return `https://${u.host}`;
    return null;
  } catch {
    return null;
  }
}

type GateCause = PinVerdict["cause"] | "local" | "unpinned-legacy";

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
  challenge?: (baseUrl: string, pin: ServerPin) => Promise<PinVerdict>;
}

const defaultChallenge = (baseUrl: string, pin: ServerPin) => challengePinnedServer({ baseUrl, pin });

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
  const baseUrl = httpBaseUrlFor(input.endpoint);
  if (!baseUrl) {
    return { allow: false, cause: "unreachable", reason: `refused: ${input.endpoint} has no http origin to challenge` };
  }
  const verdict = await (input.challenge ?? defaultChallenge)(baseUrl, pin);
  return {
    allow: verdict.accept,
    cause: verdict.cause,
    reason: verdict.reason,
    fingerprint: verdict.accept ? pin.fingerprint : undefined,
  };
}
