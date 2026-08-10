/**
 * Pure helpers for session-action-handler.
 *
 * Extracted so they can be unit-tested without the surrounding I/O surface
 * (pi-gateway, event store, headless-pid-registry wiring).
 */

import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { HeadlessPidRegistry } from "../spawn-process/headless-pid-registry.js";

type SendPromptMsg = Extract<BrowserToServerMessage, { type: "send_prompt" }>;

/**
 * Return true iff a `send_prompt` message targeting a headless session should
 * be intercepted by the server and converted into a kill-and-respawn reload,
 * instead of being forwarded to the bridge.
 *
 * See change: headless-reload-via-respawn.
 *
 * Criteria (ALL must hold):
 *  - The message text is exactly "/reload" (no whitespace, no trailing args).
 *  - No images are attached (pure slash-command, not a user prompt).
 *  - The session's PID is tracked in `headlessPidRegistry.getPid(sessionId)`.
 *
 * The registry is our only source of truth for "this session is headless
 * right now" — it avoids adding a new `spawnStrategy` field to
 * `DashboardSession`.
 */
export function shouldInterceptReload(
  msg: SendPromptMsg,
  headlessPidRegistry: Pick<HeadlessPidRegistry, "getPid">,
): boolean {
  if (msg.text !== "/reload") return false;
  if ((msg.images?.length ?? 0) !== 0) return false;
  return headlessPidRegistry.getPid(msg.sessionId) !== undefined;
}
