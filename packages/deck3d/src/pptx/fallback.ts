/**
 * Visible fallbacks for constructs outside the supported matrix (design D5):
 * a crop of the slide's reference render at the item's rotated bounding
 * rect, or — without a reference — an outlined placeholder. One warning each.
 */
import { cropRgba, decodePng, encodePng, type RgbaImage } from "../art/png.js";
import type { FallbackRecord } from "./extract.js";
import type { MediaRegistry } from "./media.js";
import type { Rect } from "./types.js";

/** Axis-aligned bounding rect of `r` rotated `deg` about its centre. */
export function rotatedBounds(r: Rect, deg: number): Rect {
  const a = (deg * Math.PI) / 180;
  const w = Math.abs(r.w * Math.cos(a)) + Math.abs(r.h * Math.sin(a));
  const h = Math.abs(r.w * Math.sin(a)) + Math.abs(r.h * Math.cos(a));
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export type DecodeAny = (png: Uint8Array) => Promise<RgbaImage>;

/** Pure PNG decode, falling back to `sandbox` for PNGs the TS decoder does not read. */
export function pngDecoder(sandbox?: (bytes: Uint8Array) => Promise<RgbaImage>): DecodeAny {
  return async (png) => {
    try {
      return decodePng(png);
    } catch (err) {
      if (!sandbox) throw err;
      return sandbox(png);
    }
  };
}

/**
 * Fill `media`/`asset` on every fallback whose slide has a reference render
 * (slide id → PNG bytes) and return the warning lines.
 */
export async function applyFallbacks(
  fallbacks: FallbackRecord[],
  refs: Map<string, Uint8Array>,
  slideWidth: number,
  media: MediaRegistry,
  decode: DecodeAny,
): Promise<string[]> {
  const warnings: string[] = [];
  const decoded = new Map<string, RgbaImage>();
  for (const { slide, item } of fallbacks) {
    const ref = refs.get(slide);
    if (!ref) {
      warnings.push(`warning ${item.id} ${item.construct}: placeholder (no reference render)`);
      continue;
    }
    let img = decoded.get(slide);
    if (!img) {
      img = await decode(ref);
      decoded.set(slide, img);
    }
    const k = img.width / slideWidth;
    const b = rotatedBounds(item.rect, item.rotation);
    const crop = cropRgba(img, b.x * k, b.y * k, b.w * k, b.h * k);
    const file = media.add(encodePng(crop), "png", `pptx-fallback-${item.id}`);
    item.media = file.name;
    item.asset = file.asset;
    warnings.push(`warning ${item.id} ${item.construct}: raster fallback`);
  }
  return warnings;
}
