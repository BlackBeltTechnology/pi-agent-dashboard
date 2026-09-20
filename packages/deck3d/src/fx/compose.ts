/**
 * Effect composition (design D9): conflicts, mode gating, quality budget.
 * Pure — shared by the render CLI and the corpus tests.
 */
import type { EffectRef, Quality } from "../ir/types.js";
import { REGISTRY } from "./index.js";
import type { FxCard, FxMode } from "./types.js";

export const QUALITY_BUDGET: Record<Quality, number> = { low: 6, medium: 12, high: 20 };

export interface SkippedEffect {
  id: string;
  reason: string;
}

export interface Composition {
  active: EffectRef[];
  skipped: SkippedEffect[];
  warnings: string[];
  /** Non-empty ⇒ render must fail, naming the ids and slide. */
  conflicts: string[];
}

/** Cards for `local:<name>` ids, keyed by BARE name (as embedded by `render`). */
export type LocalCards = Record<string, FxCard>;

/**
 * A `local:` id resolves through the embedded cards, so a per-deck effect takes
 * part in conflict / mode / budget gating exactly like a corpus one.
 */
function card(id: string, local: LocalCards = {}): FxCard | undefined {
  if (id.startsWith("local:")) return local[id.slice("local:".length)];
  return REGISTRY[id]?.card;
}

function modeAllows(modes: FxMode, mode: "dark" | "light"): boolean {
  return modes === "both" || modes === mode;
}

function conflictPairs(ids: string[], slideId: string, local: LocalCards): string[] {
  const conflicts: string[] = [];
  for (const id of ids) {
    for (const other of card(id, local)?.conflicts ?? []) {
      if (!ids.includes(other)) continue;
      const detail = `${[id, other].sort().join(" + ")} slide ${slideId}`;
      if (!conflicts.includes(detail)) conflicts.push(detail);
    }
  }
  return conflicts;
}

export function composeEffects(
  effects: EffectRef[] | undefined,
  mode: "dark" | "light",
  quality: Quality,
  slideId: string,
  local: LocalCards = {},
): Composition {
  const active: EffectRef[] = [];
  const skipped: SkippedEffect[] = [];
  const warnings: string[] = [];

  for (const ref of effects ?? []) {
    const c = card(ref.id, local);
    if (!c) {
      skipped.push({ id: ref.id, reason: "unknown" });
      warnings.push(`warn unknown effect ${ref.id} slide ${slideId}`);
      continue;
    }
    if (!modeAllows(c.modes, mode)) {
      skipped.push({ id: ref.id, reason: `${c.modes} only` });
      warnings.push(`warn skipped ${ref.id} (${c.modes} only) slide ${slideId}`);
      continue;
    }
    active.push(ref);
  }

  const sum = active.reduce((total, e) => total + (card(e.id, local)?.cost ?? 0), 0);
  if (sum > QUALITY_BUDGET[quality]) warnings.push(`warn budget slide ${slideId} ${sum} > ${QUALITY_BUDGET[quality]}`);

  return { active, skipped, warnings, conflicts: conflictPairs(active.map((e) => e.id), slideId, local) };
}

/** Param-bounds violations for `validate` (E24). */
export interface ParamViolation {
  path: string;
  message: string;
}

function paramViolations(slideId: string, index: number, ref: EffectRef, local: LocalCards): ParamViolation[] {
  const c = card(ref.id, local);
  if (!c) return [];
  const out: ParamViolation[] = [];
  for (const [name, value] of Object.entries(ref.params ?? {})) {
    const schema = c.params[name] as { minimum?: number; maximum?: number } | undefined;
    if (!schema || typeof value !== "number") continue;
    const base = `overrides.slides["${slideId}"].effects[${index}].params.${name}`;
    if (schema.minimum !== undefined && value < schema.minimum) out.push({ path: base, message: `${value} < minimum ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) out.push({ path: base, message: `${value} > maximum ${schema.maximum}` });
  }
  return out;
}

/** Validate `overrides.slides[id].effects[i].params` against the card schemas. */
export function validateEffectParams(
  ir: { overrides?: { slides?: Record<string, { effects?: EffectRef[] }> } },
  local: LocalCards = {},
): ParamViolation[] {
  const out: ParamViolation[] = [];
  for (const [slideId, slide] of Object.entries(ir.overrides?.slides ?? {})) {
    (slide.effects ?? []).forEach((ref, i) => out.push(...paramViolations(slideId, i, ref, local)));
  }
  return out;
}
