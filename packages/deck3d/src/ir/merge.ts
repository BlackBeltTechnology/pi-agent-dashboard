/**
 * Override merge — the single grammar in `overrides` (design D1).
 *
 *   objects deep-merge over derived values
 *   arrays replace wholesale
 *   `diagram.data` replaces wholesale (named exception — labels and values
 *   must not mix provenance)
 *
 * Persisted `slides[]` is never mutated: `applyOverrides` returns a fresh
 * merged view for the renderer, so re-parse always regenerates derived fields.
 */
import type {
  DeckIR,
  Defaults,
  DiagramEdge,
  MergedDeck,
  MergedNode,
  MergedSlide,
  NodeOverride,
} from "./types.js";

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** `diagram.data` is the one object key that replaces instead of deep-merging. */
function isAtomic(parentKey: string | undefined, key: string): boolean {
  return key === "data" && parentKey === "diagram";
}

/** Deep merge: objects merge recursively, arrays, scalars and `diagram.data` replace. */
export function deepMerge(base: unknown, override: unknown, parentKey?: string): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return clone(override);
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const mergeable = isPlainObject(value) && isPlainObject(base[key]) && !isAtomic(parentKey, key);
    out[key] = mergeable ? deepMerge(base[key], value, key) : clone(value);
  }
  return out;
}

export function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => clone(v)) as unknown as T;
  if (isPlainObject(value)) {
    const out: Json = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out as unknown as T;
  }
  return value;
}

/** Fold `<slideId>/<id>` overrides for one slide into its merged nodes. */
function mergeNodeOverrides(nodes: MergedNode[] | undefined, slideId: string, map: Record<string, NodeOverride> | undefined): MergedNode[] | undefined {
  if (!nodes) return nodes;
  if (!map) return clone(nodes);
  const prefix = `${slideId}/`;
  return nodes.map((node) => {
    const ov = map[prefix + node.id];
    if (!ov) return clone(node);
    const merged: MergedNode = clone(node);
    if (ov.shape !== undefined) merged.shape = ov.shape;
    if (ov.label !== undefined) merged.label = ov.label;
    if (ov.position !== undefined) merged.position = clone(ov.position);
    if (ov.size !== undefined) merged.size = clone(ov.size);
    if (ov.material !== undefined) merged.material = ov.material;
    return merged;
  });
}

export function applyOverrides(ir: DeckIR): MergedDeck {
  const defaults = (ir.overrides.deck ? deepMerge(ir.defaults, ir.overrides.deck) : clone(ir.defaults)) as Defaults;
  const slides: MergedSlide[] = ir.slides.map((slide) => {
    const slideOv = ir.overrides.slides?.[slide.id];
    const base = slideOv ? (deepMerge(slide, slideOv) as MergedSlide) : (clone(slide) as MergedSlide);
    base.diagram = base.diagram ?? { kind: "none" };
    if (base.diagram.kind === "flowchart") {
      base.diagram.nodes = mergeNodeOverrides(base.diagram.nodes as MergedNode[] | undefined, slide.id, ir.overrides.nodes);
      base.diagram.edges = mergeEdgeKinds(base.diagram.edges, slide.id, ir.overrides.edges);
    }
    // Effective effects: deck-level list first, then this slide's own list
    // (a slide `effects` override replaces the derived list). Arrays replace —
    // the objects are never merged.
    base.effects = [...clone(ir.overrides.effects ?? []), ...clone(base.effects ?? [])];
    return base;
  });
  return { defaults, slides, effects: clone(ir.overrides.effects ?? []), props: clone(ir.overrides.props ?? []) };
}

function mergeEdgeKinds(edges: DiagramEdge[] | undefined, slideId: string, map: Record<string, { kind?: DiagramEdge["kind"] }> | undefined): DiagramEdge[] | undefined {
  if (!edges) return edges;
  if (!map) return clone(edges);
  const prefix = `${slideId}/`;
  return edges.map((edge) => {
    const ov = map[prefix + edge.id];
    if (!ov?.kind) return clone(edge);
    const merged = clone(edge);
    merged.kind = ov.kind;
    return merged;
  });
}

export interface OrphanOverride {
  kind: "slide" | "node" | "edge";
  /** Raw override key (slide id, or `<slideId>/<id>`). */
  key: string;
  id: string;
}

/** Override entries whose target no longer exists. Kept, inert, warned about. */
export function findOrphanOverrides(ir: DeckIR): OrphanOverride[] {
  const orphans: OrphanOverride[] = [];
  const slideIds = new Set(ir.slides.map((s) => s.id));
  for (const id of Object.keys(ir.overrides.slides ?? {})) {
    if (!slideIds.has(id)) orphans.push({ kind: "slide", key: id, id });
  }
  collectOrphans(ir.overrides.nodes, indexElementIds(ir, "nodes"), "node", orphans);
  collectOrphans(ir.overrides.edges, indexElementIds(ir, "edges"), "edge", orphans);
  return orphans;
}

function indexElementIds(ir: DeckIR, which: "nodes" | "edges"): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const slide of ir.slides) {
    const elements = which === "nodes" ? slide.diagram.nodes : slide.diagram.edges;
    index.set(slide.id, new Set((elements ?? []).map((e) => e.id)));
  }
  return index;
}

function collectOrphans(
  map: Record<string, unknown> | undefined,
  index: Map<string, Set<string>>,
  kind: "node" | "edge",
  out: OrphanOverride[],
): void {
  for (const key of Object.keys(map ?? {})) {
    const [slideId, id] = splitKey(key);
    if (!slideId || !id || !index.get(slideId)?.has(id)) out.push({ kind, key, id: id ?? key });
  }
}

function splitKey(key: string): [string | undefined, string | undefined] {
  const idx = key.indexOf("/");
  if (idx <= 0 || idx === key.length - 1) return [undefined, undefined];
  return [key.slice(0, idx), key.slice(idx + 1)];
}

/** `overrides.nodes["arch/Z"]` spelling used by warnings. */
export function orphanOverridePath(orphan: OrphanOverride): string {
  const plural = orphan.kind === "slide" ? "slides" : orphan.kind === "node" ? "nodes" : "edges";
  return `overrides.${plural}["${orphan.key}"]`;
}
