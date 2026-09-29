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
      // Repeat the SAME notify N times in one call (default 1), optionally
      // spaced by `intervalMs` so a run can be watched growing live.
      // See change: collapse-and-order-notify-rows.
      count: Type.Optional(Type.Number({ description: "How many identical notifies to emit (default 1)" })),
      intervalMs: Type.Optional(Type.Number({ description: "Delay between repeats in ms (default 0)" })),
    }),
    // pi passes the tool-call id FIRST; params are the second argument.
    async execute(_toolCallId: any, params: any) {
      // Fail loudly: returning "notified" without a notify would make every
      // spec that asserts on the rendered row vacuously green.
      if (typeof sessionCtx?.ui?.notify !== "function") {
        throw new Error("e2e_notify: ctx.ui.notify unavailable (session_start ctx not captured)");
      }
      const count = Math.max(1, Math.floor(Number(params?.count ?? 1)) || 1);
      const intervalMs = Math.max(0, Number(params?.intervalMs ?? 0) || 0);
      for (let i = 0; i < count; i++) {
        if (i > 0 && intervalMs > 0) await new Promise((r) => setTimeout(r, intervalMs));
        sessionCtx.ui.notify(params?.message, params?.level);
      }
      return { content: [{ type: "text", text: "notified" }] };
    },
  } as any);
}
