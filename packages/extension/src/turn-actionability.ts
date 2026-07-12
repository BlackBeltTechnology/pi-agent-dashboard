/**
 * classifyTurnActionability — pure, provider-agnostic classification of an
 * assistant turn's terminal shape.
 *
 * Captured defect (live): `google-vertex/gemini-2.5-pro` on a heavy first
 * agentic turn returned `content = [thinking]` only — zero text parts, no
 * tool call, `stopReason = "stop"`, `error = {}` — and pi/dashboard treated
 * that clean-but-empty completion as finished, idling the session silently.
 * This function labels that shape `empty-actionable` so the bridge guard can
 * continue-or-surface instead of idling.
 *
 * Classification depends on TURN SHAPE ONLY (stop reason + content parts +
 * error presence), never on provider identity — the guard applies to any
 * reasoning-capable model that can emit reasoning-then-stop.
 *
 * See change: fix-gemini-subagent-silent-tool-schema-failure.
 */

export type TurnActionability = "normal" | "empty-actionable" | "truncated" | "error";

/** Minimal shape plucked from a pi assistant message (message_end / agent_end). */
export interface ClassifiableTurn {
  role?: string;
  stopReason?: string;
  /** pi content: an array of parts, or (some providers) a bare string. */
  content?: unknown;
  /** Present on a terminal error turn. */
  errorMessage?: string;
  /** pi may attach an `error` object; `{}` counts as no error. */
  error?: unknown;
}

/**
 * Stop reasons that indicate the provider truncated output (ran out of the
 * token budget). Handled separately from empty-actionable — a truncation is
 * not a clean completion. pi-ai emits `"length"`; other adapters may surface
 * `max_tokens`/`maxTokens`.
 */
const TRUNCATION_STOP_REASONS: ReadonlySet<string> = new Set(["length", "max_tokens", "maxTokens"]);

/**
 * Content-part `type` values that count as a tool call. pi emits `"toolCall"`;
 * the others are accepted defensively so a normalized/adapter variant is never
 * misread as empty.
 */
const TOOL_CALL_PART_TYPES: ReadonlySet<string> = new Set([
  "toolCall",
  "tool_call",
  "toolUse",
  "tool_use",
]);

/** True when `error` carries an actual error (non-null object with keys, or a non-empty string). */
function hasErrorObject(error: unknown): boolean {
  if (error == null) return false;
  if (typeof error === "string") return error.length > 0;
  if (typeof error === "object") return Object.keys(error as object).length > 0;
  return false;
}

/**
 * True when the turn's content contains a visible text part (non-empty after
 * trim) OR a bare non-empty string. Whitespace-only text is NOT visible.
 */
function hasVisibleText(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    if (!part || typeof part !== "object") return false;
    const p = part as { type?: string; text?: unknown };
    return p.type === "text" && typeof p.text === "string" && p.text.trim().length > 0;
  });
}

/** True when the turn's content contains a tool-call part. */
function hasToolCall(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    if (!part || typeof part !== "object") return false;
    const p = part as { type?: string };
    return typeof p.type === "string" && TOOL_CALL_PART_TYPES.has(p.type);
  });
}

/**
 * Classify an assistant turn.
 *
 * - `error`        — terminal error (`stopReason === "error"` OR an error object/message present).
 * - `truncated`    — `stopReason` is a truncation reason (`length`/`max_tokens`).
 * - `empty-actionable` — terminal non-error stop with NO visible text AND NO tool call
 *                    (thinking-only or wholly empty content).
 * - `normal`       — has visible text or a tool call (untouched by the guard).
 *
 * Error precedence beats truncation beats empty-actionable. A turn with visible
 * text or a tool call is always `normal` regardless of stop reason.
 */
export function classifyTurnActionability(turn: ClassifiableTurn | undefined | null): TurnActionability {
  if (!turn) return "normal";

  const errored =
    turn.stopReason === "error" ||
    (typeof turn.errorMessage === "string" && turn.errorMessage.length > 0) ||
    hasErrorObject(turn.error);
  if (errored) return "error";

  // A turn that actually produced output (text or a tool call) is normal,
  // even if the stop reason is a truncation — the visible output stands.
  if (hasVisibleText(turn.content) || hasToolCall(turn.content)) return "normal";

  if (typeof turn.stopReason === "string" && TRUNCATION_STOP_REASONS.has(turn.stopReason)) {
    return "truncated";
  }

  // No visible text, no tool call, no error, not a truncation → the clean-but-
  // empty completion (thinking-only or empty). This is the captured defect.
  return "empty-actionable";
}
