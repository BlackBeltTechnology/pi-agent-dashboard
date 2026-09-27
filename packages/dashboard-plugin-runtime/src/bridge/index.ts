/**
 * Bridge-side helpers for dashboard plugin bridge entries (pi extensions).
 * Import from @blackbelt-technology/dashboard-plugin-runtime/bridge — pure TS,
 * no React, no pi dependency.
 */

/** Global symbol the dashboard's core bridge installs while connected. */
export const PLUGIN_REQUEST_SYMBOL = Symbol.for("pi-dashboard.pluginRequest");

export type PluginLaneReply =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

type PluginRequestFn = (pluginId: string, messageType: string, payload?: unknown) => Promise<PluginLaneReply>;

/**
 * Send a private request to this plugin's server entry
 * (`ctx.registerPiRequestHandler(messageType, …)`) and await its reply.
 * Never rides `pi.events`. Resolves (never rejects) with `{ok:false,error}` on
 * `unavailable` (no dashboard bridge / not connected), `timeout` (15 s),
 * `disconnected`, `request_too_large` (> 256 KiB), `no_handler`,
 * `reply_too_large`, `reply_not_serializable`, or the handler's error message.
 * See change: expose-plugin-credential-and-oauth-seams (D7).
 */
export function requestPluginServer(
  pluginId: string,
  messageType: string,
  payload?: unknown,
): Promise<PluginLaneReply> {
  const fn = (globalThis as Record<symbol, unknown>)[PLUGIN_REQUEST_SYMBOL];
  if (typeof fn !== "function") return Promise.resolve({ ok: false, error: "unavailable" });
  return (fn as PluginRequestFn)(pluginId, messageType, payload);
}
