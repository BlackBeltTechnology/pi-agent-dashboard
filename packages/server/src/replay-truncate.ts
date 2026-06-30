/**
 * Strategy B (reduce-session-replay-traffic), reconciled onto develop's
 * adopt-pi-071-072-073-features tool-output mechanism.
 *
 * The client reducer already truncates a tool result to the LAST 200 lines for
 * display (`truncateOutputForDisplay`, marker `«N earlier lines hidden»`) and
 * fetches the full body on demand by `toolCallId` from the in-memory store. So
 * shipping the FULL result on every replay wastes bytes — the client discards
 * all but the last 200 lines for display anyway.
 *
 * This pre-truncates a heavy tool_execution_end result to that SAME display form
 * during REPLAY ONLY, trimming replay bytes. The in-memory store keeps the full
 * result, so develop's "Show full output" route still serves it. The client's
 * `truncateOutputForDisplay` is idempotent on the marker (skips re-truncation),
 * so the pre-truncated form renders identically to the live path.
 *
 * COUPLING: the algorithm + marker MUST match
 * `packages/client/src/lib/event-reducer.ts` `truncateOutputForDisplay` /
 * `toDisplayString` / `extractContentBlockText`. Kept in lockstep deliberately;
 * a mismatch only changes the displayed line count, never correctness (full body
 * stays fetchable).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const MAX_DISPLAY_LINES = 200;
/** Exact display-form header, so a raw result merely starting with « is not
 *  mistaken for already-truncated (which would ship the full body). */
const TRUNCATION_HEADER_RE = /^«\d+ earlier lines hidden»\n/;

function extractContentBlockText(blocks: unknown[]): string | null {
  const texts = blocks
    .filter((b): b is { text: string } => {
      const o = b as { type?: unknown; text?: unknown } | null;
      return !!o && o.type === "text" && typeof o.text === "string";
    })
    .map((b) => b.text);
  return texts.length > 0 ? texts.join("\n") : null;
}

/** Mirror of the client `toDisplayString`. */
function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return extractContentBlockText(value) ?? JSON.stringify(value, null, 2);
    }
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.content)) {
      return extractContentBlockText(obj.content) ?? JSON.stringify(value, null, 2);
    }
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

/**
 * Pre-truncate a replayed tool_execution_end result to the display form when it
 * exceeds MAX_DISPLAY_LINES. Returns the event unchanged when small or not a
 * tool result. Never mutates the input (returns a copy when it rewrites).
 */
export function truncateToolResultForReplay(event: DashboardEvent): DashboardEvent {
  if (event.eventType !== "tool_execution_end") return event;
  const data = event.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return event;
  const str = toDisplayString(data.result);
  if (TRUNCATION_HEADER_RE.test(str)) return event; // already display form
  const lines = str.split("\n");
  if (lines.length <= MAX_DISPLAY_LINES) return event; // small → leave inline
  const dropped = lines.length - MAX_DISPLAY_LINES;
  const truncated = `«${dropped} earlier lines hidden»\n${lines.slice(-MAX_DISPLAY_LINES).join("\n")}`;
  return { ...event, data: { ...data, result: truncated } };
}
