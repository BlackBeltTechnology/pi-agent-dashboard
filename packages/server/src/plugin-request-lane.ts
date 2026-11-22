/**
 * Server half of the private plugin bridge→server request/reply lane.
 *
 * A plugin's bridge entry sends `plugin_request` over its session's bridge
 * socket; the host looks up the SINGLE handler registered for
 * `(pluginId, messageType)` and answers with `plugin_reply` on the same socket.
 * Replies are sent host-internally — NOT via the priority-gated
 * `sendExtensionMessage` — because a reply only answers a request the same
 * session's bridge made. `pi.events` is never involved.
 *
 * Separate from the fire-and-forget `registerPiHandler` registry.
 *
 * The lane does NOT authenticate the caller by itself. It carries the SENDING
 * socket's own host-observed origin and admission channel (`meta.origin`,
 * `meta.channel`), and refuses a `hubLocalOnly` handler unless the socket is
 * hub-local AND locally admitted. A handler that returns a credential, secret or
 * path-trusted value MUST register with `{ hubLocalOnly: true }`.
 * See change: expose-plugin-credential-and-oauth-seams (D7),
 * harden-bridge-session-claim (D3).
 */

import type {
  PluginReplyMessage,
  PluginRequestMessage,
} from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { auditPrefix } from "./auth/audit-log.js";
import { type BridgeChannel, isLocallyAdmitted } from "./pi/bridge-channel.js";
import { CONTENTION_RATE_LIMIT } from "./pi/bridge-contention.js";
import { originOf, type SessionOrigin, UNATTRIBUTED_REMOTE } from "./session/session-origin.js";

/** Request and reply payload cap (serialized UTF-8 bytes). */
export const PLUGIN_LANE_MAX_BYTES = 256 * 1024;

type PluginRequestHandler = (
  payload: unknown,
  meta: { sessionId: string; origin?: SessionOrigin; channel?: BridgeChannel },
) => unknown | Promise<unknown>;

/** Per-handler policy declared at registration. */
export interface PluginRequestHandlerOptions {
  /** Run only for a hub-local, locally admitted session (credential / secret / path-trusted handlers). */
  hubLocalOnly?: boolean;
}

/** The sending socket's own origin + channel, forwarded by the gateway. */
export interface PluginRequestConn {
  originDeviceId?: string;
  channel?: BridgeChannel;
}

export interface PluginRequestLane {
  register(pluginId: string, type: string, handler: PluginRequestHandler, opts?: PluginRequestHandlerOptions): void;
  /**
   * Dispatch one request; `sessionId` is the gateway's socket key, never the payload's.
   * `conn` is the SENDING socket's origin + channel; a dispatch without it fails closed
   * for a `hubLocalOnly` handler.
   */
  handle(sessionId: string, msg: PluginRequestMessage, conn?: PluginRequestConn): Promise<void>;
}

function originLabel(conn: PluginRequestConn | undefined): string {
  if (!conn) return "unknown";
  if (conn.originDeviceId === undefined) return "hub";
  if (conn.originDeviceId === UNATTRIBUTED_REMOTE) return "unknown";
  return auditPrefix(conn.originDeviceId);
}

export function createPluginRequestLane(
  send: (sessionId: string, msg: PluginReplyMessage) => unknown,
): PluginRequestLane {
  const handlers = new Map<string, { handler: PluginRequestHandler; opts: PluginRequestHandlerOptions }>();
  const lastDeniedLog = new Map<string, number>();
  const keyOf = (pluginId: string, type: string) => `${pluginId}\u0000${type}`;

  const reply = (sessionId: string, msg: PluginReplyMessage): void => {
    try {
      send(sessionId, msg);
    } catch (err) {
      console.error("[plugin-request] reply send failed:", (err as Error)?.message ?? err);
    }
  };

  return {
    register(pluginId, type, handler, opts) {
      const key = keyOf(pluginId, type);
      if (handlers.has(key)) {
        throw new Error(`plugin request handler already registered: ${pluginId}/${type}`);
      }
      handlers.set(key, { handler, opts: { hubLocalOnly: opts?.hubLocalOnly === true } });
    },

    async handle(sessionId, msg, conn) {
      const { requestId } = msg;
      const entry = handlers.get(keyOf(String(msg.pluginId), String(msg.messageType)));
      if (!entry) {
        reply(sessionId, { type: "plugin_reply", requestId, ok: false, error: "no_handler" });
        return;
      }
      const { handler, opts } = entry;
      // Host-observed facts about the SENDING socket. Missing conn (a hop that dropped
      // it) yields neither, which fails closed below.
      const origin = conn ? originOf({ originDeviceId: conn.originDeviceId }) : undefined;
      const channel = conn?.channel;
      if (opts.hubLocalOnly && !(origin?.local === true && channel && isLocallyAdmitted(channel.admission))) {
        const key = keyOf(String(msg.pluginId), String(msg.messageType));
        const now = Date.now();
        const last = lastDeniedLog.get(key);
        if (last === undefined || now - last >= CONTENTION_RATE_LIMIT) {
          lastDeniedLog.set(key, now);
          console.error(
            `[plugin-request] origin_denied: ${String(msg.pluginId)}/${String(msg.messageType)} session=${sessionId} origin=${originLabel(conn)} admission=${channel?.admission ?? "unknown"}`,
          );
        }
        const detail = !origin?.local
          ? "this handler is available to hub-local sessions only"
          : "this handler requires a locally admitted bridge connection";
        reply(sessionId, { type: "plugin_reply", requestId, ok: false, error: `origin_denied: ${detail}` });
        return;
      }
      let result: unknown;
      try {
        result = await handler(msg.payload, { sessionId, origin, channel });
      } catch (err) {
        // Message only — never the stack.
        const error = err instanceof Error ? err.message : String(err);
        reply(sessionId, { type: "plugin_reply", requestId, ok: false, error });
        return;
      }
      let json: string | undefined;
      try {
        json = JSON.stringify(result === undefined ? null : result);
      } catch {
        reply(sessionId, { type: "plugin_reply", requestId, ok: false, error: "reply_not_serializable" });
        return;
      }
      if (Buffer.byteLength(json ?? "null", "utf-8") > PLUGIN_LANE_MAX_BYTES) {
        reply(sessionId, { type: "plugin_reply", requestId, ok: false, error: "reply_too_large" });
        return;
      }
      reply(sessionId, { type: "plugin_reply", requestId, ok: true, result: JSON.parse(json ?? "null") });
    },
  };
}
