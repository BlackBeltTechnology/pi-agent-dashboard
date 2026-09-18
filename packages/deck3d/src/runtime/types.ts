/**
 * Deck runtime config — the merged-IR view the browser engine reads.
 *
 * Structural copies of `DeckIR` types; the runtime bundle is compiled with
 * esbuild from `src/runtime/index.ts` and receives `window.__DECK`.
 */
import type { Defaults, MergedSlide } from "../ir/types.js";

export interface RuntimeDeck {
  defaults: Defaults;
  slides: MergedSlide[];
}

/** Deck defaults with one slide's overrides folded in. */
export type SlideConfig = Defaults;

export interface Deck3dApi {
  gotoSlide: (index1Based: number) => void;
  setTime: (seconds: number) => void;
  ready: () => Promise<void>;
  measure: () => Measurement[];
  peaks: () => number[];
  effects: () => { active: string[]; skipped: string[] };
  debug: { titleGlyphs: () => number };
  current: () => number;
}

export interface Measurement {
  kind: "title" | "label";
  id: string;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  capHeight: number;
}

declare global {
  interface Window {
    __DECK: RuntimeDeck;
    __DECK_FONT?: string;
    __deck3d?: Deck3dApi;
  }
}
