/**
 * Build redacted `server.log` lines for spawned-session turn outcomes.
 *
 * Two outcomes cross the child→dashboard boundary invisibly today:
 *  1. Empty-actionable turn — a clean-but-empty `stop` (thinking-only). The
 *     bridge forwards an `empty_actionable_surface` event; the server logs a
 *     NON-error line here.
 *  2. Model-turn error — a genuine provider/adapter error inside the child
 *     `pi --mode rpc` process. The bridge forwards an `agent_end` whose last
 *     message carries `stopReason === "error"`; the server logs an error line.
 *
 * Redaction: lines carry only status + message + model/session identifiers.
 * `redactSecrets` strips bearer tokens, api keys, and long credential-like
 * blobs so no token/key/credential ever reaches `server.log`.
 *
 * Pure — no I/O. Callers `console.log`/`console.error` the returned string
 * (server stdout is redirected to `server.log`).
 *
 * See change: fix-gemini-subagent-silent-tool-schema-failure.
 */

/**
 * Patterns that must never appear verbatim in a surfaced log line. Order
 * matters: specific credential shapes run before the broad long-blob rule so
 * they get their own labelled replacement. The long-blob rule (>= 40 opaque
 * chars) is the catch-all for assigned secrets (`api_key=…`) and raw tokens.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Authorization: Bearer <token>
  [/\b[Bb]earer\s+[A-Za-z0-9._\-]+/g, "Bearer [REDACTED]"],
  // Google / OpenAI style keys (AIza..., ya29. OAuth tokens, sk-...)
  [/\bAIza[0-9A-Za-z._\-]{10,}/g, "[REDACTED]"],
  [/\bya29\.[0-9A-Za-z._\-]{10,}/g, "[REDACTED]"],
  [/\bsk-[0-9A-Za-z._\-]{10,}/g, "[REDACTED]"],
  // Long opaque base64/hex-ish blobs (>= 40 chars, no whitespace) — likely creds.
  [/[A-Za-z0-9+/_\-]{40,}/g, "[REDACTED]"],
];

/** Strip credential-like substrings from an arbitrary error/status message. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, replacement] of SECRET_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

export interface EmptyActionableLogInput {
  sessionId: string;
  model?: string;
  message: string;
}

/** NON-error line: model returned only reasoning, no answer. */
export function buildEmptyActionableLogLine(input: EmptyActionableLogInput): string {
  const model = input.model ? ` model=${input.model}` : "";
  return `[dashboard] empty-actionable turn: session=${input.sessionId}${model} — ${redactSecrets(input.message)}`;
}

export interface ModelTurnErrorInput {
  sessionId: string;
  model?: string;
  stopReason?: string;
  message: string;
}

/** ERROR line: a spawned session's model turn failed. */
export function buildModelErrorLogLine(input: ModelTurnErrorInput): string {
  const model = input.model ? ` model=${input.model}` : "";
  const stop = input.stopReason ? ` stopReason=${input.stopReason}` : "";
  return `[dashboard] spawned-session model-turn error: session=${input.sessionId}${model}${stop} — ${redactSecrets(input.message)}`;
}

/** Minimal shape of a pi assistant message as forwarded in agent_end/message_end. */
interface ForwardedMessage {
  role?: string;
  stopReason?: string;
  errorMessage?: string;
  model?: string;
  provider?: string;
}

/**
 * Extract a genuine model-turn error from a forwarded `agent_end` event's
 * `messages` array. Returns `null` unless the terminal assistant message has
 * `stopReason === "error"` (the empty-actionable `stop` case is deliberately
 * NOT matched — it is handled by the guard's non-error surface path).
 */
export function extractModelTurnError(
  data: Record<string, unknown>,
): { message: string; model?: string; stopReason?: string } | null {
  const messages = data.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const last = messages[messages.length - 1] as ForwardedMessage | undefined;
  if (last?.role !== "assistant" || last.stopReason !== "error") return null;
  const message =
    typeof last.errorMessage === "string" && last.errorMessage.length > 0
      ? last.errorMessage
      : "model turn ended with an error";
  const model =
    last.provider && last.model ? `${last.provider}/${last.model}` : (last.model ?? undefined);
  return { message, model, stopReason: last.stopReason };
}
