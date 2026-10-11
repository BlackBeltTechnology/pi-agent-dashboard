/**
 * Deterministic stub asset bundle for the imported-pptx built-ins: a sample
 * layout, an outline, a polyline icon and a chrome image. Powers `fx preview`
 * (copied to `assets/preview/`) and the `business-2031` coverage fixture
 * (`fixtures/business-2031/assets/`). Generated, never hand-edited:
 * `tsx scripts/gen-stub-assets.ts` rewrites both copies, and a test fails
 * when they drift from this module.
 */

import type { IconOutput } from "../art/icon.js";
import { encodePng } from "../art/png.js";
import type { Outline } from "../art/trace.js";
import type { Layout, LayoutItem } from "../pptx/types.js";

export const STUB_SLIDE = "s01";

const base = { rotation: 0, flipH: false, flipV: false };
const run = (text: string, size: number, color = "#161e23") => ({ text, size, bold: true, italic: false, underline: false, color, font: "Poppins" });
const para = (text: string, size: number, bullet?: string) => ({ align: "l" as const, lineSpacing: 1, spaceBefore: 0, spaceAfter: 12, level: 0, ...(bullet ? { bullet } : {}), runs: [run(text, size)] });
const text = (id: string, x: number, y: number, w: number, h: number, paragraphs: ReturnType<typeof para>[], placeholder?: string): LayoutItem => ({
  id,
  kind: "text",
  rect: { x, y, w, h },
  ...base,
  ...(placeholder ? { placeholder } : {}),
  anchor: "t",
  insets: { l: 14.4, t: 7.2, r: 14.4, b: 7.2 },
  vertical: false,
  autofit: "none",
  paragraphs,
});

export function stubLayout(): Layout {
  return {
    version: 1,
    size: { w: 1920, h: 1080 },
    theme: { colors: { dk1: "#161e23", lt1: "#ffffff", accent1: "#f67519", accent2: "#4472c4" }, fonts: { major: "Poppins", minor: "Poppins" } },
    slides: [
      {
        id: STUB_SLIDE,
        index: 1,
        title: "Stub slide",
        fingerprint: "stub",
        background: { color: "#ffffff" },
        items: [
          text("s01-i001", 120, 80, 1100, 160, [para("Stub slide", 88)], "title"),
          text("s01-i002", 120, 300, 900, 360, [para("First point", 48, "\u2022"), para("Second point", 48, "\u2022")]),
          { id: "s01-i003", kind: "rect", rect: { x: 120, y: 760, w: 600, h: 70 }, ...base, preset: "roundRect", fill: "#f67519", alpha: 1 },
          { id: "s01-i004", kind: "img", rect: { x: 1300, y: 300, w: 400, h: 400 }, ...base, media: "stub-chrome.png", asset: "stub-chrome", crop: { l: 0, t: 0, r: 0, b: 0 } },
          { id: "s01-i005", kind: "img", rect: { x: 1480, y: 100, w: 140, h: 140 }, ...base, media: "stub-chrome.png", asset: "stub-chrome", crop: { l: 0, t: 0, r: 0, b: 0 } },
        ],
      },
    ],
  };
}

export function stubOutline(): Outline {
  return {
    version: 1,
    width: 100,
    height: 100,
    polygons: [
      {
        color: "#f67519",
        outer: [[0, 0], [100, 0], [100, 100], [0, 100]],
        holes: [[[30, 30], [30, 70], [70, 70], [70, 30]]],
      },
    ],
  };
}

export function stubIcon(): IconOutput {
  return {
    version: 1,
    viewBox: [0, 0, 24, 24],
    polylines: [
      { points: [[12, 3], [19, 7], [19, 17], [12, 21], [5, 17], [5, 7]], width: 2, closed: true },
      { points: [[8.5, 12.5], [11, 15], [16, 9]], width: 2, closed: false },
    ],
  };
}

/** 64×64 corner mark: opaque orange above the anti-diagonal, transparent below. */
export function stubChrome(): Uint8Array {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (x + y < n) data.set([0xf6, 0x75, 0x19, 255], (y * n + x) * 4);
  return encodePng({ width: n, height: n, data });
}

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/** File name → bytes, as written to both asset directories. */
export function stubFiles(): Record<string, string | Uint8Array> {
  return {
    "stub-layout.json": json(stubLayout()),
    "stub-outline.json": json(stubOutline()),
    "stub-icon.json": json(stubIcon()),
    "stub-chrome.png": stubChrome(),
  };
}

export const STUB_ASSET_META: Array<{ id: string; file: string; mime: string }> = [
  { id: "stub-chrome", file: "stub-chrome.png", mime: "image/png" },
  { id: "stub-icon", file: "stub-icon.json", mime: "application/json" },
  { id: "stub-layout", file: "stub-layout.json", mime: "application/json" },
  { id: "stub-outline", file: "stub-outline.json", mime: "application/json" },
];

/** Params that make each built-in render the stub bundle (`fx preview`, fixture). */
export const STUB_PARAMS: Record<string, Record<string, unknown>> = {
  "slide-layer": { layout: "stub-layout", slide: STUB_SLIDE, mode: "free" },
  art3d: { outline: "stub-outline", scale: 3.2, sway: 0.3, sweep: true },
  icon3d: { asset: "stub-icon", layout: "stub-layout", slide: STUB_SLIDE, item: "s01-i005", card: true },
  "frame-chrome": { layers: [{ asset: "stub-chrome", anchor: "tl", size: 0.28 }, { asset: "stub-chrome", anchor: "br", size: 0.28 }] },
  haze: {},
};
