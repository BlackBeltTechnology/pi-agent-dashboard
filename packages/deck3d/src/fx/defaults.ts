/**
 * Deterministic default effects (design D9 + D3 / spec deck3d-effects).
 *
 * Same markdown ⇒ same list. The v1 precedence is kept as a strict prefix —
 * keyword table, then title-ish, then harvested diagram kind — and a topic step
 * is inserted exactly where v1 fell through to `particles`, so the only slides
 * whose background changes are the ones that were on the generic fallback.
 */
import type { Diagram, EffectRef } from "../ir/types.js";
import { REGISTRY } from "./index.js";
import type { FxTopic } from "./types.js";

export interface DefaultEffectInput {
  id: string;
  title: string;
  bullets: string[];
  diagram: Diagram;
  kind?: string;
}

/** Keyword → background override (checked in order, first match wins). */
const KEYWORDS: Array<{ re: RegExp; background: string }> = [
  { re: /security|biztons|auth|secur/i, background: "glyph-rain" },
  { re: /data|adat|metric|observab|telemetr/i, background: "data-columns" },
];

/**
 * Harvested diagram kind → background (+ optional edge). Only the two kinds
 * that come from a mermaid block: a BUILT kind (`brain`, `bars`, …) picks its
 * scenery through the topic step instead, so object and background are chosen
 * independently.
 */
const BY_DIAGRAM: Record<string, { background: string; edge?: string }> = {
  flowchart: { background: "tokens", edge: "signal-pulse" },
  sequence: { background: "rings", edge: "signal-pulse" },
};

/** Ordered topic keyword table (first match wins), evaluated on title + bullets. */
const TOPIC_KEYWORDS: Array<{ topic: FxTopic; re: RegExp }> = [
  { topic: "security", re: /\b(security|secure|auth\w*|encrypt\w*|threat|vulnerab\w*)\b/i },
  { topic: "trust", re: /\b(trust|compliance|governance|audit\w*|privacy|trans?parenc\w*)\b/i },
  { topic: "agents", re: /\b(agents?|swarm|autonom\w*|copilots?)\b/i },
  { topic: "ai", re: /\b(ai|llm|models?|intelligence|inference|prompt\w*)\b/i },
  { topic: "geo", re: /\b(global|regions?|regional|geo\w*|trade|countr\w*|worldwide)\b/i },
  { topic: "compute", re: /\b(compute|infra\w*|cloud|servers?|gpus?|cluster\w*|layers?)\b/i },
  { topic: "money", re: /\b(revenue|costs?|pricing|price|budget|margin|profit|finance|funding)\b/i },
  { topic: "sales", re: /\b(sales|pipeline|deals?|customers?|churn|renewals?|quota)\b/i },
  { topic: "work", re: /\b(teams?|people|workforce|hiring|talent|employees?|culture)\b/i },
  { topic: "timeline", re: /\b(timeline|road ?map|quarters?|milestones?|phases?)\b/i },
  { topic: "data", re: /\b(dashboards?|analytics?|reporting|insights?)\b/i },
  { topic: "process", re: /\b(process\w*|workflows?|handoffs?|cycles?|loops?|steps?)\b/i },
];

const FALLBACK: { background: string; edge?: string } = { background: "particles" };

/** Cheapest `background` card carrying `topic`; ties resolve by id. */
export function backgroundForTopic(topic: FxTopic): string | undefined {
  return Object.values(REGISTRY)
    .filter((e) => e.card.kind === "background" && e.card.tags.topic?.includes(topic))
    .sort((a, b) => a.card.cost - b.card.cost || a.card.id.localeCompare(b.card.id))[0]?.card.id;
}

function topicBackground(text: string): string | undefined {
  for (const row of TOPIC_KEYWORDS) {
    if (!row.re.test(text)) continue;
    const id = backgroundForTopic(row.topic);
    if (id) return id;
  }
  return undefined;
}

export function defaultEffectsFor(slide: DefaultEffectInput, autoStyle = true): EffectRef[] {
  const text = `${slide.title} ${slide.bullets.join(" ")}`;
  const byKind = BY_DIAGRAM[slide.diagram.kind] ?? FALLBACK;
  const keyword = KEYWORDS.find((k) => k.re.test(text));
  const isTitleish = slide.diagram.kind === "none" && slide.bullets.length === 0 && !slide.id.includes("-");

  let background = keyword?.background;
  if (!background && isTitleish) background = "swarm";
  if (!background && BY_DIAGRAM[slide.diagram.kind]) background = byKind.background;
  if (!background && autoStyle) background = topicBackground(text);
  background ??= FALLBACK.background;

  const out: EffectRef[] = [{ id: background }];
  if (byKind.edge) out.push({ id: byKind.edge });
  return out;
}

/** The background effect id used to seed the runtime scene (fallback path). */
export function defaultSceneFor(slide: DefaultEffectInput, autoStyle = true): string {
  return defaultEffectsFor(slide, autoStyle)[0]?.id ?? "particles";
}
