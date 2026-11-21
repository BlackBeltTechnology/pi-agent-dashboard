/**
 * Build the `send_prompt` message behind `ctx.sendToSession`. `delivery` is
 * included only when provided, so two-argument callers produce the exact
 * pre-existing message and the bridge keeps treating absence as `followUp`.
 * See change: add-rest-prompt-delivery-mode.
 */
export function buildPluginSendPrompt(
  sessionId: string,
  text: string,
  opts?: { delivery?: "steer" | "followUp" },
): { type: "send_prompt"; sessionId: string; text: string; delivery?: "steer" | "followUp" } {
  return {
    type: "send_prompt",
    sessionId,
    text,
    ...(opts?.delivery !== undefined ? { delivery: opts.delivery } : {}),
  };
}
