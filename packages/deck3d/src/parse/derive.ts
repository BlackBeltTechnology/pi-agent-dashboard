/**
 * Derive a `DeckIR` from parsed markdown.
 *
 * `defaults` and `slides[]` are regenerated every parse; only `overrides`
 * survives (carried in from an existing deck.json, then overlaid with the
 * markdown's inline overrides, which win and warn on a clobbered key).
 */
import { resolveDefaults } from "../ir/defaults.js";
import { computeDerivedHash } from "../ir/hash.js";
import { clone, deepMerge, findOrphanOverrides, orphanOverridePath } from "../ir/merge.js";
import type { BuiltDiagramKind, DeckIR, Diagram, DiagramData, Overrides } from "../ir/types.js";
import { type ParsedDeck, parseMarkdown } from "./markdown.js";

const YEAR = /^(19|20)\d\d$/;

/**
 * D2 built-kind table — evaluated in order, first match wins, over
 * `title + bullets`. Word-bounded and case-insensitive so "modelling" matches
 * `model` but "remodel" does not start a brain.
 */
const BUILT_KINDS: Array<{ kind: BuiltDiagramKind; re?: RegExp; when?: (bullets: string[], text: string) => boolean }> = [
  { kind: "timeline-rail", when: (_b, text) => distinctYears(text) >= 2 || /\b(timeline|road ?map)\b/i.test(text) },
  { kind: "bars", when: (bullets) => bullets.filter((b) => leadingMagnitude(b) !== undefined).length >= 2 },
  { kind: "funnel", re: /\b(funnel|pipeline|deal ?flow)\b/i },
  { kind: "swarm", re: /\b(agents?|swarm)\b/i },
  { kind: "loop", re: /\b(loop|cycle|iterat\w*)\b/i },
  { kind: "brain", re: /\b(LLM|model|brain|intelligence)\b/i },
  { kind: "globe", re: /\b(global|regions?|geo\w*|trade)\b/i },
  { kind: "orbit-cluster", re: /\b(ecosystem|partners?|platform)\b/i },
  { kind: "stack", re: /\b(compute|infra\w*|layers?)\b/i },
];

function distinctYears(text: string): number {
  return new Set(text.match(/\b(?:19|20)\d\d\b/g) ?? []).size;
}

/** A bullet's leading magnitude, or `undefined` when it starts with a year or no number. */
function leadingMagnitude(bullet: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*%?\s*[:\u2013-]?\s*(.*)$/.exec(bullet.trim());
  if (!m || YEAR.test(m[1])) return undefined;
  return Number(m[1]);
}

/** The caption a bullet contributes: its text with any leading magnitude stripped. */
function bulletLabel(bullet: string): string {
  const trimmed = bullet.trim();
  const m = /^(\d+(?:\.\d+)?)\s*%?\s*[:\u2013-]?\s*(.*)$/.exec(trimmed);
  if (!m || YEAR.test(m[1]) || !m[2]) return trimmed;
  return m[2].trim();
}

/**
 * Built topology for a content slide with no usable mermaid block. A slide
 * with no bullets (title, section, credits) never gets one — there is nothing
 * to build from.
 */
export function builtKindFor(slide: { title: string; bullets: string[]; kind?: string }): BuiltDiagramKind {
  if (slide.bullets.length === 0) return "none";
  if (slide.kind && slide.kind !== "content") return "none";
  const text = `${slide.title} ${slide.bullets.join(" ")}`;
  for (const row of BUILT_KINDS) {
    if (row.re && !row.re.test(text)) continue;
    if (row.when && !row.when(slide.bullets, text)) continue;
    return row.kind;
  }
  return "none";
}

/** Labels (always) and values (only when every bullet carries a magnitude). */
export function harvestData(bullets: string[]): DiagramData {
  const labels = bullets.map(bulletLabel);
  const values = bullets.map(leadingMagnitude);
  return values.every((v) => v !== undefined) ? { labels, values: values as number[] } : { labels };
}

/** A mermaid harvest result: the diagram plus any warnings it produced. */
export interface HarvestOutcome {
  diagram: Diagram;
  warnings?: string[];
}

/** A mermaid harvester (section 4). Injected so derive stays browser-free. */
export type Harvester = (mermaidSource: string, slideId: string) => Promise<HarvestOutcome>;

export interface DeriveOptions {
  source?: string;
  engine?: string;
  mermaidVersion?: string;
  /** Prior deck.json — its `overrides` are preserved unless `fresh`. */
  previous?: DeckIR;
  fresh?: boolean;
  harvest?: Harvester;
  /** Deterministic effect/scene defaults from content tags (section 7d) + topic (D3). */
  sceneForSlide?: (slide: { id: string; title: string; bullets: string[]; diagram: Diagram }, autoStyle: boolean) => string;
  effectsForSlide?: (
    slide: { id: string; title: string; bullets: string[]; diagram: Diagram },
    autoStyle: boolean,
  ) => DeckIR["slides"][number]["effects"];
}

