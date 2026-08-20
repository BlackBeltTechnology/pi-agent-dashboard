/**
 * Pure helpers for session-action-handler.
 *
 * Extracted so they can be unit-tested without the surrounding I/O surface
 * (pi-gateway, event store, headless-pid-registry wiring).
 */

import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

type SendPromptMsg = Extract<BrowserToServerMessage, { type: "send_prompt" }>;

/**
 * Return true iff a `send_prompt` message is the bare `/reload` slash command
 * and therefore belongs on the server's reload path (`dispatchReload`) rather
 * than being forwarded to the bridge as an ordinary prompt.
 *
 * Criteria (BOTH must hold):
 *  - The message text is exactly "/reload" (no whitespace, no trailing args).
 *  - No images are attached (pure slash-command, not a user prompt).
 *
 * Deliberately says nothing about the session's shape. Choosing *how* to
 * deliver the reload — keeper dispatch, respawn fallback, or bridge forward —
 * is `dispatchReload`'s ladder, and folding a headless-PID test in here is
 * what made kill-and-respawn the default for every headless session.
 *
 * See change: fix-out-of-band-reload (was `shouldInterceptReload`, change:
 * headless-reload-via-respawn).
 */
export function isBareReloadCommand(msg: SendPromptMsg): boolean {
  if (msg.text !== "/reload") return false;
  return (msg.images?.length ?? 0) === 0;
}
