/**
 * Degraded-feature contract for ACP sessions (`driver: "acp"`).
 *
 * pi-only browser operations and every "continue this session" path (reload,
 * resume, fork, retry, auto-resume on prompt, boot recovery) are REFUSED with
 * the typed code `unsupported_for_acp` BEFORE any side effect — no process
 * killed, no `resuming` flag, no resume intent, nothing spawned, nothing
 * forwarded to the adapter. One helper, one vocabulary.
 *
 * See change: add-acp-session-driver (D12, D15).
 */
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export const UNSUPPORTED_FOR_ACP = "unsupported_for_acp";

/** Browser message types that only make sense for a pi session. */
const PI_ONLY_BROWSER_OPS: ReadonlySet<string> = new Set([
  "retry_session",
  "stop_after_turn",
  "flow_control",
  "flow_management",
  "architect_prompt_response",
  "role_set",
  "role_preset_load",
  "role_preset_save",
  "role_preset_delete",
  "role_remove",
  "request_roles",
  "ui_management",
  "open_inline_terminal",
  "list_files",
  "kill_process",
  "subagent_resync_request",
]);

/**
 * Background requests the client issues on its own (no user action): refused
 * silently — a chat error the user never caused would be noise. The
 * request_roles refresh is sent through whichever session is live first.
 */
const SILENT_PI_ONLY_OPS: ReadonlySet<string> = new Set(["request_roles", "subagent_resync_request"]);

export const isAcp = (session: Pick<DashboardSession, "driver"> | undefined): boolean => session?.driver === "acp";

export function unsupportedMessage(op: string): string {
  return `Not supported for ACP sessions: ${op} (${UNSUPPORTED_FOR_ACP})`;
}

/** Hint for a prompt to an ended ACP session (it cannot be continued). */
export function endedPromptHint(session: Pick<DashboardSession, "acpAgentId">): string {
  const agent = session.acpAgentId ? ` with agent "${session.acpAgentId}"` : "";
  return `This ACP session has ended and cannot be continued — start a new session${agent} (${UNSUPPORTED_FOR_ACP}).`;
}

export interface AcpGuardContext {
  sessionManager: { get(id: string): DashboardSession | undefined };
  /** Surface the refusal in the session's chat (`command_feedback`). */
  feedback(sessionId: string, message: string, command: string): void;
}

/**
 * Refuse `op` for an ACP session. Returns true when refused (caller returns
 * immediately, before any side effect); false for pi / unknown sessions.
 */
export function refuseIfAcp(ctx: AcpGuardContext, sessionId: string, op: string, message = unsupportedMessage(op)): boolean {
  if (!isAcp(ctx.sessionManager.get(sessionId))) return false;
  ctx.feedback(sessionId, message, op);
  return true;
}

/** Central pre-dispatch gate for browser WS messages. True → refused. */
export function guardAcpBrowserMessage(msg: BrowserToServerMessage, ctx: AcpGuardContext): boolean {
  if (!PI_ONLY_BROWSER_OPS.has(msg.type)) return false;
  const sessionId = (msg as { sessionId?: unknown }).sessionId;
  if (typeof sessionId !== "string") return false;
  if (SILENT_PI_ONLY_OPS.has(msg.type)) return isAcp(ctx.sessionManager.get(sessionId));
  return refuseIfAcp(ctx, sessionId, msg.type);
}
