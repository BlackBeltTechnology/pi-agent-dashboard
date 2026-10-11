/**
 * Effect corpus types — one interface every effect module implements, plus the
 * metadata card schema (design D9). Cards are the LLM's typed catalogue.
 */
import type * as THREE from "three";
import type { PaletteColors } from "../runtime/palette.js";
import type { QualityProfile } from "../runtime/quality.js";

/**
 * `layer` effects draw slide CONTENT on the content layer (above the backdrop
 * pass) — the imported-pptx built-ins. They are exempt from `fx-content-layer`.
 */
export type FxKind = "background" | "post" | "material" | "light" | "motion" | "edge" | "transition" | "layer";
export type FxMode = "dark" | "light" | "both";

/** Scalar params drive panel controls; structured ones (lists, id maps) are deck.json-only. */
export type FxParams = Record<string, number | string | boolean | unknown[] | Record<string, unknown>>;

/**
 * Closed topic vocabulary (design D3). `parse` routes a content slide to the
 * cheapest `background` card carrying the matched topic, so the list is a
 * contract between the keyword table and the corpus — not free-form like
 * `tags.content`.
 */
export const FX_TOPICS = [
  "ai",
  "agents",
  "geo",
  "trust",
  "security",
  "compute",
  "data",
  "money",
  "work",
  "timeline",
  "sales",
  "process",
] as const;
export type FxTopic = (typeof FX_TOPICS)[number];

export interface FxCard {
  id: string;
  kind: FxKind;
  tags: { mood: string[]; content: string[]; topic?: FxTopic[] };
  cost: number;
  modes: FxMode;
  /** JSON Schema (object) for the effect's `params`. */
  params: Record<string, unknown>;
  conflicts: string[];
  source: string;
  licence: string;
  /**
   * When any effect composed on a slide declares it, the runtime builds none
   * of that slide's native title, subtitle, bullet card or diagram, and
   * `measure()` reports none of them (`slide-layer`).
   */
  replacesContent?: boolean;
  /**
   * Deck-scope only: created once per deck load, kept outside every slide
   * group, driven by `FxHandle.transition` every frame (`frame-chrome`).
   */
  persistent?: boolean;
}

export interface FxContext {
  THREE: typeof THREE;
  palette: PaletteColors;
  mode: "dark" | "light";
  quality: QualityProfile;
  /** Seeded LCG — the only randomness an effect may use (keeps render deterministic). */
  rng: () => number;
  /** Read-only metadata of the slide the effect is being built for. */
  slide: { id: string; title: string; kind: string };
  /** Read-only deck asset accessor; `get(id)` throws for an unknown id. */
  assets: { get(id: string): unknown; has(id: string): boolean };
  /** Camera access for `layer` and persistent corpus effects (absent for local effects). */
  view?: FxView;
}

export interface FxView {
  camera: THREE.PerspectiveCamera;
  /**
   * The slide's SETTLED camera pose in the effect's parent space (the slide
   * group): where the camera rests and what it looks at. Placement derives from
   * this, never from hardcoded numbers.
   */
  pose: { cam: [number, number, number]; target: [number, number, number]; fov: number };
  /** Current viewport in CSS px. */
  viewport(): { width: number; height: number };
}

/** Screen-space text record an effect registers with `measure()` (kind `layer-text`). */
export interface FxMeasure {
  id: string;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  capHeight: number;
  color?: string;
}

/** Transition state handed to persistent effects every frame. */
export interface FxTransition {
  /** Slide indices (0-based); equal when settled. */
  from: number;
  to: number;
  /** Progress 0–1; 1 when settled. */
  p: number;
}

export interface FxHandle {
  object?: THREE.Object3D;
  /** A composer pass id (post effects) or other runtime hook name. */
  pass?: string;
  material?: THREE.Material;
  tick?: (t: number) => void;
  /**
   * Slide settled (true) or the camera is flying / the slide is off-screen
   * (false). Time-based media uses this to stay frozen until it is actually
   * being looked at; a pinned time in `check` never sees a moving clip.
   */
  setActive?: (active: boolean) => void;
  /** Persistent effects only: called every frame with the transition state. */
  transition?: (state: FxTransition) => void;
  /**
   * Text the effect draws, projected to CSS px through `camera` at the given
   * viewport, so `check`'s fit/legibility/overlap/contrast rules apply to it.
   */
  measure?: (camera: unknown, width: number, height: number) => FxMeasure[];
  /** Font names the effect drew with a fallback (`__deck3d.fonts()`). */
  fontFallbacks?: () => string[];
  dispose: () => void;
}

export type FxFactory = (ctx: FxContext, params: FxParams) => FxHandle;

export interface FxEntry {
  card: FxCard;
  create: FxFactory;
}

/** SPDX ids the corpus admits (design D9). */
export const PERMISSIVE_LICENCES = ["MIT", "Zlib", "BSD-2-Clause", "BSD-3-Clause", "CC0-1.0", "Apache-2.0", "OFL-1.1"] as const;
