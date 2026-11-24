/**
 * Argument parsing shared by every op (task 2.7 / 2.12): payloads are untrusted
 * JSON, so reads are OWN-property only (no prototype walk), strings are
 * sanitised and length-checked in code points, and over-limit text is rejected
 * (`invalid_args`) — only `result` / `finalText` are ever truncated (use
 * `truncateWithMarker`). Raw input longer than twice the limit is refused before
 * it is scanned, so a hostile 10 MB string costs O(1).
 * See change: add-agent-teams-core.
 */
import { codePointLength, sanitizeText } from "../shared/text.js";

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Own-property read: never walks the prototype chain of an untrusted object. */
export function own(args: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(args, key) ? args[key] : undefined;
}

export type TextResult = { ok: true; value: string | undefined } | { ok: false };

/** A text field: controls stripped, trimmed, ≤ `max` code points; `required` rejects absent/blank. */
export function textField(v: unknown, max: number, opts: { required?: boolean; multiline?: boolean } = {}): TextResult {
  if (v === undefined || v === null) return opts.required ? { ok: false } : { ok: true, value: undefined };
  if (typeof v !== "string" || v.length > max * 2) return { ok: false };
  const clean = sanitizeText(v, { keepNewlines: opts.multiline === true }).trim();
  if (opts.required && clean === "") return { ok: false };
  if (codePointLength(clean) > max) return { ok: false };
  return { ok: true, value: clean };
}

/** A list of non-empty single-line strings; `undefined` when absent, `"invalid"` when malformed. */
export function stringList(v: unknown, maxItems = 100, maxLen = 300): string[] | undefined | "invalid" {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > maxItems) return "invalid";
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string" || item === "" || item.length > maxLen) return "invalid";
    out.push(sanitizeText(item, { keepNewlines: false }));
  }
  return out;
}