export interface DeriveOutcome {
  ir: DeckIR;
  warnings: string[];
}

export async function deriveDeckIR(parsed: ParsedDeck, opts: DeriveOptions = {}): Promise<DeriveOutcome> {
  const warnings: string[] = [];
  const defaults = resolveDefaults(parsed.defaults);
  const overrides = mergeOverrides(parsed, opts, warnings);
  // `autoStyle` may be switched off in front matter or in `overrides.deck`.
  const autoStyle = overrides.deck?.autoStyle ?? defaults.autoStyle ?? true;
  const slides: DeckIR["slides"] = [];
  for (const p of parsed.slides) slides.push(await buildSlide(p, defaults, opts, warnings, autoStyle));

  for (const slide of slides) {
    const ov = overrides.slides?.[slide.id]?.diagram;
    if (!ov) continue;
    if (slide.diagram.kind !== "flowchart" && slide.diagram.kind !== "sequence") continue;
    for (const key of ["kind", "data"] as const) {
      if (ov[key] === undefined) continue;
      warnings.push(
        `warn overrides.slides["${slide.id}"].diagram.${key} ignored while the slide has a mermaid diagram (markdown wins)`,
      );
    }
  }

  const ir: DeckIR = {
    meta: {
      engine: opts.engine ?? "0.1.0",
      mermaid: opts.mermaidVersion ?? "11.17.2",
      ...(opts.source ? { source: opts.source } : {}),
    },
    defaults,
    slides,
    overrides,
  };

  for (const orphan of findOrphanOverrides(ir)) {
    const suffix = orphan.kind === "slide" ? ` — pin the heading with {#${orphan.id}} to keep it` : "";
    warnings.push(`warn orphan override ${orphanOverridePath(orphan)}${suffix}`);
  }

  ir.meta.derivedHash = computeDerivedHash(ir);
  return { ir, warnings };
}

async function buildSlide(
  p: ParsedDeck["slides"][number],
  defaults: DeckIR["defaults"],
  opts: DeriveOptions,
  warnings: string[],
  autoStyle: boolean,
): Promise<DeckIR["slides"][number]> {
  let diagram: Diagram = { kind: "none" };
  if (p.mermaid) {
    if (!opts.harvest) throw new Error(`slide "${p.id}": mermaid block present but no harvester is available`);
    const outcome = await opts.harvest(p.mermaid, p.id);
    diagram = outcome.diagram;
    if (outcome.warnings) warnings.push(...outcome.warnings);
  }
  // An unsupported fence already yielded `none` with a warning; such a slide is
  // diagram-less here, so the built-kind table applies to it too.
  if (autoStyle && diagram.kind === "none") {
    const kind = builtKindFor({ title: p.title, bullets: p.bullets });
    if (kind !== "none") diagram = { kind, data: harvestData(p.bullets) };
  }
  const base = { id: p.id, title: p.title, bullets: p.bullets, diagram };
  const slide: DeckIR["slides"][number] = {
    index: p.index,
    id: p.id,
    title: p.title,
    bullets: p.bullets,
    scene: opts.sceneForSlide ? opts.sceneForSlide(base, autoStyle) : "none",
    diagram,
    camera: { distance: defaults.camera?.distance },
    labels: { size: defaults.labels?.size },
    check: { ignore: [...(defaults.check?.ignore ?? [])] },
    effects: opts.effectsForSlide ? opts.effectsForSlide(base, autoStyle) : [],
  };
  if (p.subtitle) slide.subtitle = p.subtitle;
  return slide;
}

function mergeOverrides(parsed: ParsedDeck, opts: DeriveOptions, warnings: string[]): Overrides {
  const overrides: Overrides = opts.fresh || !opts.previous ? {} : clone(opts.previous.overrides);
  overrides.slides = { ...(overrides.slides ?? {}) };
  for (const p of parsed.slides) {
    if (!p.inlineOverrides) continue;
    const existing = overrides.slides[p.id] ?? {};
    for (const key of Object.keys(p.inlineOverrides)) {
      if (key in existing) {
        warnings.push(
          `warn inline override overrides.slides["${p.id}"].${key} clobbers deck.json value (markdown wins)`,
        );
      }
    }
    overrides.slides[p.id] = deepMerge(existing, p.inlineOverrides) as typeof existing;
  }
  return overrides;
}

/** markdown → IR in one step. */
export async function parseDeck(source: string, opts: DeriveOptions = {}): Promise<DeriveOutcome> {
  return deriveDeckIR(parseMarkdown(source), opts);
}
