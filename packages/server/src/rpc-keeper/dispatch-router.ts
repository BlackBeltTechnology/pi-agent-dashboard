/**
 * Dispatch router for the bridge→server `dispatch_extension_command`
 * message. Forwards the slash command to the per-session RPC keeper UDS
 * and emits the terminal `command_feedback` event to browser subscribers
 * (the bridge already emitted `started`).
 *
 * Optimistic completion (design.md Decision 7): a successful UDS write
 * means pi RECEIVED the line; if pi rejects it, an `extension_error`
 * event flows back over the bridge WS path and is rendered as a separate
 * chat row by the existing event-reducer.
 *
 * The terminal `completed` / `error` event MUST be persisted in the
 * dashboard's `eventStore` (same path the bridge's `event_forward` takes)
 * — otherwise the chat pill renders the bridge's persisted `started`
 * but the server's optimistic terminal is ephemeral and the upsert never
 * fires on browser reattach. Stuck-on-"in progress" was the visible
 * symptom of routing the broadcast directly via `sendToSubscribers`
 * without storing first.
 *
 * See change: add-rpc-stdin-dispatch-with-keeper-sidecar (Phase 8).
 */
import type { DispatchExtensionCommandMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { HeadlessPidRegistry } from "../spawn-process/headless-pid-registry.js";

export interface DispatchRouterContext {
  headlessPidRegistry: HeadlessPidRegistry;
  /**
   * Persist + broadcast a `command_feedback` event for `sessionId`.
   * Wired by `event-wiring.ts` to `eventStore.insertEvent` +
   * `browserGateway.broadcastEvent` so the event survives browser
   * reattach via the existing replay path.
   */
  emitCommandFeedback(
    sessionId: string,
    command: string,
    status: "completed" | "error",
    message?: string,
  ): void;
}

/**
 * Build the pi RPC line forwarded over the keeper UDS. Pure helper so
 * unit tests don't have to JSON-parse to assert the shape.
 */
export function buildPiRpcLine(command: string, requestId: string): string {
  return JSON.stringify({ type: "prompt", message: command, id: requestId });
}

const ERR_NO_KEEPER = "RPC keeper unavailable for this session";
const ERR_WRITE_PREFIX = "Failed to write RPC line";

/**
 * Handle `dispatch_extension_command`: write the pi RPC line to the
 * session's keeper UDS, then persist + broadcast the optimistic terminal
 * `command_feedback`. Never throws; failures surface as
 * `command_feedback {status:"error"}` via `emitCommandFeedback`.
 */
export async function handleDispatchExtensionCommand(
  msg: DispatchExtensionCommandMessage,
  ctx: DispatchRouterContext,
): Promise<void> {
  const { sessionId, command, requestId } = msg;
  const line = buildPiRpcLine(command, requestId);
  console.error(
    `[dispatch-router] dispatch_extension_command sid=${sessionId} cmd=${command} reqId=${requestId.slice(0, 8)}`,
  );

  let ok = false;
  try {
    ok = await ctx.headlessPidRegistry.writeRpc(sessionId, line);
  } catch (err: any) {
    const reason = err instanceof Error ? err.message : String(err);
    ctx.emitCommandFeedback(sessionId, command, "error", `${ERR_WRITE_PREFIX}: ${reason}`);
    return;
  }

  if (!ok) {
    console.error(`[dispatch-router] writeRpc returned false for sid=${sessionId} (no keeper or socket gone)`);
    ctx.emitCommandFeedback(sessionId, command, "error", ERR_NO_KEEPER);
    return;
  }

  console.error(`[dispatch-router] writeRpc OK for sid=${sessionId}, emitting optimistic completed`);
  ctx.emitCommandFeedback(sessionId, command, "completed");
}
