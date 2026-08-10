/**
 * Pure helpers for the settings form: textarea <-> array conversion, per-field
 * client-side validation (mirrors the server's numeric/regex checks so Save can
 * be disabled before a rejected round-trip — task 6.1), and building the full
 * resolved config payload written on save (design D5).
 *
 * See change: add-hermes-memory-settings-plugin.
 */
import { DEFAULTS, FIELD_DESCRIPTORS, KNOWN_KEYS, type MemoryConfig } from "../shared/hermes-config.js";

/** Split textarea text into a trimmed, empty-line-free string array. */
export function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Render a string array as newline-joined textarea text. */
export function arrayToLines(value: unknown): string {
  return Array.isArray(value) ? (value as string[]).join("\n") : "";
}

/** JSON-equality for effective-value comparison (arrays/objects included). */
export function valueEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Client-side validation for an OVERRIDDEN field. Returns an error string or
 * null. Only numeric bounds + regex compilation are checked (the fields a user
 * can put into an invalid state via a free input) — mirrors the server.
 */
function numberError(value: unknown, desc: { integer: boolean; min: number }): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a number";
  if (value < desc.min) return `Must be ≥ ${desc.min}`;
  if (desc.integer && !Number.isInteger(value)) return "Must be a whole number";
  return null;
}

function regexArrayError(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const line of value as string[]) {
    try {
      new RegExp(line);
    } catch {
      return `Invalid regex: ${line}`;
    }
  }
  return null;
}

export function fieldError(key: keyof MemoryConfig, value: unknown): string | null {
  const desc = FIELD_DESCRIPTORS[key];
  if (desc.kind === "number") return numberError(value, desc);
  if (desc.kind === "regexArray") return regexArrayError(value);
  return null;
}

/**
 * Build the full resolved config written on save: every key's effective value
 * (override when set, else the built-in default), skipping keys with no value
 * (undefined default) and empty overridden strings (which mean "unset"). Empty
 * overridden arrays ARE kept ([] = "none" per hermes semantics).
 */
export function buildResolvedConfig(
  values: Record<string, unknown>,
  overridden: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KNOWN_KEYS) {
    const isOverridden = overridden.has(key);
    const value = isOverridden ? values[key] : (DEFAULTS as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (isOverridden && typeof value === "string" && value.trim() === "") continue;
    out[key] = value;
  }
  return out;
}
