/**
 * pi extension fixture: an E2E driver for `ctx.ui.notify`.
 *
 * The browser E2E harness has no other way to reach the notify path — the faux
 * model can only emit tool calls, and `ask_user` is a PromptBus request, not a
 * notification. This fixture registers one tool whose only job is to call
 * `ctx.ui.notify(message, level)`, so the faux scenario `notify-probe` drives
 * the REAL production path end to end:
 *
 *   ctx.ui.notify → bridge notify proxy → `{ type: "notify" }` → server notify
 *   log + sendToSubscribers → client notify reducer → NotifyRenderer row.
 *
 * `ctx` is captured at `session_start` because a tool's execute context does
 * not carry the extension `ctx.ui` surface the bridge patches.
 *
 * See change: split-notify-from-prompt-request.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function activate(pi: ExtensionAPI): void {
  let sessionCtx: any;

  pi.on("session_start" as any, (_event: any, ctx: any) => {
    sessionCtx = ctx;
  });

  pi.registerTool({
    name: "e2e_notify",
    label: "E2E Notify",
    description: "Test fixture: emit a fire-and-forget ctx.ui.notify notification.",
    parameters: Type.Object({
      message: Type.String({ description: "Notification text" }),
      level: Type.Optional(Type.String({ description: "info | success | warning | error" })),
    }),
    // pi passes the tool-call id FIRST; params are the second argument.
    async execute(_toolCallId: any, params: any) {
      sessionCtx?.ui?.notify?.(params?.message, params?.level);
      return { content: [{ type: "text", text: "notified" }] };
    },
  } as any);
}
