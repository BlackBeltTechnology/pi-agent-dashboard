/**
 * Deck runtime config — the merged-IR view the browser engine reads.
 *
 * Structural copies of `DeckIR` types; the runtime bundle is compiled with
 * esbuild from `src/runtime/index.ts` and receives `window.__DECK`.
 */
import type { CardOffset, Defaults, MergedSlide, PropOverride } from "../ir/types.js";

export interface RuntimeDeck {
  defaults: Defaults;
  slides: MergedSlide[];
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
      camZ: number;
      /** Full camera position + target: the rail runs on X, so `camZ` alone cannot tell a settled camera from a travelling one. */
      cam: [number, number, number];
      camTarget: [number, number, number];
      anim: { mode: string; t: number; dur: number } | null;
    };
    /** Per diagram label: 1 = faces the camera head-on, 0 = edge-on, negative = facing away. */
    labelFacing: () => number[];
    /** Backdrop objects that leaked onto the content layer (checked by `check`). */
    backdropLeaks: () => string[];
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
