/**
 * Pure chain algebra for the per-worker fallback editor (design D7).
 *
 * A worker chain is ONE ordered list. Position 0 is the primary
 * (`<worker>Model`); positions 1..n are `<worker>FallbackModels` in resolution
 * order. Promotion is therefore just a move to index 0 — the client never
 * special-cases "primary" in its edit operations, only in its rendering.
 *
 * See change: add-blackhole-plugin.
 */
import type { ModelRef } from "./blackhole-config.js";

/** Read a worker chain out of a config object as one ordered list. */
export function readChain(
  config: Record<string, unknown>,
  primaryKey: string,
  fallbackKey: string,
): ModelRef[] {
  const primary = config[primaryKey];
  const fallbacks = config[fallbackKey];
  const entries: ModelRef[] = [];
  if (primary && typeof primary === "object" && !Array.isArray(primary)) {
    entries.push(primary as ModelRef);
  }
  if (Array.isArray(fallbacks)) {
    for (const f of fallbacks) {
      if (f && typeof f === "object" && !Array.isArray(f)) entries.push(f as ModelRef);
    }
  }
  return entries;
}

/**
 * Split an ordered chain back into its `<worker>Model` + `<worker>FallbackModels`
 * pair. An empty chain yields both as `undefined` (key omitted on write); a
 * single-entry chain omits the fallback array rather than writing `[]`, which
 * blackhole's `parseModelArray` would discard anyway.
 */
export function writeChain(entries: readonly ModelRef[]): {
  primary: ModelRef | undefined;
  fallbacks: ModelRef[] | undefined;
} {
  if (entries.length === 0) return { primary: undefined, fallbacks: undefined };
  const [primary, ...rest] = entries;
  return { primary, fallbacks: rest.length > 0 ? rest : undefined };
}

/**
 * Move the entry at `index` by `delta` positions. Out-of-range results are a
 * no-op (the boundary controls are DISABLED rather than absent, so this is
 * defence in depth, not the primary guard).
 */
export function moveEntry(entries: readonly ModelRef[], index: number, delta: number): ModelRef[] {
  const target = index + delta;
  if (index < 0 || index >= entries.length || target < 0 || target >= entries.length) {
    return [...entries];
  }
  const next = [...entries];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Remove the entry at `index`. A chain of one is never emptied — see `canRemove`. */
export function removeEntry(entries: readonly ModelRef[], index: number): ModelRef[] {
  if (!canRemove(entries)) return [...entries];
  return entries.filter((_, i) => i !== index);
}

/** A worker chain cannot be emptied: its last remaining entry offers no remove. */
export function canRemove(entries: readonly ModelRef[]): boolean {
  return entries.length > 1;
}

/**
 * Normalise an edited model draft for serialisation: trim the string fields and
 * drop `contextWindow` / `cooldownHours` when cleared, so an emptied numeric
 * input is written as ABSENT (inherit) rather than `0` or `null`.
 */
export function normalizeModel(draft: Record<string, unknown>): ModelRef {
  const out: Record<string, unknown> = {};
  // Preserve annotation keys (`_comment`) blackhole's own example config carries.
  for (const [k, v] of Object.entries(draft)) {
    if (k.startsWith("_")) out[k] = v;
  }
  out.provider = typeof draft.provider === "string" ? draft.provider.trim() : "";
  out.id = typeof draft.id === "string" ? draft.id.trim() : "";
  if (typeof draft.thinking === "string" && draft.thinking !== "") out.thinking = draft.thinking;
  const cooldown = toOptionalNumber(draft.cooldownHours);
  if (cooldown !== undefined) out.cooldownHours = cooldown;
  const ctx = toOptionalNumber(draft.contextWindow);
  if (ctx !== undefined) out.contextWindow = ctx;
  return out as unknown as ModelRef;
}

/** `""` / `null` / `undefined` / `NaN` → absent; anything else → the number. */
function toOptionalNumber(value: unknown): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isNaN(n) ? undefined : n;
}
