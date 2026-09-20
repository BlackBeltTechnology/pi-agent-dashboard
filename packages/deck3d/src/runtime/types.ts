/**
 * Deck runtime config — the merged-IR view the browser engine reads.
 *
 * Structural copies of `DeckIR` types; the runtime bundle is compiled with
 * esbuild from `src/runtime/index.ts` and receives `window.__DECK`.
 */
import type { Defaults, MergedSlide, PropOverride } from "../ir/types.js";

export interface RuntimeDeck {
  defaults: Defaults;
  slides: MergedSlide[];
  /** Prop placements from `overrides.props` (design D7). */
  props?: PropOverride[];
}

/** Deck defaults with one slide's overrides folded in. */
export type SlideConfig = Defaults;

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
  debug: { titleGlyphs: () => number; liftedMessage: () => string | null };
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
