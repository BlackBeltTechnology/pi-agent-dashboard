/**
 * Deck runtime config — the merged-IR view the browser engine reads.
 *
 * Structural copies of `DeckIR` types; the runtime bundle is compiled with
 * esbuild from `src/runtime/index.ts` and receives `window.__DECK`.
 */
import type { CardOffset, Defaults, EffectRef, MergedSlide, PropOverride } from "../ir/types.js";

export interface RuntimeDeck {
  defaults: Defaults;
  slides: MergedSlide[];
  /**
   * Deck-level effect list. `applyOverrides` PREPENDS it to every slide's
   * effects, so the panel needs it to tell an inherited slot from the slide's
   * own. Already embedded (the whole `MergedDeck` is) — only undeclared.
   */
  effects?: EffectRef[];
  /** Prop placements from `overrides.props` (design D7). */
  props?: PropOverride[];
}

/** Deck defaults with one slide's overrides folded in (incl. slide-only knobs). */
export type SlideConfig = Defaults & { cardOffset?: CardOffset };

export interface Deck3dApi {
  gotoSlide: (index1Based: number) => void;
  setTime: (seconds: number) => void;
  ready: () => Promise<void>;
  measure: () => Measurement[];
  peaks: () => number[];
  effects: () => {
    active: string[];
    skipped: string[];
    budget: { sum: number; limit: number; warning?: string };
    /** Local-effect failures, `{ slide, effectId, phase }` (design D1). */
    errors: Array<{ slide: string; effectId: string; phase: "create" | "tick" | "dispose" }>;
  };
  debug: {
    titleGlyphs: () => number;
    liftedMessage: () => string | null;
    look: () => {
      bg: string;
      fog: string;
      rim: string;
      title: string;
      /** Glyph side-wall contour colour; `""` when `titleEdge` is off. */
      titleEdge: string;
      camZ: number;
      /** Full camera position + target: the rail runs on X, so `camZ` alone cannot tell a settled camera from a travelling one. */
      cam: [number, number, number];
      camTarget: [number, number, number];
      anim: { mode: string; t: number; dur: number } | null;
      /** Which floor surface is showing. */
      floor: "mirror" | "water" | "none";
      /** Whether backdrop geometry (backgrounds, local fx) is in the reflection. */
      reflectBackdrop: boolean;
      /** Floor roughness in the shader: 0 = mirror, 1 = fully scattered. */
      floorMatte: number;
      /** Reflection strength in the shader: 1 = full mirror, 0 = none. */
      floorReflectivity: number;
      /** Key-light target: the centre of the shadow frustum, which must track the slide. */
      keyTarget: [number, number, number];
      /** Rim-spot position, offset from the slide it lights. */
      rimPos: [number, number, number];
    };
    /** Per diagram label: 1 = faces the camera head-on, 0 = edge-on, negative = facing away. */
    labelFacing: () => number[];
    /** Backdrop objects that leaked onto the content layer (checked by `check`). */
    backdropLeaks: () => string[];
    /**
     * Shadow-pipeline state as the RENDERER sees it: whether the map is on,
     * the key light's frustum, and the live caster/receiver counts with their
     * layer masks. `castShadow` flags in the builders say nothing about
     * whether a shadow reaches the frame.
     */
    shadows: () => {
      enabled: boolean;
      autoUpdate: boolean;
      camera: { left: number; right: number; top: number; bottom: number; near: number; far: number; pos: [number, number, number]; castShadow: boolean };
      casters: string[];
      receivers: string[];
      casterCount: number;
      receiverCount: number;
    };
    /** Fingerprint of the current slide's animated transforms. */
    motion: () => string;
    /** Every slide's live anchor, for rail/spacing assertions. */
    localFx: () => Array<{ id: string; digest: string }>;
    localFxAt: (index: number) => number;
    sceneNodes: () => number;
    anchors: () => Array<{ pos: [number, number, number]; rotY: number }>;
    /** Every registered post pass: enabled for the current slide, and the params it was last applied with. */
    post: () => Array<{ id: string; enabled: boolean; params: Record<string, number | string | boolean> }>;
  };
  current: () => number;
}

export interface Measurement {
  kind: "title" | "label" | "node";
  id: string;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  capHeight: number;
  /** Owner id of the first raycast hit between camera and label centre. */
  hit?: string | null;
  /** Label fill colour (canvas labels only). */
  color?: string | null;
}

declare global {
  interface Window {
    __DECK: RuntimeDeck;
    __DECK_FONT?: string;
    /** Base64 GLB bytes keyed `<source>-<id>`. */
    __DECK_PROPS?: Record<string, string>;
    __deck3d?: Deck3dApi;
  }
}
