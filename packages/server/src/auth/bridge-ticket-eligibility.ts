/**
 * WHO may mint a `bridge`-scoped WebSocket ticket.
 *
 * `networkGuard` answers "is this caller authenticated at all", and its OR
 * branches include a browser cookie session and any host inside the configured
 * trusted networks. The bridge surface is strictly MORE privileged than `/ws`:
 * a bridge registers sessions and attributes events to them. Letting a
 * LAN-trusted host — or script running in the dashboard's own origin — mint a
 * bridge credential would hand it that surface (@review Audit, major).
 *
 * So the bridge scope is narrowed to the two callers that are actually bridges:
 * a PAIRED DEVICE presenting its durable bearer (the remote-bridge flow, D7),
 * or a genuinely-local caller on this host (which could have used the unix
 * socket and needs no ticket at all on POSIX, but does on Windows — D6).
 *
 * The mint enforces `operate` ITSELF (the `/api/ws-ticket` route is `operate`, but the
 * route-tier gate is exempt for a `legacy`-mode trusted-network peer and a
 * genuinely-local caller, so the decider cannot rely on it). A below-operate bearer
 * falls through to the genuinely-local branch (a deviceless local ticket) or is refused.
 *
 * See change: add-pi-gateway-transport-identity (task 6.2),
 * harden-bridge-session-claim (D2).
 */

import { rank, type Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import type { LocalTrustContext } from "./local-proof.js";
import { isLocallyTrusted } from "./localhost-guard.js";

export interface BridgeMintInput {
  /** `Authorization` header, if any. */
  authorization?: string;
  ip: string;
  headers: Record<string, unknown>;
  /** Strict local-proof context (`requireLocalProof`); absent ⇒ default behaviour. */
  localTrust?: LocalTrustContext;
  /**
   * Resolve a durable device bearer to its paired-device id, or null. Returns
   * the ID rather than a boolean so the minted ticket can carry WHICH device
   * minted it: a session registered over that ticket is then attributable,
   * which is what the origin gate needs to refuse local file reads for a
   * remote session (#E15). Takes the object the registry now returns
   * (`{ id, tier }`; change: expand-mcp-tiered-surface); the mint reads `tier` too:
   * only `operate` may mint a bridge ticket as a device.
   */
  verifyDeviceBearer: (token: string) => { id: string; tier: Tier } | null;
}

export interface BridgeMintDecision {
  allow: boolean;
  reason: string;
  /** Set when the caller authenticated AS a paired device. */
  deviceId?: string;
  /** Set when a valid paired-device bearer was refused for being below `operate` (for the audit line). */
  belowOperate?: { tier: Tier; deviceId: string };
}

/** The refusal audit line: tier + an 8-char device prefix, never the full id or the token. */
export function formatBridgeTicketRefusalLine(tier: Tier, devicePrefix: string): string {
  return `[auth] bridge ticket refused: tier=${tier} device=${devicePrefix}`;
}

/**
 * Parse `Authorization: Bearer <token>` WITHOUT a backtracking regex.
 *
 * The obvious `/^Bearer\s+(.+)$/i` is a polynomial-ReDoS hazard (CodeQL
 * js/polynomial-redos): `\s+` and `.+` both match a space, so `"bearer "`
 * followed by many spaces makes the engine try every split between them. This
 * header is attacker-supplied on an unauthenticated route, which is exactly
 * where that matters. Slicing is linear and states the intent more plainly.
 */
function bearerFrom(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const trimmed = authorization.trim();
  if (trimmed.slice(0, 6).toLowerCase() !== "bearer") return null;
  const rest = trimmed.slice(6);
  // A single-character class test: no repetition, so nothing to backtrack.
  if (!/^\s/.test(rest)) return null;
  const token = rest.trim();
  return token.length > 0 ? token : null;
}

/**
 * Rate-limited audit logger for below-operate refusals: one line per device per `windowMs`
 * (the contention window), keyed by the full device id but logging only an 8-char prefix.
 * A `verdict` without `belowOperate`, or an allowed one, logs nothing.
 */
export function createTicketRefusalLog(opts: {
  windowMs: number;
  prefix: (deviceId: string) => string;
  now?: () => number;
  log?: (line: string) => void;
}): (verdict: BridgeMintDecision) => void {
  const last = new Map<string, number>();
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.error(line));
  return (verdict) => {
    if (!verdict.belowOperate || verdict.allow) return;
    const { tier, deviceId } = verdict.belowOperate;
    const t = now();
    const prev = last.get(deviceId);
    if (prev !== undefined && t - prev < opts.windowMs) return;
    last.set(deviceId, t);
    log(formatBridgeTicketRefusalLine(tier, opts.prefix(deviceId)));
  };
}

export function decideBridgeTicketMint(input: BridgeMintInput): BridgeMintDecision {
  const bearer = bearerFrom(input.authorization);
  const device = bearer ? input.verifyDeviceBearer(bearer) : null;
  if (device && rank(device.tier) >= rank("operate")) {
    return { allow: true, reason: "paired device bearer", deviceId: device.id };
  }
  const belowOperate = device ? { tier: device.tier, deviceId: device.id } : undefined;
  if (isLocallyTrusted({ ip: input.ip, headers: input.headers }, input.localTrust)) {
    return { allow: true, reason: "genuinely-local caller", belowOperate };
  }
  return {
    allow: false,
    reason: device
      ? "bridge tickets require a paired device at the operate tier; this device's tier is lower"
      : "bridge tickets require an operate-tier paired-device bearer or a genuinely-local caller; " +
        "a cookie session or trusted-network host is not sufficient",
    belowOperate,
  };
}
