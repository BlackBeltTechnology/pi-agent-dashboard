/**
 * State replay — synthesizes dashboard events from pi session entries
 * so the browser can rebuild the chat view after a reconnect or DB reset.
 */
import type { EventForwardMessage } from "./protocol.js";

/**
 * Convert pi session entries (from ctx.sessionManager.getBranch())
 * into dashboard event_forward messages that the event reducer can process.
 *
 * Only generates the minimal events needed to rebuild the chat view:
 * - message_start for user messages
 * - message_update + message_end for assistant messages
 * - tool_execution_start / tool_execution_end for tool calls
 * - model_select for model changes
 *
 * NOTE on entryId (per change: fix-per-message-fork):
 * Replay reads from the persisted JSONL, so each entry already has a
 * stable `id`. We attach it directly as `entryId` on both `message_start`
 * (user) and `message_end` (assistant) events. Replay therefore does NOT
 * need to emit an `entry_persisted` follow-up — the back-fill protocol
 * exists to bridge a timing gap that only happens for LIVE pi events on
 * pi 0.69+, where the bridge sees `message_start` before pi has assigned
 * the entry id. Replay has no such gap.
 */
/**
 * @param knownContextWindow Optional override for the context window size,
 *   typically `session.contextWindow` from `.meta.json` (which was persisted
 *   from a live `turn_end` event). When provided, it is used in place of the
 *   `inferContextWindow(modelId)` heuristic for every synthesized
 *   `stats_update` event. The heuristic ignores Sonnet's 1M variant and
 *   pins Claude to 200k, so passing the persisted value avoids a brief
 *   200k flicker on reload before the next live `turn_end` arrives.
 */
