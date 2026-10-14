/**
 * Best-effort context snapshot taken once when a question is first observed.
 *
 * Data flow (reviewed by the `Audit` subagent, task 3.4a):
 *   event store (in-memory) → this module → REDACT (`redactSecrets`, every
 *   string, incl. nested workflowRun values) → persisted question file AND
 *   the `@fast` generation prompt (`brief-prompt.ts` re-redacts its assembled
 *   text). Nothing un-redacted leaves this function.
 *
 * Redaction runs BEFORE the 8 KB slice so a secret straddling the cut cannot
 * leave a recognisable fragment.
 * See change: add-pending-question-stack (D2).
 */
import { REDACTION_VERSION, redactSecrets } from "@blackbelt-technology/pi-dashboard-shared/redaction.js";
import type { QuestionSnapshot, QuestionSnapshotToolCall } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import type { EventStore } from "../persistence/memory-event-store.js";

export const SNAPSHOT_ASSISTANT_TEXT_MAX = 8192;
export const SNAPSHOT_TOOL_CALLS_MAX = 5;
export const SNAPSHOT_TOOL_SUMMARY_MAX = 120;
/** Newest events scanned for text/tool calls (bounds the work per question). */
export const SNAPSHOT_SCAN_WINDOW = 1000;

/** The ask_user call is the question itself, not context for it. */
const EXCLUDED_TOOLS = new Set(["ask_user"]);
const SUMMARY_KEYS = ["command", "path", "file_path", "filePath", "pattern", "query", "url", "name", "description", "prompt"];

/** Redact every string in a JSON-like value; non-strings pass through. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v);
    return out as T;
  }
  return value;
}

function assistantTextOf(data: Record<string, unknown> | undefined): string {
  const msg = data?.message as { role?: unknown; content?: unknown } | undefined;
  if (msg?.role !== "assistant") return "";
  if (typeof msg.content === "string") return msg.content;
  if (!Array.isArray(msg.content)) return "";
  return msg.content
    .map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
    .join("");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function summarizeArgs(args: unknown): string {
  if (typeof args === "string") return oneLine(args);
  if (!args || typeof args !== "object") return "";
  const rec = args as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    if (typeof rec[key] === "string" && rec[key]) return oneLine(rec[key] as string);
  }
  for (const v of Object.values(rec)) if (typeof v === "string" && v) return oneLine(v);
  try {
    return oneLine(JSON.stringify(args) ?? "");
  } catch {
    return "";
  }
}

/**
 * Did the store drop events from the scanned range? Seq starts at 1 and the
 * store only trims (leaving gaps), so a missing head or an internal gap means
 * an absent assistant text may have been trimmed away rather than never sent.
 * The window's own first event is not a head when the window is full.
 */
function hasRetentionGap(events: ReadonlyArray<{ seq: number }>): boolean {
  if (events.length === 0) return false;
  if (events.length < SNAPSHOT_SCAN_WINDOW && events[0].seq > 1) return true;
  for (let i = 1; i < events.length; i++) if (events[i].seq - events[i - 1].seq > 1) return true;
  return false;
}

export interface SnapshotInput {
  eventStore: Pick<EventStore, "getMaxSeq" | "getEventsEndingAt">;
  sessionId: string;
  /** Prompt `metadata`; only `workflowRun` is read. */
  metadata?: Record<string, unknown>;
}

export function buildQuestionSnapshot(input: SnapshotInput): QuestionSnapshot {
  const { eventStore, sessionId, metadata } = input;
  const maxSeq = eventStore.getMaxSeq(sessionId);
  const events = maxSeq > 0 ? eventStore.getEventsEndingAt(sessionId, 0, maxSeq, SNAPSHOT_SCAN_WINDOW) : [];

  let assistantText: string | undefined;
  const tools: QuestionSnapshotToolCall[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const { event } = events[i];
    if (assistantText === undefined && event.eventType === "message_end") {
      const text = assistantTextOf(event.data);
      if (text.trim()) assistantText = text;
    } else if (tools.length < SNAPSHOT_TOOL_CALLS_MAX && event.eventType === "tool_execution_start") {
      const data = event.data ?? {};
      const name = typeof data.toolName === "string" ? data.toolName : "";
      if (!name || EXCLUDED_TOOLS.has(name) || data.parentToolCallId) continue;
      const summary = redactSecrets(summarizeArgs(data.args)).slice(0, SNAPSHOT_TOOL_SUMMARY_MAX);
      tools.push({ name: redactSecrets(name), summary });
    }
    if (assistantText !== undefined && tools.length >= SNAPSHOT_TOOL_CALLS_MAX) break;
  }
  tools.reverse();

  const snapshot: QuestionSnapshot = { toolCalls: tools, redactionVersion: REDACTION_VERSION };
  if (assistantText !== undefined) {
    snapshot.assistantText = redactSecrets(assistantText).slice(-SNAPSHOT_ASSISTANT_TEXT_MAX);
  } else {
    snapshot.assistantAbsentReason = hasRetentionGap(events) ? "evicted" : "none";
  }
  if (metadata && metadata.workflowRun !== undefined) snapshot.workflowRun = redactDeep(metadata.workflowRun);
  return snapshot;
}
