/**
 * Bridge half of the private plugin request/reply lane.
 *
 * While the bridge is connected it installs a Promise-returning function at
 * `globalThis[Symbol.for("pi-dashboard.pluginRequest")]`. A plugin bridge
 * entry calls it; the request travels as `plugin_request` on the bridge
 * socket and resolves when the matching `plugin_reply` arrives. The reply
 * resolves a Promise held only by the caller — `pi.events` is never touched,
 * so other extensions can neither observe nor forge it.
 *
 * No pi dependency (same shape as mcp-token-delivery.ts).
 * See change: expose-plugin-credential-and-oauth-seams (D7).
 */

import { randomUUID } from "node:crypto";

export const PLUGIN_REQUEST_SYMBOL = Symbol.for("pi-dashboard.pluginRequest");
const PLUGIN_REQUEST_TIMEOUT_MS = 15_000;
export const PLUGIN_REQUEST_MAX_BYTES = 256 * 1024;

type PluginLaneReply =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export type PluginRequestFn = (
  pluginId: string,
  messageType: string,
  payload?: unknown,
) => Promise<PluginLaneReply>;

export interface PluginRequestClientDeps {
  /** Sends one frame on the OPEN bridge socket; `false` = not sent (never buffered). */
  send: (msg: unknown) => boolean;
  timeoutMs?: number;
  newId?: () => string;
}

export interface PluginRequestClient {
  request: PluginRequestFn;
  /** Feed an inbound `plugin_reply`. Unknown / late ids are dropped. */
  handleReply(msg: { requestId?: unknown; ok?: unknown; result?: unknown; error?: unknown }): void;
  /** Resolve every pending call with `error` (socket closed). */
  failAll(error: string): void;
  pendingCount(): number;
}

export function createPluginRequestClient(deps: PluginRequestClientDeps): PluginRequestClient {
  const timeoutMs = deps.timeoutMs ?? PLUGIN_REQUEST_TIMEOUT_MS;
  const newId = deps.newId ?? randomUUID;
  const pending = new Map<string, { resolve: (r: PluginLaneReply) => void; timer: NodeJS.Timeout }>();

  const settle = (id: string, reply: PluginLaneReply): void => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(reply);
  };

  return {
    request(pluginId, messageType, payload) {
      let json: string | undefined;
      try {
        json = JSON.stringify(payload === undefined ? null : payload);
      } catch {
        return Promise.resolve({ ok: false, error: "request_not_serializable" });
      }
      if (Buffer.byteLength(json ?? "null", "utf-8") > PLUGIN_REQUEST_MAX_BYTES) {
        return Promise.resolve({ ok: false, error: "request_too_large" });
      }
      const requestId = newId();
      return new Promise<PluginLaneReply>((resolve) => {
        const timer = setTimeout(() => settle(requestId, { ok: false, error: "timeout" }), timeoutMs);
        timer.unref?.();
        pending.set(requestId, { resolve, timer });
        let sent = false;
        try {
          sent = deps.send({
            type: "plugin_request",
            requestId,
            pluginId,
            messageType,
            payload: JSON.parse(json ?? "null"),
          });
        } catch {
          sent = false;
        }
        if (!sent) settle(requestId, { ok: false, error: "disconnected" });
      });
    },
    handleReply(msg) {
      if (typeof msg.requestId !== "string") return;
      settle(
        msg.requestId,
        msg.ok === true
          ? { ok: true, result: msg.result }
          : { ok: false, error: typeof msg.error === "string" ? msg.error : "error" },
      );
    },
    failAll(error) {
      for (const id of [...pending.keys()]) settle(id, { ok: false, error });
    },
    pendingCount: () => pending.size,
  };
}

/** Install `fn` at the global symbol; returns an uninstaller that only removes OUR fn. */
export function installPluginRequest(fn: PluginRequestFn): () => void {
  const g = globalThis as Record<symbol, unknown>;
  g[PLUGIN_REQUEST_SYMBOL] = fn;
  return () => {
    if (g[PLUGIN_REQUEST_SYMBOL] === fn) delete g[PLUGIN_REQUEST_SYMBOL];
  };
}
