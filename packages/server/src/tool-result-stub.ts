/**
 * Strategy B (lazy-expand-full-fidelity): transform a finalized heavy tool
 * result into a stub during REPLAY so the wire never carries the (truncated)
 * body for a collapsed card. The stub advertises the true pre-truncation
 * `byteSize`, a short `preview`, and the stable `entryId` the full-fidelity
 * route keys on. Small results (no recorded `byteSize`) replay inline.
 *
 * Replay-only by construction → never stubs an in-flight/streaming result
 * (those flow on the live path, which this never touches).
 *
 * See change: reduce-session-replay-traffic.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Stub a tool result whose pre-truncation byteSize ≥ this (aligned to the
 *  4 KB in-memory truncation cap so anything that fits inline stays inline). */
export const STUB_BYTE_THRESHOLD = 4_000;
/** First N chars of the result kept as the collapsed-card preview. */
export const STUB_PREVIEW_CHARS = 200;

/**
 * Extract the text body of a tool result. Handles BOTH shapes the pipeline
 * produces: a flat string (disk replay via state-replay.ts) and the structured
 * `{ content: [{ type: "text", text }] }` object the LIVE bridge path forwards.
 * Returns undefined when no text body is present (e.g. image-only results).
 */
export function extractToolResultText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      return content
        .filter(
          (c): c is { text?: unknown } =>
            !!c && typeof c === "object" && (c as { type?: unknown }).type === "text",
        )
        .map((c) => (typeof c.text === "string" ? c.text : ""))
        .join("");
    }
  }
  return undefined;
}

export function maybeStubToolResult(event: DashboardEvent): DashboardEvent {
  if (event.eventType !== "tool_execution_end") return event;
  const data = event.data;
  if (!data || typeof data !== "object") return event;
  const byteSize = typeof data.byteSize === "number" ? data.byteSize : undefined;
  if (byteSize === undefined || byteSize < STUB_BYTE_THRESHOLD) return event;
  const entryId = typeof data.entryId === "string" ? data.entryId : undefined;
  // No stable fetch key → keep the (truncated) body inline so expand can't break.
  if (!entryId) return event;
  const result = extractToolResultText(data.result) ?? "";
  const { result: _omitFullBody, ...rest } = data;
  return {
    ...event,
    data: {
      ...rest,
      stub: true,
      byteSize,
      preview: result.slice(0, STUB_PREVIEW_CHARS),
      entryId,
    },
  };
}
