/**
 * Prompt answer wire contract: `encodePromptAnswer` (renderer result → string)
 * and `validateQuestionAnswer` (string → ok/reason, used by the REST answer
 * road). Moved from the client so both roads share one definition.
 * See change: add-pending-question-stack.
 *
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

// ── Validation (REST answer road) ───────────────────────────────────

export type AnswerValidation = { ok: true } | { ok: false; reason: string };

export interface ValidatablePrompt {
  type: string;
  options?: string[];
  /** Inline "Other" opt-in. See change: add-ask-user-inline-other. */
  allowOther?: boolean;
  metadata?: Record<string, unknown>;
}

// ── Inline "Other" (custom answer) enablement ───────────────────────
// See change: add-ask-user-inline-other. ONE predicate shared by the client
// renderers and the REST validator so the UI shows Other exactly when the
// server accepts a custom answer.

/** True when the caller already offers its own "Other…" option (English-only heuristic). */
export function hasOwnOtherOption(options: readonly unknown[]): boolean {
  return options.some((o) => typeof o === "string" && /^other(?![\p{L}\p{N}])/iu.test(o.trim()));
}

/** Inline Other is shown/accepted only for opted-in prompts with options and no own "Other". */
export function isOtherAllowed(p: { allowOther?: boolean; options?: readonly unknown[] }): boolean {
  return p.allowOther === true && Array.isArray(p.options) && p.options.length > 0 && !hasOwnOtherOption(p.options);
}

/** A custom answer is the shape the UI produces: non-empty and already trimmed. */
function isCustomText(v: string): boolean {
  return v.length > 0 && v === v.trim();
}

const OK: AnswerValidation = { ok: true };
const fail = (reason: string): AnswerValidation => ({ ok: false, reason });

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function validateMultiselectValues(
  values: unknown,
  options: readonly string[],
  allowCustom = false,
): AnswerValidation {
  if (!Array.isArray(values)) return fail("multiselect answer must be a JSON array");
  const seen = new Set<string>();
  let customs = 0;
  for (const v of values) {
    if (typeof v !== "string") return fail(`not an option: ${String(v)}`);
    if (!options.includes(v)) {
      if (!allowCustom || !isCustomText(v) || ++customs > 1) return fail(`not an option: ${String(v)}`);
    }
    if (seen.has(v)) return fail(`duplicate option: ${v}`);
    seen.add(v);
  }
  return OK;
}

function validateBatchEntry(
  entry: unknown,
  sub: { method?: string; options?: string[]; allowOther?: boolean },
  index: number,
): AnswerValidation {
  const at = `batch[${index}]`;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return fail(`${at}: entry must be an object`);
  }
  const e = entry as Record<string, unknown>;
  const options: readonly string[] = Array.isArray(sub.options) ? sub.options : [];
  const other = isOtherAllowed({ allowOther: sub.allowOther, options });
  switch (sub.method) {
    case "confirm":
      return typeof e.confirmed === "boolean" ? OK : fail(`${at}: confirm needs {confirmed:boolean}`);
    case "select":
      return typeof e.value === "string" && (options.includes(e.value) || (other && isCustomText(e.value)))
        ? OK
        : fail(`${at}: select value must be one of the options`);
    case "multiselect": {
      const r = validateMultiselectValues(e.values, options, other);
      return r.ok ? r : fail(`${at}: ${r.reason}`);
    }
    case "input":
      if (typeof e.value !== "string") return fail(`${at}: input needs {value:string}`);
      if (e.images !== undefined) return fail(`${at}: images are not supported on this road`);
      return OK;
    default:
      return fail(`${at}: unsupported sub-question method`);
  }
}

/**
 * Check that `answer` is a string the dashboard chat could have produced for
 * `prompt`. Text-only: batch `input` entries carrying `images` are rejected.
 */
export function validateQuestionAnswer(prompt: ValidatablePrompt, answer: string): AnswerValidation {
  const options = prompt.options ?? [];
  const other = isOtherAllowed({ allowOther: prompt.allowOther, options });
  switch (prompt.type) {
    case "confirm":
      return answer === "true" || answer === "false" ? OK : fail('confirm answer must be "true" or "false"');
    case "select":
      return options.includes(answer) || (other && isCustomText(answer))
        ? OK
        : fail("answer is not one of the options");
    case "multiselect": {
      const parsed = parseJson(answer);
      if (!parsed.ok) return fail("multiselect answer must be a JSON array");
      return validateMultiselectValues(parsed.value, options, other);
    }
    case "input":
    case "editor":
      return OK;
    case "batch": {
      const subs = prompt.metadata?.questions;
      if (!Array.isArray(subs)) return fail("batch prompt has no sub-questions");
      const parsed = parseJson(answer);
      if (!parsed.ok || !Array.isArray(parsed.value)) return fail("batch answer must be a JSON array");
      if (parsed.value.length !== subs.length) {
        return fail(`batch answer needs ${subs.length} entries, got ${parsed.value.length}`);
      }
      for (let i = 0; i < subs.length; i++) {
        const r = validateBatchEntry(parsed.value[i], (subs[i] ?? {}) as { method?: string; options?: string[]; allowOther?: boolean }, i);
        if (!r.ok) return r;
      }
      return OK;
    }
    default:
      return fail(`unsupported prompt type: ${prompt.type}`);
  }
}
