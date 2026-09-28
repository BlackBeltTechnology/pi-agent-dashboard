import type { EventForwardMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

/**
 * Extract only JSON-serializable fields from an event object.
 * Strips functions, AbortSignals, and other non-serializable values.
 */
function extractSerializable(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) {
      result[key] = value;
      continue;
    }
    if (typeof value === "function") continue;
    if (value instanceof AbortSignal) continue;
    if (typeof value === "object" && "aborted" in (value as object)) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Map a pi event object to an event_forward protocol message.
 */
export function mapEventToProtocol(
  sessionId: string,
  piEvent: Record<string, unknown>,
): EventForwardMessage {
  const serializable = extractSerializable(piEvent);

  return {
    type: "event_forward",
    sessionId,
    event: {
      eventType: (piEvent.type as string) ?? "unknown",
      timestamp: Date.now(),
      data: serializable,
    },
  };
}

/**
 * Bridge forwarding policy for `session_compact`: return a shallow COPY of the
 * event with `compactionEntry` omitted. Every other top-level field is
 * preserved.
 *
 * The field carries pi >= 0.86's prompt-sections + tool-declaration
 * `systemMessage` checkpoint and the compaction `summary`; no dashboard
 * consumer reads either (the client renders the divider from the event's
 * presence and the badge from `reason`/`willRetry`/`estimatedPostCompactionTokens`;
 * the server only clears the `compacting` latch).
 *
 * Copy, never mutate: pi's `ExtensionRunner.emit` hands the SAME event object
 * to every subscribed handler, so `delete event.compactionEntry` would strip the
 * field from unrelated extensions too. Applied at the bridge's `session_compact`
 * forwarding site — NOT inside {@link mapEventToProtocol}, which stays generic
 * over every forwarded event type.
 *
 * See OpenSpec change: filter-system-role-message-forwarding (D6/D7).
 */
export function redactCompactionEntry(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const forwarded: Record<string, unknown> = { ...event };
  delete forwarded.compactionEntry;
  return forwarded;
}
