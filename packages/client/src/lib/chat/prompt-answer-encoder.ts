/**
 * encodePromptAnswer — pure helper that converts an interactive renderer's
 * `result` payload into the string `answer` field carried by a PromptBus
 * `prompt_response` message.
 *
 * Encoding precedence (order matters):
 *
 *   1. Cancellation                        → undefined  (no answer at all)
 *   2. result.answers is array (batch)     → JSON.stringify(answers)
 *   3. result.values is array (multiselect) → JSON.stringify(values)
 *   4. result.value is defined (select / input / editor) → result.value as string
 *   5. result.confirmed (confirm)          → "true" / "false"
 *   6. fallback                            → String(result ?? "")
 *
 * The multiselect arm distinguishes empty selection (`answer: "[]"`) from
 * cancellation (`answer: undefined`, `cancelled: true`) — the bridge
 * decoder relies on the cancelled flag, not on the answer shape.
 *
 * See change: fix-multiselect-auto-cancel-on-dashboard.
 */

export function encodePromptAnswer(
  result: unknown,
  cancelled: boolean | undefined,
): string | undefined {
  if (cancelled) return undefined;
  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.answers)) {
      return JSON.stringify(r.answers);
    }
    if (Array.isArray(r.values)) {
      return JSON.stringify(r.values);
    }
    if (r.value !== undefined) {
      return r.value as string;
    }
    if (r.confirmed !== undefined) {
      return (r.confirmed as boolean | { toString(): string }).toString();
    }
  }
  return String(result ?? "");
}
