/**
 * `ctx.ui.notify` proxy. Calls pi's original notify, then forwards the message
 * to the dashboard on the dedicated `notify` channel — never through PromptBus
 * and never as a `prompt_request`, so the server's pending-prompt registry,
 * `currentTool` fold, unread stamp and `questionFirst` reorder never see it.
 * See change: split-notify-from-prompt-request.
 */
import { normalizeNotifyLevel } from "@blackbelt-technology/pi-dashboard-shared/notify.js";
import type { NotifyMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

export interface NotifyProxyOptions {
  sessionId: string;
  send: (msg: NotifyMessage) => void;
  originalNotify?: (message: string, level?: string) => void;
  /** Injectable for tests; defaults to `crypto.randomUUID`. */
  newId?: () => string;
}

export function createNotifyProxy(
  opts: NotifyProxyOptions,
): (message: string, level?: string) => void {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  return (message: string, level?: string) => {
    opts.originalNotify?.(message, level);
    opts.send({
      type: "notify",
      sessionId: opts.sessionId,
      notifyId: newId(),
      message,
      ...(level === undefined ? {} : { level: normalizeNotifyLevel(level) }),
    });
  };
}
