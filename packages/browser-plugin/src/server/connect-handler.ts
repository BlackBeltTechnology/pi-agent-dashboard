/**
 * `browser/connect` — the plugin-server end of the `browser_connect` bridge tool
 * (change: add-dedicated-agent-browser, D6).
 *
 * The caller's `sessionId` comes ONLY from the request lane's `meta` (the bridge
 * socket key), exactly as `browser/open` does — a payload `sessionId` is never
 * read, so an agent cannot become another session's holder. Only `target` is
 * taken from the payload. Registered by the entry: see `registerPiRequestHandler`.
 */
import type { BrowserConnectResult, ConnectPolicyDeps } from "./agent-browser-types.js";
import { resolveBrowserConnect } from "./connect-policy.js";

/** Everything the policy needs except the per-call session. */
export type ConnectHandlerDeps = Omit<ConnectPolicyDeps, "sessionId">;

export function createConnectHandler(
  deps: ConnectHandlerDeps,
): (payload: unknown, meta: { sessionId: string }) => Promise<BrowserConnectResult> {
  return (payload, meta) => {
    const p = (typeof payload === "object" && payload !== null ? payload : {}) as { target?: unknown };
    return resolveBrowserConnect({ target: p.target }, { ...deps, sessionId: meta.sessionId });
  };
}
