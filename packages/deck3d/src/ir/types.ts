/**
 * TypeScript mirror of `schema.json`. The schema is the source of truth for
 * validation; these types are the compile-time view used by the engine.
 */

export type Mode = "dark" | "light";
export type Palette =
  | "blackbelt"
  | "zenit"
  | "dapp"
  | "midnight"
  | "ember"
  | "arctic"
  | "forest"
  | "mono"
  | "neon"
  | "custom";
export type Material = "glass" | "metal" | "matte";
export type Quality = "low" | "medium" | "high";
export type NodeShape =
  | "rect"
  | "stadium"
  | "round"
  | "hexagon"
  | "circle"
  | "doublecircle"
  | "diamond"
  | "cylinder";
export type EdgeKind = "normal" | "dotted" | "thick";
/** Topologies `builders.ts` can raise from `diagram.data` alone (no mermaid harvest). */
export type BuiltDiagramKind =
  | "none"
  | "brain"
  | "loop"
  | "swarm"
  | "bars"
  | "funnel"
  | "timeline-rail"
  | "globe"
  | "orbit-cluster"
  | "stack";
export type DiagramKind = BuiltDiagramKind | "flowchart" | "sequence";

/** Label/value series driving a built topology. Atomic: an override replaces it whole. */
export interface DiagramData {
  labels?: string[];
  values?: number[];
}
export type FlowchartDir = "TD" | "TB" | "BT" | "LR" | "RL";

export interface EffectRef {
  /** Corpus id (`bloom`), or `local:<name>` for a module in `fx/` beside the deck. */
  id: string;
  /** Lowercase hex sha256 of `fx/<name>.js`. Required for `local:` ids, forbidden otherwise. */
  sha256?: string;
  params?: Record<string, unknown>;
}

export interface PropOverride {
  source: "vendored" | "poly-pizza" | "generated";
  id: string;
  licence: string;
  author: string;
  sha256: string;
  slide: string;
  role: string;
  size?: number;
  count?: number;
  restyle?: "palette" | "original";
  anim?: "none" | "float" | "orbit" | "spin";
}

/** Slide composition presets. `split` is the v1 look (title + card left, diagram right). */
export type Layout = "split" | "split-reverse";

/** Topology the slides are strung along (deck-level). `line` is the v1 rail. */
export type Rail = "line" | "orbit" | "tunnel" | "helix" | "grid";

/** Contour treatment for extruded title glyphs. */
export type TitleEdge = "none" | "contrast";

/** World-unit nudge on the text card, applied after the layout preset places it. */
export interface CardOffset {
  x?: number;
  y?: number;
}

export interface CameraKnobs {
  distance?: number;
}

export interface LabelKnobs {
  size?: number;
}

export interface CheckKnobs {
  ignore?: string[];
}

export interface Defaults extends CameraKnobs, LabelKnobs, CheckKnobs {
  mode?: Mode;
  palette?: Palette;
  colors?: { card?: string; accent?: string; secondary?: string };
  material?: Material;
  envReflections?: boolean;
  mirrorFloor?: boolean;
  /** Floor surface: reflective plane (default) or animated water. */
  floor?: "mirror" | "water";
  softShadows?: boolean;
  bloom?: boolean;
  rimLight?: boolean;
  fog?: boolean;
  backgroundIntensity?: number;
  transition?: string;
  durationSec?: number;
  depthRelief?: number;
  quality?: Quality;
  extrudeDepth?: number;
  /** Contour on extruded title glyphs: `contrast` paints the side walls in the palette text colour. */
  titleEdge?: TitleEdge;
  autoStyle?: boolean;
  layout?: Layout;
  /** Slide topology. Deck-level only. */
  rail?: Rail;
  /** World-unit gap between slide anchors. Deck-level only; also scales the cull radius. */
  spacing?: number;
  camera?: CameraKnobs;
  labels?: LabelKnobs;
  check?: CheckKnobs;
}