export function replayEntriesAsEvents(
  sessionId: string,
  entries: any[],
  knownContextWindow?: number,
): EventForwardMessage[] {
  const messages: EventForwardMessage[] = [];
  const openToolCalls = new Set<string>(); // track tool calls without results
  // Persisted flow-run events (change: replay-persisted-flow-runs). Collected
  // during the loop, then emitted sorted by seq so the client's idempotent
  // reduceFlowEvent rebuilds the flow card identically to the live path.
  const flowEventRecords: Array<{ seq: number; eventType: string; data: unknown; ts: number }> = [];

  let currentModel = "";

  for (const entry of entries) {
    if (!entry || !entry.type) continue;
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

    if (entry.type === "model_change") {
      currentModel = entry.modelId ?? "";
    }

    // Persisted flow-run event: { seq, eventType, data, flowRunId }. eventType
    // is already the dashboard protocol name — re-forward verbatim, no re-map.
    // Duck-typed: no import from pi-flows. Malformed records skipped.
    if (entry.type === "custom" && entry.customType === "flow-event") {
      const rec = entry.data as { seq?: unknown; eventType?: unknown; data?: unknown } | undefined;
      if (rec && typeof rec.eventType === "string") {
        flowEventRecords.push({
          seq: typeof rec.seq === "number" ? rec.seq : 0,
          eventType: rec.eventType,
          data: rec.data,
          ts,
        });
      }
    }

    if (entry.type === "message" && entry.message) {
      const msg = entry.message;

      if (msg.role === "user") {
        messages.push(makeEvent(sessionId, "message_start", ts, { message: msg, entryId: entry.id }));
      }

      if (msg.role === "assistant") {
        const content = Array.isArray(msg.content) ? msg.content : [];
        // Emit tool_execution_start for each tool call
        for (const part of content) {
          if (part.type === "toolCall") {
            messages.push(makeEvent(sessionId, "tool_execution_start", ts, {
              toolCallId: part.id,
              toolName: part.name,
              args: typeof part.arguments === "string"
                ? tryParseJson(part.arguments)
                : part.arguments,
            }));
            openToolCalls.add(part.id);
          }
        }
        // Emit message_update (sets streamingText) then message_end (finalizes)
        messages.push(makeEvent(sessionId, "message_update", ts, { message: msg }));
        messages.push(makeEvent(sessionId, "message_end", ts, { message: msg, entryId: entry.id }));

        // Emit stats_update if usage data is present
        const usage = msg.usage as Record<string, unknown> | undefined;
        if (usage) {
          const cost = usage.cost as Record<string, number> | undefined;
          const totalTokens = usage.totalTokens as number | undefined;
          const statsData: Record<string, unknown> = {
            tokensIn: (usage.input as number) ?? 0,
            tokensOut: (usage.output as number) ?? 0,
            cost: cost?.total ?? 0,
            turnUsage: {
              input: (usage.input as number) ?? 0,
              output: (usage.output as number) ?? 0,
              cacheRead: (usage.cacheRead as number) ?? 0,
              cacheWrite: (usage.cacheWrite as number) ?? 0,
            },
          };
          // Include context usage estimate from totalTokens
          if (totalTokens && totalTokens > 0) {
            statsData.contextUsage = {
              tokens: totalTokens,
              contextWindow: knownContextWindow ?? inferContextWindow(currentModel),
            };
          }
          messages.push(makeEvent(sessionId, "stats_update", ts, statsData));
        }
      }

      // Tool results: toolCallId and toolName are at the message level
      // Structure: { role: "toolResult", toolCallId, toolName, content: [{type:"text",text:"..."}], isError }
      if (msg.role === "toolResult" && msg.toolCallId) {
        const resultText = Array.isArray(msg.content)
          ? msg.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("")
          : typeof msg.content === "string" ? msg.content : "";
        // Extract image content blocks if present
        const imageBlocks = Array.isArray(msg.content)
          ? msg.content.filter((c: any) => c.type === "image" && c.data && c.mimeType)
          : [];
        const eventData: Record<string, unknown> = {
          toolCallId: msg.toolCallId,
          toolName: msg.toolName ?? "unknown",
          result: resultText,
          isError: msg.isError ?? false,
        };
        if (imageBlocks.length > 0) {
          eventData.images = imageBlocks.map((c: any) => ({ data: c.data, mimeType: c.mimeType }));
        }
        // Include tool details (e.g. AgentDetails from pi-subagents) if present
        if (msg.details && typeof msg.details === "object") {
          eventData.details = msg.details;
        }
        messages.push(makeEvent(sessionId, "tool_execution_end", ts, eventData));
        openToolCalls.delete(msg.toolCallId);
      }
    }

    if (entry.type === "model_change") {
      messages.push(makeEvent(sessionId, "model_select", ts, {
        type: "model_select",
        model: { provider: entry.provider, id: entry.modelId },
      }));
    }
  }

  // Close any orphaned tool calls (agent killed mid-execution)
  for (const toolCallId of openToolCalls) {
    const startEvent = messages.find(
      (m) => m.event.eventType === "tool_execution_start" && (m.event.data as any).toolCallId === toolCallId,
    );
    const ts = startEvent ? startEvent.event.timestamp : Date.now();
    messages.push(makeEvent(sessionId, "tool_execution_end", ts, {
      toolCallId,
      toolName: (startEvent?.event.data as any)?.toolName ?? "unknown",
      result: "",
      isError: false,
    }));
  }

  // Emit persisted flow-run events sorted by seq (defensive: file order already
  // matches seq, but parallel agents emit concurrently). Appended after message
  // replay — flow and message reducers are independent, so relative order does
  // not matter; only seq order WITHIN flow events does.
  flowEventRecords.sort((a, b) => a.seq - b.seq);
  for (const rec of flowEventRecords) {
    messages.push(makeEvent(sessionId, rec.eventType, rec.ts, (rec.data ?? {}) as Record<string, unknown>));
  }

  return messages;
}

function makeEvent(
  sessionId: string,
  eventType: string,
  timestamp: number,
  data: Record<string, unknown>,
): EventForwardMessage {
  return {
    type: "event_forward",
    sessionId,
    event: {
      eventType,
      timestamp,
      data: { type: eventType, ...data },
    },
  };
}

function tryParseJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}

/** Infer context window size from model ID */
function inferContextWindow(modelId: string): number {
  const id = modelId.toLowerCase();
  if (id.includes("claude") && (id.includes("opus") || id.includes("sonnet") || id.includes("haiku"))) return 200_000;
  if (id.includes("gpt-4o")) return 128_000;
  if (id.includes("gpt-4")) return 128_000;
  if (id.includes("o1") || id.includes("o3") || id.includes("o4")) return 200_000;
  if (id.includes("gemini")) return 1_000_000;
  if (id.includes("deepseek")) return 128_000;
  return 200_000; // safe default
}
