/**
 * Best-effort context snapshot taken once when a question is first observed.
 *
 * Data flow (reviewed by the `Audit` subagent, task 3.4a):
 *   event store (in-memory) → this module → REDACT (`redactSecrets`, every
 *   string, incl. nested workflowRun values) → persisted question file AND
 *   the `@fast` generation prompt (`brief-prompt.ts` re-redacts its assembled
 *   text). Nothing un-redacted leaves this function.
 *
 * Inputs are capped (4 × 8 KB of assistant text, 4 KB per tool summary), then
 * redacted, THEN sliced to the stored size, so a secret straddling the final cut
 * cannot leave a recognisable fragment.
 * See change: add-pending-question-stack (D2).
 */
import { REDACTION_PLACEHOLDER, REDACTION_VERSION, redactSecrets } from "@blackbelt-technology/pi-dashboard-shared/redaction.js";
import type { QuestionSnapshot, QuestionSnapshotToolCall } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import type { EventStore } from "../persistence/memory-event-store.js";

export const SNAPSHOT_ASSISTANT_TEXT_MAX = 8192;
export const SNAPSHOT_TOOL_CALLS_MAX = 5;
export const SNAPSHOT_TOOL_SUMMARY_MAX = 120;
/** Newest events scanned for text/tool calls (bounds the work per question). */
export const SNAPSHOT_SCAN_WINDOW = 1000;
/** Input caps applied BEFORE redaction so regex work is bounded (a secret cut by them is cut again by the final slice). */
const ASSISTANT_TEXT_INPUT_MAX = 4 * SNAPSHOT_ASSISTANT_TEXT_MAX;
const TOOL_SUMMARY_INPUT_MAX = 4096;
/** Extra input past a head-slice cap so a secret straddling the cut is redacted whole first. */
const REDACTION_MARGIN_CHARS = 256;
/** Serialized `workflowRun` ceiling (after redaction); larger values are replaced by a placeholder. */
export const SNAPSHOT_WORKFLOW_RUN_MAX = 8192;

/** The ask_user call is the question itself, not context for it. */
const EXCLUDED_TOOLS = new Set(["ask_user"]);
const SUMMARY_KEYS = ["command", "path", "file_path", "filePath", "pattern", "query", "url", "name", "description", "prompt"];

/** Object keys whose value is a secret regardless of what it looks like. */
const SENSITIVE_KEY_RE = /pass(word|wd)?|secret|token|api[_-]?key|auth(orization)?|credential|private[_-]?key|cookie/i;
/** Nesting deeper than this is replaced (hostile input; also bounds recursion). */
export const REDACT_DEEP_MAX_DEPTH = 8;
const DEPTH_PLACEHOLDER = "[…]";

/**
 * Redact a JSON-like value: every string, plus the whole value under a
 * sensitive-looking key; anything nested deeper than `REDACT_DEEP_MAX_DEPTH`
 * is replaced. Non-strings pass through.
 */
export function redactDeep<T>(value: T, depth = 0): T {
  if (typeof value === "string") return redactSecrets(value) as unknown as T;
  if (!value || typeof value !== "object") return value;
  if (depth >= REDACT_DEEP_MAX_DEPTH) return DEPTH_PLACEHOLDER as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? REDACTION_PLACEHOLDER : redactDeep(v, depth + 1);
  }
  return out as T;
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

/** Replace an already-redacted `workflowRun` whose JSON exceeds the ceiling by a small placeholder. */
function capWorkflowRun(value: unknown): unknown {
  let size: number;
  try {
    size = JSON.stringify(value)?.length ?? 0;
  } catch {
    size = Number.POSITIVE_INFINITY;
  }
  return size <= SNAPSHOT_WORKFLOW_RUN_MAX ? value : { truncated: true, originalChars: Number.isFinite(size) ? size : null };
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
      const summary = redactSecrets(summarizeArgs(data.args).slice(0, TOOL_SUMMARY_INPUT_MAX + REDACTION_MARGIN_CHARS)).slice(0, SNAPSHOT_TOOL_SUMMARY_MAX);
      tools.push({ name: redactSecrets(name.slice(0, SNAPSHOT_TOOL_SUMMARY_MAX)), summary });
    }
    if (assistantText !== undefined && tools.length >= SNAPSHOT_TOOL_CALLS_MAX) break;
  }
  tools.reverse();

  const snapshot: QuestionSnapshot = { toolCalls: tools, redactionVersion: REDACTION_VERSION };
  if (assistantText !== undefined) {
    snapshot.assistantText = redactSecrets(assistantText.slice(-ASSISTANT_TEXT_INPUT_MAX)).slice(-SNAPSHOT_ASSISTANT_TEXT_MAX);
  } else {
    snapshot.assistantAbsentReason = hasRetentionGap(events) ? "evicted" : "none";
  }
  if (metadata && metadata.workflowRun !== undefined) snapshot.workflowRun = capWorkflowRun(redactDeep(metadata.workflowRun));
  return snapshot;
}