export interface DiagramNode {
  id: string;
  label: string;
  shape: NodeShape;
  x: number;
  y: number;
  w: number;
  h: number;
  group?: string;
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
  path: Array<[number, number]>;
}

export interface DiagramGroup {
  id: string;
  title: string;
  nodes: string[];
}

export interface DiagramActor {
  id: string;
  label: string;
}

export interface DiagramMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  kind: "solid" | "dotted";
}

export interface Diagram {
  kind: DiagramKind;
  data?: DiagramData;
  dir?: FlowchartDir;
  scale?: number;
  offset?: { x?: number; y?: number };
  nodes?: DiagramNode[];
  edges?: DiagramEdge[];
  groups?: DiagramGroup[];
  actors?: DiagramActor[];
  messages?: DiagramMessage[];
}

export interface Slide {
  index: number;
  id: string;
  kind?: "title" | "content" | "section" | "credits";
  title: string;
  subtitle?: string;
  bullets: string[];
  scene: string;
  diagram: Diagram;
  layout?: Layout;
  cardOffset?: CardOffset;
  camera?: CameraKnobs;
  labels?: LabelKnobs;
  check?: CheckKnobs;
  effects?: EffectRef[];
}

export interface Overrides {
  deck?: Defaults;
  effects?: EffectRef[];
  props?: PropOverride[];
  slides?: Record<string, SlideOverride>;
  nodes?: Record<string, NodeOverride>;
  edges?: Record<string, EdgeOverride>;
}

export interface SlideOverride {
  mode?: Mode;
  palette?: Palette;
  material?: Material;
  titleEdge?: TitleEdge;
  transition?: string;
  quality?: Quality;
  scene?: string;
  backgroundIntensity?: number;
  diagram?: { kind?: BuiltDiagramKind; data?: DiagramData; scale?: number; offset?: { x?: number; y?: number } };
  layout?: Layout;
  cardOffset?: CardOffset;
  camera?: CameraKnobs;
  labels?: LabelKnobs;
  check?: CheckKnobs;
  effects?: EffectRef[];
}

export interface NodeOverride {
  shape?: NodeShape;
  label?: string;
  position?: { x?: number; y?: number; z?: number };
  size?: { w?: number; h?: number };
  material?: Material;
}

export interface EdgeOverride {
  kind?: EdgeKind;
  material?: Material;
}

export interface DeckMeta {
  source?: string;
  engine?: string;
  mermaid?: string;
  derivedHash?: string;
}

export interface DeckIR {
  meta: DeckMeta;
  defaults: Defaults;
  slides: Slide[];
  overrides: Overrides;
}

/** A diagram node with node-override nudges folded in. Render-only. */
export interface MergedNode extends DiagramNode {
  position?: { x?: number; y?: number; z?: number };
  size?: { w?: number; h?: number };
  material?: Material;
}

export interface MergedDiagram extends Omit<Diagram, "nodes"> {
  nodes?: MergedNode[];
}

/** A slide with overrides applied. Render-only. */
export interface MergedSlide extends Omit<Slide, "diagram"> {
  diagram: MergedDiagram;
}

/** A fully merged view: derived values with overrides applied. Render-only. */
export interface MergedDeck {
  defaults: Defaults;
  slides: MergedSlide[];
  /** Deck-level effect list applied to every slide (render-only runtime input). */
  effects?: EffectRef[];
  /** Prop placements from `overrides.props` (render-only runtime input). */
  props?: PropOverride[];
  /**
   * Dotted key paths that came from `overrides`, so the configurator can mark
   * them `●`. The merged view has folded the overrides in and cannot tell
   * otherwise; the `overrides` block itself is deliberately not embedded.
   */
  overriddenKeys?: { deck: string[]; slides: Record<string, string[]> };
  /** `meta.derivedHash`, carried through so the configurator can key its state per deck. */
  derivedHash?: string;
}
