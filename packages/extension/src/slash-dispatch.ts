/**
 * Shared extension-slash-command dispatch branch used by both bridge.ts
 * (sessionPrompt callback) and command-handler.ts (slash else-arm fallback).
 *
 * Routing-step 9 from `command-routing` spec — three-way decision:
 *   - Path B: when `pi.dispatchCommand` is a function → call it directly.
 *   - Path C: when `pi.dispatchCommand` is absent AND the bridge runs inside a
 *     dashboard-spawned headless `pi --mode rpc` AND a `connection` is wired
 *     → emit `dispatch_extension_command` to the server (server forwards to
 *     the per-session RPC keeper UDS and emits the terminal command_feedback).
 *   - Path D: `pi.dispatchCommand` absent AND the bridge is NOT headless
 *     (tmux / wt) OR no `connection` was supplied → emit
 *     `command_feedback {status:"error"}` with a hint explaining that
 *     terminal-hosted sessions (tmux / Windows Terminal) own pi's stdin
 *     themselves and therefore cannot accept dispatched extension commands.
 *     Note: pi.sendUserMessage() hardcodes expandPromptTemplates: false, which
 *     skips _tryExecuteExtensionCommand; extension commands sent this way
 *     become regular LLM messages. This is a pi limitation — the bridge has
 *     no mechanism to dispatch extension commands outside the RPC path.
 *
 * If `text` is NOT an extension command, return `false` so the caller can
 * fall through to its existing template-expansion / sendUserMessage path.
 *
 * Guarantees: EXACTLY ONE `started` event AND EXACTLY ONE terminal event
 * (`completed` xor `error`) per dispatch, across all three paths combined.
 * Path C does NOT emit a terminal event — the server emits it.
 *
 * See change: fix-extension-slash-commands-in-dashboard,
 *             add-rpc-stdin-dispatch-with-keeper-sidecar,
 *             fix-slash-dispatch-delivery.
 */
import crypto from "node:crypto";
import type { ExtensionToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { hasDispatchCommand, isExtensionSlashCommand, isHeadlessRpcSession } from "./bridge-context.js";

export type FeedbackSink = (msg: ExtensionToServerMessage) => void;

/**
 * Minimal connection surface used by Path C. Concrete implementation is
 * `ConnectionManager` (`connection.ts`) but a structural type keeps this
 * helper unit-testable without a real WebSocket.
 */
export interface DispatchConnection {
  send(msg: ExtensionToServerMessage): void;
}

function emitFeedback(
  sink: FeedbackSink | undefined,
  sessionId: string,
  command: string,
  status: "started" | "completed" | "error",
  message?: string,
): void {
  if (!sink) return;
  sink({
    type: "event_forward",
    sessionId,
    event: {
      eventType: "command_feedback",
      timestamp: Date.now(),
      data: message === undefined ? { command, status } : { command, status, message },
    },
  });
}

/**
 * Try to dispatch a slash command as an extension command.
 *
 * @returns `true` if the helper handled the text (extension command detected;
 *          dispatch attempted or error feedback emitted). The caller MUST NOT
 *          fall through to template expansion or `sendUserMessage`.
 * @returns `false` if `text` is not an extension slash command. The caller
 *          SHOULD continue with its existing fallback path.
 */
export async function tryDispatchExtensionCommand(
  pi: unknown,
  text: string,
  sessionId: string,
  sink: FeedbackSink | undefined,
  connection?: DispatchConnection,
  delivery?: "steer" | "followUp",
): Promise<boolean> {
  // Defensive: pi.getCommands() can throw on a stale ctx during dispose.
  let commands: Array<{ name: string; source?: string }> = [];
  try {
    const got = (pi as any)?.getCommands?.();
    if (Array.isArray(got)) commands = got;
  } catch (err) {
    console.warn("[dashboard] getCommands stale on slash-dispatch", err);
    return false; // fall through to existing path; preserve today's behavior
  }

  if (!isExtensionSlashCommand(text, commands)) return false;

  // Path B (preferred when available): pi 0.71+ exposes dispatchCommand.
  // Note: as of pi 0.74.1, dispatchCommand does NOT exist in the ExtensionAPI.
  // This path is dead code until pi ships the API; preserved for future use.
  if (hasDispatchCommand(pi)) {
    emitFeedback(sink, sessionId, text, "started");
    try {
      await (pi as any).dispatchCommand(text, { streamingBehavior: delivery ?? "followUp" });
      emitFeedback(sink, sessionId, text, "completed");
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      emitFeedback(sink, sessionId, text, "error", message);
    }
    return true;
  }

  // Path C: headless RPC session, dispatchCommand absent. Hand off to the
  // server, which writes the line to the session's RPC keeper UDS and
  // emits the terminal command_feedback. The bridge does NOT emit a
  // terminal event for this path — that would duplicate the reducer's
  // started→terminal upsert. See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
  if (connection && isHeadlessRpcSession()) {
    emitFeedback(sink, sessionId, text, "started");
    connection.send({
      type: "dispatch_extension_command",
      sessionId,
      command: text,
      requestId: crypto.randomUUID(),
    });
    return true;
  }

  // Path D: No dispatchCommand, not headless (tmux / wt) or no connection.
  // Dashboard-spawned headless sessions dispatch through the RPC keeper
  // sidecar (always-on as of change `enable-rpc-keeper-by-default`). For
  // tmux / Windows Terminal sessions the user's terminal owns pi's stdin,
  // so the keeper cannot inject — the command becomes a regular LLM message
  // unless the user upgrades to a pi version that exposes `pi.dispatchCommand`
  // (Path B). See change: fix-slash-dispatch-delivery, enable-rpc-keeper-by-default.
  const RPC_KEEPER_HINT =
    "Extension slash commands cannot be dispatched from this session shape " +
    "(typically tmux or Windows Terminal sessions, where the user's terminal " +
    "owns pi's stdin). Dashboard-spawned headless sessions support slash " +
    "commands natively.";
  emitFeedback(sink, sessionId, text, "error", RPC_KEEPER_HINT);
  return true;
}
