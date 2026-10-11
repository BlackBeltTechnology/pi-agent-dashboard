/**
 * `layout.json` — the deterministic slide-space description `pptx import`
 * writes and `slide-layer` draws (spec deck3d-pptx-import "Slide space and
 * layout description"). Slide space is 1920 units wide and keeps the deck's
 * aspect; every rect is in those units, origin top-left.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface LayoutRun {
  text: string;
  /** Font size in slide-space units, after the stored autofit font scale. */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Resolved `#rrggbb`. */
  color: string;
  font: string;
}

export interface LayoutParagraph {
  align: "l" | "ctr" | "r" | "just";
  /** Line spacing as a multiple of single spacing, after `lnSpcReduction`. */
  lineSpacing: number;
  /** Space before/after in slide-space units. */
  spaceBefore: number;
  spaceAfter: number;
  level: number;
  /** Bullet character when the paragraph is bulleted. */
  bullet?: string;
  runs: LayoutRun[];
}

interface ItemBase {
  /** Stable `sNN-iMMM`. */
  id: string;
  rect: Rect;
  /** Degrees, clockwise. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  /** Inherited from the slide layout or master. */
  origin?: "master";
}

export interface TextItem extends ItemBase {
  kind: "text";
  /** Placeholder type (`title`, `ctrTitle`, `body`, `subTitle`, …) when a placeholder. */
  placeholder?: string;
  anchor: "t" | "ctr" | "b";
  insets: Insets;
  vertical: boolean;
  autofit: "none" | "norm" | "shape";
  paragraphs: LayoutParagraph[];
}

export interface RectItem extends ItemBase {
  kind: "rect";
  preset: "rect" | "line" | "ellipse" | "roundRect";
  fill?: string;
  alpha: number;
  line?: { color: string; width: number };
}

export interface ImgItem extends ItemBase {
  kind: "img";
  /** Media file name under `pptx/media/`. */
  media: string;
  /** Deck asset id of `media`. */
  asset: string;
  /** Crop fractions of the source image (0–1) per side. */
  crop: Insets;
  svg?: string;
  svgAsset?: string;
}

export type FallbackConstruct =
  | "chart"
  | "smartart"
  | "table"
  | "ole"
  | "emf"
  | "wmf"
  | "wordart"
  | "shape"
  | "fill"
  | "picture-effect"
  | "media";

export interface FallbackItem extends ItemBase {
  kind: "fallback";
  construct: FallbackConstruct;
  /** Crop of the reference render; absent ⇒ outlined placeholder. */
  media?: string;
  asset?: string;
}

export type LayoutItem = TextItem | RectItem | ImgItem | FallbackItem;

export interface LayoutSlide {
  id: string;
  index: number;
  title: string;
  /** sha256 of the normalised title + the ordered text of the other (non-master) items. */
  fingerprint: string;
  background?: { color?: string; media?: string; asset?: string };
  items: LayoutItem[];
}

export interface ThemeInfo {
  colors: Record<string, string>;
  fonts: { major: string; minor: string };
}

export interface Layout {
  version: 1;
  size: { w: number; h: number };
  theme: ThemeInfo;
  slides: LayoutSlide[];
}

/** One media file the import writes, with every package part that resolved to it. */
export interface MediaFile {
  name: string;
  /** Stable deck asset id (`pptx-<first part slug>`). */
  asset: string;
  mime: string;
  bytes: Uint8Array;
  sha256: string;
}

/** Thrown for every import failure; the message is the one-line CLI reason. */
export class PptxImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PptxImportError";
  }
}
