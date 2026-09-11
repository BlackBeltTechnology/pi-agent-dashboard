/**
 * pi extension fixture: an E2E driver for the custom-entry surfaces.
 *
 * The faux model can only emit tool calls, so there is no scripted way to
 * reach `pi.sendMessage` / `pi.appendEntry` — the same gap `e2e_notify` fills
 * for `ctx.ui.notify`. This fixture registers two tools whose only job is to
 * call the REAL extension APIs, driving the real production path end to end:
 *
 *   e2e_custom_message → pi.sendMessage → CustomMessageEntry + message_end
 *     (role:"custom") → bridge enriched forward → client reducer role=custom
 *   e2e_custom_entry   → pi.appendEntry → CustomEntry + entry_appended →
 *     bridge custom_entry forward → client reducer custom_entry
 *
 * Timing note: `pi.sendMessage` while a turn is STREAMING only steers/follows
 * up — it appends nothing and emits no chat events at call time. Real
 * extensions send custom messages between turns; the fixture mirrors that by
 * queueing tool requests and flushing them on `agent_settled`.
 * `pi.appendEntry` has no such constraint (it appends + emits synchronously),
 * so entry requests flush immediately.
 *
 * See change: render-inline-reasoning-and-custom-entries.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * Summary text the canned compaction writes. Distinctive so a spec can prove
 * the persisted `summary` is NOT rendered into the transcript.
 * See change: replay-compaction-boundary.
 */
export const E2E_COMPACTION_SUMMARY =
  "E2E-COMPACTION-SUMMARY: earlier turns collapsed by the fixture compactor";

export default function activate(pi: ExtensionAPI): void {
  let pendingMessages: Array<{ customType: string; content: string; display: boolean }> = [];

  // Deterministic compaction (change: replay-compaction-boundary). A `/compact`
  // command calls `ctx.compact()`, which runs `session_before_compact` before
  // any model call; returning a canned `compaction` result lets the replay
  // specs produce a real persisted `compaction` entry with no faux
  // summarization round-trip (which would consume a scenario step).
  pi.on("session_before_compact" as any, (event: any) => {
    const firstKeptEntryId = event?.preparation?.firstKeptEntryId;
    if (typeof firstKeptEntryId !== "string") return undefined; // fall through
    return {
      compaction: {
        summary: E2E_COMPACTION_SUMMARY,
        firstKeptEntryId,
        tokensBefore: event?.preparation?.tokensBefore ?? 0,
      },
    };
  });

  pi.on("agent_settled" as any, () => {
    const batch = pendingMessages;
    pendingMessages = [];
    for (const m of batch) {
      pi.sendMessage({ customType: m.customType, content: m.content, display: m.display });
    }
  });

  pi.registerTool({
    name: "e2e_custom_message",
    label: "E2E Custom Message",
    description:
      "Test fixture: queue a custom message sent via pi.sendMessage after the turn settles.",
    parameters: Type.Object({
      customType: Type.String({ description: "Extension customType label" }),
      content: Type.String({ description: "Message body text" }),
      display: Type.Optional(
        Type.Boolean({ description: "false = LLM-context-only (hidden from chat)" }),
      ),
    }),
    // pi passes the tool-call id FIRST; params are the second argument.
    async execute(_toolCallId: any, params: any) {
      pendingMessages.push({
        customType: String(params?.customType ?? "e2e:untyped"),
        content: String(params?.content ?? ""),
        display: params?.display !== false,
      });
      return { content: [{ type: "text", text: "queued" }] };
    },
  } as any);

  pi.registerTool({
    name: "e2e_custom_entry",
    label: "E2E Custom Entry",
    description: "Test fixture: append a custom entry via pi.appendEntry.",
    parameters: Type.Object({
      customType: Type.String({ description: "Extension customType label" }),
      data: Type.Optional(
        Type.String({ description: "JSON string payload (parsed before append)" }),
      ),
    }),
    async execute(_toolCallId: any, params: any) {
      let data: unknown = params?.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          /* keep the raw string */
        }
      }
      pi.appendEntry(String(params?.customType ?? "e2e:entry"), data);
      return { content: [{ type: "text", text: "appended" }] };
    },
  } as any);
}
