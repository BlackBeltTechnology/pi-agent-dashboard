/**
 * Bridge-side handling of the minted MCP session token
 * (wire-mcp-session-token, design D2/D5/D6).
 *
 * The dashboard mints a per-session bearer every time this session's bridge
 * (re)registers and delivers the plaintext over the session-private extension
 * lane (`mcp_token_minted` — never `pi.events`, which is shared with every
 * extension and was measured to leak payloads to unrelated subscribers, spike
 * Q4b). This module is the ENTIRE in-session surface of that delivery:
 *
 * 1. Assign the token to this pi process's own `process.env` (D2 step 2). The
 *    provisioned `pi-dashboard` entry's `requestHeadersCommand` interpolates
 *    the LIVE env per HTTP request (spike Q2), so a value written here is
 *    presented on the next request — no file write, nothing on disk, ever.
 *
 * 2. Trigger recovery (D6) by calling the injected `reconnect`. The mint reply
 *    is the SOLE trigger — `connection.status` is never read anywhere in this
 *    module (F3), because it was measured to read `connected` while every
 *    request 401s (spike Q3).
 *
 * The plaintext never touches a log line, a file, or `pi.events` (F4, X5).
 *
 * See change: wire-mcp-session-token (D5/D6).
 */

/** The env var the provisioned entry's `env` slot re-declares (D2). */
export const MCP_TOKEN_ENV_VAR = "PI_DASHBOARD_MCP_TOKEN";

export interface McpTokenMintedPayload {
  type: "mcp_token_minted";
  token?: unknown;
}

export interface McpTokenDeliveryDeps {
  /**
   * The env write. Injected so tests can spy the ORDER against `reconnect`
   * (F2: the env is assigned before recovery is triggered, never while the
   * entry would still present the stale credential).
   */
  assignEnv: (token: string) => void;
  /**
   * The D6 recovery trigger, called ONLY after a successful env assignment.
   *
   * SHIPPED-STACK NOTE (recorded per the approved deviation): pi-mcp-adapter
   * ≤ 2.31 exposes no programmatic reconnect API for a config-defined entry —
   * the only public `pi.events` ops are runtime-register/runtime-snapshot, and
   * pi's ExtensionAPI has no MCP surface. Production wiring therefore passes a
   * best-effort no-op, and recovery completes through the adapter's own
   * `lazyConnect` on the entry's next use (failure backoff 60 s), presenting
   * the freshly-assigned env on the per-request header command. The injected
   * seam keeps the trigger order testable and lets a future adapter reconnect
   * op slot in without touching this module again.
   */
  reconnect: () => void | Promise<void>;
  /** Console-shaped logger. NEVER given the plaintext. */
  log?: Pick<Console, "info" | "warn" | "error">;
}

/**
 * Handle one `mcp_token_minted` message. Idempotent per message, synchronous
 * in its env assignment, and silent about the credential in every observable.
 */
export function handleMcpTokenMinted(msg: McpTokenMintedPayload, deps: McpTokenDeliveryDeps): void {
  const token = msg?.token;
  if (typeof token !== "string" || token.length === 0) {
    // A malformed mint reply is a server-side defect; say so without ever
    // echoing the payload (X5 — the plaintext appears in zero log lines).
    deps.log?.warn("[dashboard] received a malformed mcp_token_minted message; ignoring");
    return;
  }

  // F2 — the env write strictly precedes the recovery trigger.
  deps.assignEnv(token);
  deps.log?.info(
    `[dashboard] MCP credential delivered to process env (${MCP_TOKEN_ENV_VAR}); triggering entry recovery`,
  );

  // D6 — recovery is triggered by the mint reply, never by a health probe.
  // Async failures are logged, never thrown into the bridge dispatcher.
  try {
    const triggered = deps.reconnect();
    if (triggered && typeof (triggered as Promise<void>).catch === "function") {
      (triggered as Promise<void>).catch((err: unknown) => {
        deps.log?.warn(`[dashboard] MCP entry recovery trigger failed: ${describe(err)}`);
      });
    }
  } catch (err) {
    deps.log?.warn(`[dashboard] MCP entry recovery trigger failed: ${describe(err)}`);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
