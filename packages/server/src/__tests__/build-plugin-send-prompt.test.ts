/**
 * `buildPluginSendPrompt` — pure builder of the `send_prompt` message the host
 * sends for `ctx.sendToSession`. `delivery` rides only when defined, so
 * two-argument callers produce the exact pre-change message.
 * Covers test-plan #S13, #S14. See change: add-rest-prompt-delivery-mode.
 * Harness: pure unit style of `build-push-payload.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { buildPluginSendPrompt } from "../build-plugin-send-prompt.js";

describe("buildPluginSendPrompt", () => {
  it.each([[undefined], [{}], [{ delivery: undefined }]])(
    "no delivery key for opts %j (#S13, #S14)",
    (opts) => {
      const msg = buildPluginSendPrompt("S", "hello", opts);
      expect(msg).toEqual({ type: "send_prompt", sessionId: "S", text: "hello" });
      expect("delivery" in msg).toBe(false);
    },
  );
  it.each(["steer", "followUp"] as const)("includes delivery %s (#S14)", (delivery) => {
    expect(buildPluginSendPrompt("S", "hi", { delivery })).toEqual({
      type: "send_prompt",
      sessionId: "S",
      text: "hi",
      delivery,
    });
  });
});
