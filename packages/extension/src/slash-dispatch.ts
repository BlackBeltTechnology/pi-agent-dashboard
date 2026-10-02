/**
 * Shared extension-slash-command dispatch branch used by both bridge.ts
 * (sessionPrompt callback) and command-handler.ts (slash else-arm fallback).
 *
 * Routing-step 9 from `command-routing` spec — ONE in-process call:
 *   `pi.sendUserMessage(text, {expandPromptTemplates: true, deliverAs})`.
 *   pi's own `prompt()` runs `_tryExecuteExtensionCommand` BEFORE the
 *   compaction guard and BEFORE `streamingBehavior` is consulted, so the
 *   handler executes immediately in every session shape (dashboard headless,
 *   tmux, Windows Terminal).
 *
 * Verified on pi 1.0.0 (the version `packages/server/package.json` pins as both
 * `minimum` and `recommended`) at these exact refs — re-verify after a pi bump:
 *   - `dist/core/agent-session.js` L1486 `expandPromptTemplates ?? true` and
 *     L1491 `_tryExecuteExtensionCommand` FIRST (handler impl at L1600), AHEAD
 *     of the compaction guard at L1498 — so compaction can never block a
 *     dispatched extension command.
 *   - `dist/core/agent-session.js` L1834 `sendUserMessage()` → `prompt(text,
 *     {expandPromptTemplates: options?.expandPromptTemplates ?? false,
 *     streamingBehavior: options?.deliverAs, source:"extension"})` — that
 *     `false` default (L1835) is why this helper MUST pass the flag explicitly.
 *   - `dist/core/extensions/loader.js` L301-304 — `ExtensionAPI.sendUserMessage`
 *     is `assertActive()` + a void call: a stale ctx throws synchronously, while
 *     every failure INSIDE `prompt()` becomes a swallowed rejection routed to
 *     `runner.emitError` (unobservable from the bridge). Handler outcome is
 *     therefore not surfaced — an accepted trade-off, uniform across session
 *     kinds and identical in kind to the retired Path C's optimistic
 *     `completed`.
 *
 * No pi version gate: pi 1.0.0 is the single supported pi (lockstep floor), so
 * the retired `>= 0.84.2` check could never fail on a supported install. A
 * session on an older global pi is flagged once, generically, by the server's
 * below-floor signal instead of per feature.
 *
 * Retired surface: Path B (`pi.dispatchCommand`, never shipped upstream), Path C
 * (`dispatch_extension_command` → server → keeper UDS → pi stdin), Path D
 * (tmux / Windows Terminal error feedback), the `connection` parameter, the
 * `DispatchConnection` type, and (update-pi-core-1-0-adopt-apis) the version
 * gate with `supportsInProcessCommandDispatch` and the injectable reader.
 *
 * Feedback contract: EXACTLY ONE `started` event AND EXACTLY ONE terminal event
 * (`completed` xor `error`) per dispatch. The call sits inside the try, so no
 * throw can escape between `started` and the terminal event. The existing
 * `emitFeedback` no-ops when `sink` is undefined.
 *
 * Non-extension text returns `false` so the caller can fall through to its
 * existing template-expansion / `sendUserMessage` path.
 *
 * See change: fix-extension-slash-commands-in-dashboard,
 *             add-rpc-stdin-dispatch-with-keeper-sidecar,
 *             fix-slash-dispatch-delivery,
 *             retire-slash-dispatch-via-expand-prompt-templates,
 *             update-pi-core-1-0-adopt-apis.
 */
import type { ExtensionToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { isExtensionSlashCommand } from "./bridge-context.js";

export type FeedbackSink = (msg: ExtensionToServerMessage) => void;

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
 *          dispatch attempted, or a throw reported). The
 *          caller MUST NOT fall through to template expansion or
 *          `sendUserMessage`.
 * @returns `false` if `text` is not an extension slash command, or if
 *          `getCommands()` threw on a stale ctx. The caller SHOULD continue
 *          with its existing fallback path.
 */
export async function tryDispatchExtensionCommand(
  pi: unknown,
  text: string,
  sessionId: string,
  sink: FeedbackSink | undefined,
  delivery?: "steer" | "followUp",
): Promise<boolean> {
  // Detection stays inside this helper so a stale ctx during dispose returns
  // false and the caller falls through — callers never evaluate detection.
  let commands: Array<{ name: string; source?: string }> = [];
  try {
    const got = (pi as any)?.getCommands?.();
    if (Array.isArray(got)) commands = got;
  } catch (err) {
    console.warn("[dashboard] getCommands stale on slash-dispatch", err);
    return false;
  }

  if (!isExtensionSlashCommand(text, commands)) return false;

  emitFeedback(sink, sessionId, text, "started");
  try {
    // pi consults `streamingBehavior` only AFTER `_tryExecuteExtensionCommand`,
    // so for an extension command `deliverAs` is inert — forwarded for
    // uniformity with the other sendUserMessage sites.
    await (pi as any).sendUserMessage(text, {
      expandPromptTemplates: true,
      deliverAs: delivery ?? "followUp",
    });
    emitFeedback(sink, sessionId, text, "completed");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    emitFeedback(sink, sessionId, text, "error", message);
  }
  return true;
}
