/**
 * Typed handle on the root-hoisted `jsdom` for the bundled-renderer DOM tests.
 * `jsdom` ships no types and `@types/jsdom` is not in the workspace (a `.d.ts`
 * under a package `src` tree is git-ignored), so the one untyped import is
 * contained here instead of leaking `any` into every test.
 *
 * See change: add-electron-server-windows.
 */
// @ts-expect-error jsdom has no bundled types and @types/jsdom is not installed
import { JSDOM as UntypedJSDOM } from "jsdom";

/** The jsdom window: a DOM `Window` plus the globals jsdom installs on it (`Event`, `Date`, …). */
export type DomWindow = Window & typeof globalThis;

export interface DomInstance {
  window: DomWindow;
}

export const JSDOM: new (
  html?: string,
  options?: { runScripts?: "dangerously" | "outside-only"; pretendToBeVisual?: boolean; beforeParse?: (window: DomWindow) => void },
) => DomInstance = UntypedJSDOM;
