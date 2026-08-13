/**
 * Per-fire payload interpolation.
 *
 * Resolves the `${{trigger}}` token against a trigger's single per-fire value
 * (see `FireContext.value`). Applied centrally in the engine's dispatch over
 * an action's `payload` BEFORE the action runs, so no action needs its own
 * substitution logic.
 *
 * Rules:
 *   - A string that is EXACTLY `${{trigger}}` resolves to the typed value
 *     unchanged (whole-value pass-through — preserves number/boolean/object).
 *   - A string that embeds `${{trigger}}` in other text stringifies the value
 *     at that boundary.
 *   - An absent value (`undefined`) resolves `${{trigger}}` to `""`.
 *   - Single-brace `${name}` tokens resolve against an optional per-fire
 *     variable map: a known name is replaced with its mapped string, an unknown
 *     name (or no map) is left intact. Additive to and independent of the
 *     double-brace trigger token. Per-invoice fan-out supplies `{ invoice_id }`.
 *   - Objects/arrays are walked recursively; other primitives pass through.
 *
 * See change: wire-flow-inputs-in-automation, wire-per-invoice-automation-drain.
 */

const WHOLE = /^\$\{\{trigger\}\}$/;
const EMBED = /\$\{\{trigger\}\}/g;
// Single-brace `${name}` — an identifier NOT preceded/followed by a second
// brace, so it never matches the double-brace `${{trigger}}` form.
const NAMED = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/** Resolve known `${name}` tokens from `vars`; leave unknown names intact. */
function resolveNamed(text: string, vars: Record<string, string> | undefined): string {
  if (!vars) return text;
  return text.replace(NAMED, (match, name: string) => (name in vars ? vars[name] : match));
}

/**
 * Recursively resolve `${{trigger}}` (and, when `vars` is supplied, single-brace
 * `${name}`) tokens in a payload value.
 */
export function interpolate(
  value: unknown,
  triggerValue: unknown,
  vars?: Record<string, string>,
): unknown {
  if (typeof value === "string") {
    if (WHOLE.test(value)) return triggerValue ?? "";
    return resolveNamed(value.replace(EMBED, () => stringify(triggerValue)), vars);
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, triggerValue, vars));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, interpolate(v, triggerValue, vars)]),
    );
  }
  return value;
}
