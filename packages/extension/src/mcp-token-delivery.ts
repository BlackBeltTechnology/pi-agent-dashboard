/**
 * Bridge-side registration of the dashboard MCP server
 * (migrate-mcp-to-pi-builtin D1; earlier: wire-mcp-session-token D5/D6).
 *
 * The dashboard mints a per-session bearer every time this session's bridge
 * (re)registers and delivers it — with the `/mcp` URL — over the
 * session-private extension lane (`mcp_token_minted`; never `pi.events`,
 * which is shared with every extension). This module is the ENTIRE in-session
 * surface of that delivery:
 *
 * - Register `pi-dashboard` with pi's built-in MCP via
 *   `pi.registerMcpServer(name, { url, headers: { Authorization }, exposure:
 *   "deferred" })`. A later registration of the same name replaces the earlier
 *   one, so a re-mint simply registers again.
 * - Unregister on `session_shutdown`; later deliveries are ignored until the
 *   next `session_start` (replacement session on the same instance).
 * - The credential lives only in this closure and in pi's registration. It is
 *   NEVER written to `process.env` (subprocesses must not inherit it), to a
 *   file, to a log line, or to `pi.events`.
 * - Guard: a missing/throwing `registerMcpServer`, or a delivery without a URL
 *   (older server), logs once with the session id and reports
 *   "registration unavailable" once; the session otherwise works.
 *
 * No pi import: the pi surface is injected, which keeps the module testable.
 *
 * See change: migrate-mcp-to-pi-builtin (D1).
 */

/** Name the dashboard's MCP server is registered under in every session. */
export const DASHBOARD_MCP_SERVER_NAME = "pi-dashboard";

export interface McpTokenMintedPayload {
  type: "mcp_token_minted";
  token?: unknown;
  url?: unknown;
}

/** The slice of pi's ExtensionAPI this module uses (both optional: old pi). */
export interface McpRegistrationApi {
  registerMcpServer?: (name: string, config: { url: string; headers: Record<string, string>; exposure: "deferred" }) => void;
  unregisterMcpServer?: (name: string) => void;
}

export type McpRegistrationUnavailableReason = "api-missing" | "register-failed" | "no-url";

export interface McpDashboardRegistrarDeps {
  pi: McpRegistrationApi;
  /** Live session id (it changes across new/fork/resume). */
  sessionId: () => string;
  /** Tell the server registration is unavailable. Called at most once. */
  reportUnavailable: (reason: McpRegistrationUnavailableReason) => void;
  /** Console-shaped logger. NEVER given the plaintext. */
  log?: Pick<Console, "info" | "warn" | "error">;
}

export interface McpDashboardRegistrar {
  onMinted(msg: McpTokenMintedPayload): void;
  onSessionShutdown(): void;
  /**
   * Re-arm after a shutdown: on new/fork/resume pi keeps the same extension
   * instance and fires `session_start` for the replacement session, whose own
   * mint then registers again.
   */
  onSessionStart(): void;
}

export function createMcpDashboardRegistrar(deps: McpDashboardRegistrarDeps): McpDashboardRegistrar {
  let ended = false;
  let registered = false;
  let reported = false;

  const unavailable = (reason: McpRegistrationUnavailableReason, detail?: string): void => {
    if (reported) return;
    reported = true;
    deps.log?.warn(
      `[dashboard] MCP registration unavailable for session ${deps.sessionId()} (${reason}${detail ? `: ${detail}` : ""}); dashboard MCP tools are not reachable from this session`,
    );
    try {
      deps.reportUnavailable(reason);
    } catch {
      /* best-effort report */
    }
  };

  return {
    onMinted(msg) {
      if (ended) return;
      const token = msg?.token;
      if (typeof token !== "string" || token.length === 0) {
        // Never echo the payload (it may carry the credential).
        deps.log?.warn("[dashboard] received a malformed mcp_token_minted message; ignoring");
        return;
      }
      const url = msg.url;
      if (typeof url !== "string" || url.length === 0) {
        unavailable("no-url");
        return;
      }
      const register = deps.pi.registerMcpServer;
      if (typeof register !== "function") {
        unavailable("api-missing");
        return;
      }
      try {
        register.call(deps.pi, DASHBOARD_MCP_SERVER_NAME, {
          url,
          headers: { Authorization: `Bearer ${token}` },
          exposure: "deferred",
        });
      } catch (err) {
        unavailable("register-failed", (err instanceof Error ? err.message : String(err)).slice(0, 200));
        return;
      }
      registered = true;
      deps.log?.info(`[dashboard] registered MCP server "${DASHBOARD_MCP_SERVER_NAME}" for session ${deps.sessionId()}`);
    },

    onSessionShutdown() {
      if (ended) return;
      ended = true;
      if (!registered) return;
      registered = false;
      try {
        deps.pi.unregisterMcpServer?.call(deps.pi, DASHBOARD_MCP_SERVER_NAME);
      } catch {
        // A reload releases the old runtime; its registry may already be gone.
      }
    },

    onSessionStart() {
      ended = false;
      // A replacement session reports its own unavailability.
      reported = false;
    },
  };
}
