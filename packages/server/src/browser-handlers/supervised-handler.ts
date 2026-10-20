/**
 * Browser → server `set_supervised`: flip a session's Supervised mode.
 *
 * Owner-only by construction — `set_supervised` is in `SESSION_OWNED_MESSAGES`, so the
 * §8.3 choke point in the browser gateway drops a non-owner's frame before dispatch
 * (same gate as `send_prompt`); this handler only sees an authorised sender. It
 * validates the payload, then `flipSupervised` assigns the next `rev`, persists,
 * broadcasts, forwards `set_supervised {on, rev}` to the bridge and audit-logs it.
 *
 * See change: add-supervised-tool-approval (design D4).
 */
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { flipSupervised } from "../session/supervised-sync.js";
import type { BrowserHandlerContext } from "./handler-context.js";

export function handleSetSupervised(
  msg: Extract<BrowserToServerMessage, { type: "set_supervised" }>,
  ctx: BrowserHandlerContext,
): void {
  // Malformed payload / unknown session: ignored, mode kept (existing session-command behaviour).
  if (typeof msg.sessionId !== "string" || typeof msg.on !== "boolean") return;
  flipSupervised(
    {
      sessionManager: ctx.sessionManager,
      piGateway: ctx.piGateway,
      broadcastSessionUpdated: (sessionId, updates) => ctx.broadcast({ type: "session_updated", sessionId, updates } as never),
    },
    msg.sessionId,
    msg.on,
    ctx.connectionId ?? "unknown",
  );
}
