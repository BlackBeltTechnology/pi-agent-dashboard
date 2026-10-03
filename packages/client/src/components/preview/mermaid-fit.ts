/**
 * Fit ("contain") computation for MermaidBlock's fixed-height viewport.
 * Intrinsic size is read from the SVG markup, never from the mounted rect:
 * mermaid's `useMaxWidth` output is `width="100%"`, so a mounted measurement is
 * container-constrained by construction and would always fit to 1.0.
 * See change: fix-markdown-remount-storm (D4 constraint 3).
 */

export interface Size {
  w: number;
  h: number;
}

const pos = (n: number): boolean => Number.isFinite(n) && n > 0;

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  return m ? m[1] : null;
}

/** Absolute px length ("800", "800px"); null for %, em, auto, junk. */
function absLength(v: string | null): number | null {
  if (v == null) return null;
  const m = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/i.exec(v);
  return m ? Number(m[1]) : null;
}

/** Resolution order: viewBox → absolute width/height → null (unknown). */
export function intrinsicSize(svg: string): Size | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!tag) return null;

  const vb = attr(tag, "viewBox");
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && pos(parts[2]) && pos(parts[3])) return { w: parts[2], h: parts[3] };
  }

  const w = absLength(attr(tag, "width"));
  const h = absLength(attr(tag, "height"));
  if (w != null && h != null && pos(w) && pos(h)) return { w, h };
  return null;
}

/** Contain scale `min(vw/w, vh/h)`; 1 when size or viewport is unknown. Unclamped. */
export function computeFitScale(svg: string, viewportW: number, viewportH: number): number {
  const size = intrinsicSize(svg);
  if (!size || !pos(viewportW) || !pos(viewportH)) return 1;
  const s = Math.min(viewportW / size.w, viewportH / size.h);
  return pos(s) ? s : 1;
}

/** `clamp(240px, 50vh, 640px)` as a CSS value (spec: Default viewport height). */
export const VIEWPORT_HEIGHT_CSS = "clamp(240px, 50vh, 640px)";
