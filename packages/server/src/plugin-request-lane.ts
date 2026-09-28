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
 * See change: expose-plugin-credential-and-oauth-seams (D7).
 */

import type {
  PluginReplyMessage,
  PluginRequestMessage,
} from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

/** Request and reply payload cap (serialized UTF-8 bytes). */
export const PLUGIN_LANE_MAX_BYTES = 256 * 1024;

type PluginRequestHandler = (
  payload: unknown,
  meta: { sessionId: string },
) => unknown | Promise<unknown>;

export interface PluginRequestLane {
  register(pluginId: string, type: string, handler: PluginRequestHandler): void;
  /** Dispatch one request; `sessionId` is the gateway's socket key, never the payload's. */
  handle(sessionId: string, msg: PluginRequestMessage): Promise<void>;
}

export function createPluginRequestLane(
  send: (sessionId: string, msg: PluginReplyMessage) => unknown,
): PluginRequestLane {
  const handlers = new Map<string, PluginRequestHandler>();
  const keyOf = (pluginId: string, type: string) => `${pluginId}\u0000${type}`;

  const reply = (sessionId: string, msg: PluginReplyMessage): void => {
    try {
      send(sessionId, msg);
    } catch (err) {
      console.error("[plugin-request] reply send failed:", (err as Error)?.message ?? err);
    }
  };

  return {
    register(pluginId, type, handler) {
      const key = keyOf(pluginId, type);
      if (handlers.has(key)) {
        throw new Error(`plugin request handler already registered: ${pluginId}/${type}`);
      }
      handlers.set(key, handler);
    },

    async handle(sessionId, msg) {
      const { requestId } = msg;
      const handler = handlers.get(keyOf(String(msg.pluginId), String(msg.messageType)));
      if (!handler) {
        reply(sessionId, { type: "plugin_reply", requestId, ok: false, error: "no_handler" });
        return;
      }
      let result: unknown;
      try {
        result = await handler(msg.payload, { sessionId });
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
