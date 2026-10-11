/**
 * Image comparison for `deck3d compare` (design D8): luminance SSIM over 8×8
 * windows with the standard constants (C1 = (0.01·255)², C2 = (0.03·255)²),
 * averaged and rounded to 0.001, plus the mean absolute RGB difference.
 * Both images must have the same size.
 */
import { cropRgba, type RgbaImage, resizeRgba } from "../art/png.js";

const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;
const WINDOW = 8;

function luma(img: RgbaImage): Float64Array {
  const out = new Float64Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];
  return out;
}

export function ssim(a: RgbaImage, b: RgbaImage): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`ssim: size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  const la = luma(a);
  const lb = luma(b);
  let sum = 0;
  let n = 0;
  for (let by = 0; by + WINDOW <= a.height; by += WINDOW) {
    for (let bx = 0; bx + WINDOW <= a.width; bx += WINDOW) {
      let ma = 0;
      let mb = 0;
      for (let y = 0; y < WINDOW; y++) {
        for (let x = 0; x < WINDOW; x++) {
          const i = (by + y) * a.width + bx + x;
          ma += la[i];
          mb += lb[i];
        }
      }
      const N = WINDOW * WINDOW;
      ma /= N;
      mb /= N;
      let va = 0;
      let vb = 0;
      let cov = 0;
      for (let y = 0; y < WINDOW; y++) {
        for (let x = 0; x < WINDOW; x++) {
          const i = (by + y) * a.width + bx + x;
          va += (la[i] - ma) ** 2;
          vb += (lb[i] - mb) ** 2;
          cov += (la[i] - ma) * (lb[i] - mb);
        }
      }
      va /= N - 1;
      vb /= N - 1;
      cov /= N - 1;
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n++;
    }
  }
  return n ? Math.round((sum / n) * 1000) / 1000 : 1;
}

/** Mean absolute RGB difference, 0–255. */
export function rgbDiff(a: RgbaImage, b: RgbaImage): number {
  let sum = 0;
  const px = a.width * a.height;
  for (let i = 0; i < px; i++) for (let c = 0; c < 3; c++) sum += Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c]);
  return Math.round((sum / (px * 3)) * 100) / 100;
}

/** The slide aspect contain-fitted into the viewport, in integer CSS px. */
export function frameRect(vw: number, vh: number, aspect: number): { x: number; y: number; w: number; h: number } {
  if (vw / vh > aspect) {
    const w = Math.round(vh * aspect);
    return { x: Math.round((vw - w) / 2), y: 0, w, h: vh };
  }
  const h = Math.round(vw / aspect);
  return { x: 0, y: Math.round((vh - h) / 2), w: vw, h };
}

export const COMPARE_WIDTH = 480;

/**
 * Score a full-viewport snapshot against a reference: crop the snapshot to the
 * slide frame (bars outside it never count), resize both to 480 px wide.
 */
export function scoreFrame(snapshot: RgbaImage, reference: RgbaImage, aspect: number): { score: number; rgb: number } {
  const f = frameRect(snapshot.width, snapshot.height, aspect);
  const crop = cropRgba(snapshot, f.x, f.y, f.w, f.h);
  const h = Math.max(8, Math.round((COMPARE_WIDTH * f.h) / f.w));
  const a = resizeRgba(crop, COMPARE_WIDTH, h);
  const b = resizeRgba(reference, COMPARE_WIDTH, h);
  return { score: ssim(a, b), rgb: rgbDiff(a, b) };
}
