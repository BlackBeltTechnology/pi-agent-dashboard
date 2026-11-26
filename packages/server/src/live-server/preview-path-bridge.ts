/**
 * Server half of the bridge reserve-path pair (D9): `preview_path_request` → `preview_path_result`, and
 * `preview_path_release`. The bridge's authenticated socket is the principal: its session key (the gateway's own socket key,
 * never the body's `sessionId`) is the reservation bound key. The bridge forwards the answer; it decides nothing.
 * See change: serve-live-previews-on-capability-origin (D9).
 */
import type { PreviewPathReleaseMessage, PreviewPathRequestMessage, PreviewPathResultMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { rank, type Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import type { GatewayConn } from "../pi/pi-gateway.js";
import { type PreviewReserveDeps, reservePreviewPath } from "./preview-reserve.js";

export interface PreviewPathBridgeDeps {
  reserve: PreviewReserveDeps;
  /** The tier of a paired device (a `device-ticket` admission takes its ticket device's tier); `undefined` ⇒ unknown. */
  deviceTier: (deviceId: string) => Tier | undefined;
  /** Is the bridge session still connected? (A reservation dies with its session.) */
  isSessionLive: (sessionId: string) => boolean;
}

/** Bound key of a bridge reserver: the SERVER-KNOWN session, namespaced away from REST principal keys. */
export const bridgeReserverKey = (connectionSessionId: string): string => `bridge:${connectionSessionId}`;

const none = (requestId: string, error?: PreviewPathResultMessage["error"], tier5Viewers = false): PreviewPathResultMessage => ({
  type: "preview_path_result",
  requestId,
  path: null,
  tier5Viewers,
  ...(error ? { error } : {}),
});

/** Does the bridge's admission hold the `control` tier? Local admissions do; a device ticket takes its device's tier. */
function bridgeHoldsControl(conn: GatewayConn | undefined, deps: PreviewPathBridgeDeps): boolean {
  const ch = conn?.channel;
  if (!ch) return false; // no admission record ⇒ fail closed
  if (ch.admission !== "device-ticket") return true; // unix / local proof / in-process / local-ticket / legacy: no per-device tier
  const tier = ch.ticketDeviceId ? deps.deviceTier(ch.ticketDeviceId) : undefined;
  return tier !== undefined && rank(tier) >= rank("control");
}

export function handlePreviewPathRequest(
  /** The gateway's own socket key for this connection — never trusted from the body. */
  connectionSessionId: string,
  msg: PreviewPathRequestMessage,
  conn: GatewayConn | undefined,
  deps: PreviewPathBridgeDeps,
): PreviewPathResultMessage {
  const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
  if (!requestId || msg.sessionId !== connectionSessionId) return none(requestId, "session_mismatch");
  if (!bridgeHoldsControl(conn, deps)) return none(requestId, "insufficient_scope");
  const out = reservePreviewPath(deps.reserve, msg.port, {
    key: bridgeReserverKey(connectionSessionId),
    isLive: () => deps.isSessionLive(connectionSessionId),
  }, requestId, connectionSessionId);
  switch (out.kind) {
    case "invalid-port":
      return none(requestId, "invalid_port");
    case "no-viewer":
      return none(requestId);
    case "limit":
      return none(requestId, "reservation_limit", true);
    case "ok":
      return { type: "preview_path_result", requestId, path: out.path, expiresAt: out.expiresAt, tier5Viewers: true };
  }
}

/** A reservation whose probe was aborted: drop it (only the connection's own, only while unbound). Idempotent. */
export function handlePreviewPathRelease(connectionSessionId: string, msg: PreviewPathReleaseMessage, deps: PreviewPathBridgeDeps): void {
  if (typeof msg.requestId !== "string" || msg.sessionId !== connectionSessionId) return;
  deps.reserve.store.releaseByRequest(msg.requestId, bridgeReserverKey(connectionSessionId));
}
