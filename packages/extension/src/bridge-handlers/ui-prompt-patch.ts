/**
 * `ctx.ui` → PromptBus patch applied at `session_start`.
 *
 * Extracted from `bridge-handlers/lifecycle.ts` (change: test-trust-audit, design D2). Holds no
 * module-level state and never imports the bridge entry point.
 */

import type { ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { MAX_PER_MESSAGE_BYTES as ATTACH_MAX_PER_MESSAGE_BYTES, persistAttachment } from "../ask-user-attachments.js";
import { decodeMultiselectAnswer } from "../multiselect-decode.js";
import { createNotifyProxy } from "../notify-proxy.js";
import { buildPromptMeta } from "../prompt-meta.js";
import { createTuiPromptAdapter } from "../tui-prompt-adapter.js";
import type { PromptBus } from "../prompt-bus.js";
import type { BridgeInstance } from "./instance.js";

/**
 * Capture the original `ctx.ui` dialog methods, register the TUI adapter against them, then
 * replace `ctx.ui.select/input/confirm/editor/multiselect/batch/inputWithImages/notify` with
 * PromptBus wrappers so every extension prompt routes through the bus to the dashboard.
 *
 * Order matters: the originals are captured BEFORE patching and the TUI adapter is registered
 * BEFORE patching (it presents prompts through the unpatched methods).
 * See changes: fix-multiselect-tui-arm-self-cancel, split-notify-from-prompt-request.
 */
export function patchUiForPromptBus(inst: BridgeInstance, ctx: any, promptBus: PromptBus): void {
    // Capture original ctx.ui method references BEFORE patching
    const originalNotify = ctx.ui.notify?.bind(ctx.ui);
    const originals = {
      select: ctx.ui.select?.bind(ctx.ui) as ((q: string, opts: string[], extra?: any) => Promise<string | undefined>) | undefined,
      input: ctx.ui.input?.bind(ctx.ui) as ((q: string, placeholder?: string, extra?: any) => Promise<string | undefined>) | undefined,
      confirm: ctx.ui.confirm?.bind(ctx.ui) as ((q: string, msg: string, extra?: any) => Promise<boolean>) | undefined,
      editor: ctx.ui.editor?.bind(ctx.ui) as ((q: string, prefill?: string, extra?: any) => Promise<string | undefined>) | undefined,
      // NOTE: the `custom` field is intentionally NOT captured here. A
      // previous change (fix-multiselect-auto-cancel-on-dashboard) added a
      // TUI multiselect arm that awaited the original ctx.ui.custom binding,
      // but pi 0.70's RPC mode defines that primitive as a no-op (returns
      // undefined synchronously), causing the TUI adapter to auto-cancel the
      // dashboard-rendered dialog within one event-loop tick. The arm has
      // been removed; see change fix-multiselect-tui-arm-self-cancel for full
      // rationale. A repo lint (no-tui-multiselect-arm-regression.test.ts)
      // prevents reintroduction by banning the co-occurrence of two
      // substrings (the captured original binding and the TUI arm match).
    };

    // Register TUI adapter — presents prompts in the terminal using original
    // (unpatched) ctx.ui methods. Must be registered BEFORE patching ctx.ui.
    if (ctx.hasUI) {
      promptBus.registerAdapter(createTuiPromptAdapter(originals, promptBus));
    }

    // Replace ctx.ui dialog methods with PromptBus wrappers.
    // All extension commands that call ctx.ui.select/input/confirm/editor
    // now route through the bus, which distributes to all registered adapters.
    {
      const bus = promptBus;
      // Build a `metadata` envelope for bus.request that includes both
      // `message` (existing) and `toolCallId` (new — added by change
      // `fix-interactive-ui-reorder` so the client reducer can pair the
      // resulting interactiveUi row with its parent toolResult row).
      // Free-floating callers (slash commands, architect prompts) omit
      // `opts.toolCallId` and the metadata field stays undefined.
      // Also carries an optional namespaced `opts.pluginMeta` → `metadata.plugin`
      // (validated; see prompt-meta.ts). See change: add-browser-editor-pane-tab.
      const buildMeta = (opts: any, explicitMessage?: string) => buildPromptMeta(opts, explicitMessage);

      (ctx.ui as any).select = (title: string, options: string[], opts?: any) =>
        bus.request({ pipeline: "command", type: "select", question: title, options, metadata: buildMeta(opts) })
          .then(r => r.cancelled ? undefined : r.answer);

      (ctx.ui as any).input = (title: string, placeholder?: string, opts?: any) =>
        bus.request({ pipeline: "command", type: "input", question: title, defaultValue: placeholder, metadata: buildMeta(opts) })
          .then(r => r.cancelled ? undefined : r.answer);

      // Persist pasted images for an ask_user input answer to disk + emit one
      // asset_register per new hash (dashboard thumbnail). Returns absolute
      // paths the LLM can Read. Drops over per-image / cumulative caps.
      // Closes over sessionId, connection, getEmittedAssetHashes (all in
      // scope here). See change: add-ask-user-input-multiline-paste.
      const persistAnswerImages = (
        images: ImageContent[],
      ): Array<{ path: string; mimeType: string; bytes: number }> => {
        const out: Array<{ path: string; mimeType: string; bytes: number }> = [];
        const emitted = inst.getEmittedAssetHashes(inst.sessionId);
        let cumulative = 0;
        for (const image of images) {
          const persisted = persistAttachment({ sessionId: inst.sessionId, image });
          if (!persisted) continue;
          if (cumulative + persisted.bytes > ATTACH_MAX_PER_MESSAGE_BYTES) {
            console.warn(`[bridge] ask_user image over cumulative cap dropped (${persisted.hash})`);
            continue;
          }
          cumulative += persisted.bytes;
          if (!emitted.has(persisted.hash)) {
            emitted.add(persisted.hash);
            inst.connection.send({
              type: "asset_register",
              sessionId: inst.sessionId,
              hash: persisted.hash,
              mimeType: persisted.mimeType,
              data: image.data,
            });
          }
          out.push({ path: persisted.path, mimeType: persisted.mimeType, bytes: persisted.bytes });
        }
        return out;
      };

      // ctx.ui.inputWithImages is NOT a built-in pi method. The ask_user tool
      // calls it for method:"input" so pasted images survive (ctx.ui.input
      // decodes to a bare string, dropping PromptResponse.images). Resolves
      // to: undefined (cancel) | string (no images) | {value, attachments}
      // (images). See change: add-ask-user-input-multiline-paste, design.md
      // Decision 1.
      (ctx.ui as any).inputWithImages = (title: string, placeholder?: string, opts?: any) =>
        bus.request({ pipeline: "command", type: "input", question: title, defaultValue: placeholder, metadata: buildMeta(opts) })
          .then(r => {
            if (r.cancelled) return undefined;
            const atts = r.images?.length ? persistAnswerImages(r.images) : [];
            return atts.length ? { value: r.answer ?? "", attachments: atts } : (r.answer ?? "");
          });

      (ctx.ui as any).confirm = (title: string, message?: string, opts?: any) =>
        bus.request({ pipeline: "command", type: "confirm", question: title, metadata: buildMeta(opts, message) })
          .then(r => !r.cancelled && r.answer === "true");

      (ctx.ui as any).editor = (title: string, prefill?: string, opts?: any) =>
        bus.request({ pipeline: "command", type: "editor", question: title, defaultValue: prefill, metadata: buildMeta(opts) })
          .then(r => r.cancelled ? undefined : r.answer);

      // ── Multiselect ──────────────────────────────────────────────
      // ctx.ui.multiselect is NOT a built-in pi method — we attach it here
      // so that polyfillMultiselect (and any other consumer) routes through
      // PromptBus. The dashboard adapter renders a real browser dialog via
      // MultiselectRenderer; there is intentionally no TUI adapter arm for
      // multiselect (pi 0.70 RPC mode's ctx.ui.custom is a no-op, so any TUI
      // arm would auto-cancel the dashboard render in <1s). See changes
      // fix-multiselect-auto-cancel-on-dashboard (initial bus routing) and
      // fix-multiselect-tui-arm-self-cancel (TUI arm removal).
      if (typeof (ctx.ui as any).multiselect === "function") {
        // Defensive: future upstream pi may add a built-in multiselect.
        // Override is intentional — the bus-routed version is what
        // participates in PromptBus first-response-wins semantics.
        // eslint-disable-next-line no-console
        console.warn("[bridge] ctx.ui.multiselect already exists — overriding for PromptBus routing");
      }
      (ctx.ui as any).multiselect = (title: string, options: string[], opts?: any) =>
        bus.request({
          pipeline: "command",
          type: "multiselect",
          question: title,
          options,
          metadata: buildMeta(opts),
        }).then(decodeMultiselectAnswer);

      // ── Batch ────────────────────────────────────────────────────
      // ctx.ui.batch is NOT a built-in pi method. The ask_user tool calls it
      // to dispatch a multi-question batch as ONE bus request carrying
      // `questions[]` in metadata; the dashboard renders a BatchRenderer
      // wizard and returns one `{answers}` response (JSON-encoded in the bus
      // `answer` string). Resolves to BatchAnswer[] on submit, or undefined on
      // cancel. See change: redesign-ask-user-question-cards.
      (ctx.ui as any).batch = (title: string, questions: unknown[], opts?: any) =>
        bus.request({
          pipeline: "command",
          type: "batch",
          question: title,
          metadata: { ...(buildMeta(opts) ?? {}), questions },
        }).then((r) => {
          if (r.cancelled || r.answer == null) return undefined;
          try {
            const parsed = JSON.parse(r.answer);
            if (!Array.isArray(parsed)) return undefined;
            // Persist any input-step images and rewrite that answer to
            // {value, attachments}, dropping the raw base64 `images`.
            // See change: add-ask-user-input-multiline-paste.
            return parsed.map((a: any) => {
              if (a && typeof a === "object" && Array.isArray(a.images) && a.images.length) {
                const atts = persistAnswerImages(a.images);
                const { images: _drop, ...rest } = a;
                return atts.length ? { ...rest, attachments: atts } : rest;
              }
              return a;
            });
          } catch {
            return undefined;
          }
        });

      // Notify is fire-and-forget: call original + forward to dashboard on the
      // dedicated `notify` channel. See change: split-notify-from-prompt-request.
      (ctx.ui as any).notify = createNotifyProxy({
        sessionId: inst.sessionId,
        send: (msg) => inst.connection.send(msg),
        originalNotify,
      });
    }
}
