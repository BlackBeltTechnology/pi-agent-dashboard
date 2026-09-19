/**
 * Deterministic default effects (design D9 / spec deck3d-effects).
 *
 * Same markdown ⇒ same list. Slide content keywords and diagram kind pick a
 * background; a diagram kind may also pick an edge style. `overrides.slides[id].effects`
 * replaces the whole list.
 */
import type { Diagram, EffectRef } from "../ir/types.js";

export interface DefaultEffectInput {
  id: string;
  title: string;
  bullets: string[];
  diagram: Diagram;
}

/** Keyword → background override (checked in order, first match wins). */
const KEYWORDS: Array<{ re: RegExp; background: string }> = [
  { re: /security|biztons|auth|secur/i, background: "glyph-rain" },
  { re: /data|adat|metric|observab|telemetr/i, background: "data-columns" },
];

/** Diagram kind → background (+ optional edge) defaults. */
const BY_DIAGRAM: Record<string, { background: string; edge?: string }> = {
  flowchart: { background: "tokens", edge: "signal-pulse" },
  sequence: { background: "rings", edge: "signal-pulse" },
  brain: { background: "particles" },
  loop: { background: "rings" },
  swarm: { background: "swarm" },
};

const FALLBACK: { background: string; edge?: string } = { background: "particles" };

export function defaultEffectsFor(slide: DefaultEffectInput): EffectRef[] {
  const text = `${slide.title} ${slide.bullets.join(" ")}`;
  const byKind = BY_DIAGRAM[slide.diagram.kind] ?? FALLBACK;
  const keyword = KEYWORDS.find((k) => k.re.test(text));
  const isTitleish = slide.diagram.kind === "none" && slide.bullets.length === 0 && !slide.id.includes("-");
  const background = keyword?.background ?? (isTitleish ? "swarm" : byKind.background);
  const out: EffectRef[] = [{ id: background }];
  if (byKind.edge) out.push({ id: byKind.edge });
  return out;
}

/** The background effect id used to seed the runtime scene (fallback path). */
export function defaultSceneFor(slide: DefaultEffectInput): string {
  return defaultEffectsFor(slide)[0]?.id ?? "particles";
}
