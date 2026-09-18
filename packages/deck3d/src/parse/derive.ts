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
import type { DeckIR, Diagram, Overrides } from "../ir/types.js";
import { type ParsedDeck, parseMarkdown } from "./markdown.js";

/** A mermaid harvester (section 4). Injected so derive stays browser-free. */
export type Harvester = (mermaidSource: string, slideId: string) => Promise<Diagram>;

export interface DeriveOptions {
  source?: string;
  engine?: string;
  mermaidVersion?: string;
  /** Prior deck.json — its `overrides` are preserved unless `fresh`. */
  previous?: DeckIR;
  fresh?: boolean;
  harvest?: Harvester;
  /** Deterministic effect/scene defaults from content tags (section 7d). */
  sceneForSlide?: (slide: { id: string; title: string; bullets: string[]; diagram: Diagram }) => string;
  effectsForSlide?: (slide: { id: string; title: string; bullets: string[]; diagram: Diagram }) => DeckIR["slides"][number]["effects"];
}

export interface DeriveOutcome {
  ir: DeckIR;
  warnings: string[];
}

export async function deriveDeckIR(parsed: ParsedDeck, opts: DeriveOptions = {}): Promise<DeriveOutcome> {
  const warnings: string[] = [];
  const defaults = resolveDefaults(parsed.defaults);
  const slides: DeckIR["slides"] = [];
  for (const p of parsed.slides) slides.push(await buildSlide(p, defaults, opts));

  const overrides = mergeOverrides(parsed, opts, warnings);
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
): Promise<DeckIR["slides"][number]> {
  let diagram: Diagram = { kind: "none" };
  if (p.mermaid) {
    if (!opts.harvest) throw new Error(`slide "${p.id}": mermaid block present but no harvester is available`);
    diagram = await opts.harvest(p.mermaid, p.id);
  }
  const base = { id: p.id, title: p.title, bullets: p.bullets, diagram };
  const slide: DeckIR["slides"][number] = {
    index: p.index,
    id: p.id,
    title: p.title,
    bullets: p.bullets,
    scene: opts.sceneForSlide ? opts.sceneForSlide(base) : "none",
    diagram,
    camera: { distance: defaults.camera?.distance },
    labels: { size: defaults.labels?.size },
    check: { ignore: [...(defaults.check?.ignore ?? [])] },
    effects: opts.effectsForSlide ? opts.effectsForSlide(base) : [],
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
