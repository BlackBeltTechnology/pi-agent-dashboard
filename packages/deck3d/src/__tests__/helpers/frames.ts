/**
 * WebGL frame capture + tolerant comparison for chromium tests.
 *
 * Multi-pass half-float blurs (bloom) and reflection targets are not bit-exact
 * across GPU runs — a handful of pixels drift by 1–2 levels — so "the same
 * frame" means within `expectSameFrame`'s tolerance, never `Buffer.equals`.
 * `deck.html` bytes stay exact; this is about pixels only.
 */
import type { Page } from "playwright";
import { expect } from "vitest";

/** The WebGL canvas as a data URL, posed at `t`. */
export const frameAt = async (page: Page, t: number): Promise<string> => {
  await page.evaluate((tt) => window.__deck3d!.setTime(tt), t);
  await page.waitForTimeout(120);
  return page.evaluate(() => (document.querySelector("canvas") as HTMLCanvasElement).toDataURL());
};

export interface FrameDiff {
  differing: number;
  total: number;
  maxDelta: number;
}

/** Pixel diff of the page's canvas against `other`, optionally within a CSS-px rect. */
export const frameDiff = (page: Page, other: string, rect?: { x: number; y: number; w: number; h: number }): Promise<FrameDiff> =>
  page.evaluate(
    async ({ src, r }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.querySelector("canvas") as HTMLCanvasElement;
      const grab = (draw: (x: CanvasRenderingContext2D) => void) => {
        const k = document.createElement("canvas");
        k.width = c.width;
        k.height = c.height;
        const x = k.getContext("2d") as CanvasRenderingContext2D;
        draw(x);
        const rr = r ?? { x: 0, y: 0, w: k.width, h: k.height };
        return x.getImageData(rr.x | 0, rr.y | 0, Math.max(1, rr.w | 0), Math.max(1, rr.h | 0)).data;
      };
      const A = grab((x) => x.drawImage(c, 0, 0));
      const B = grab((x) => x.drawImage(img, 0, 0));
      let differing = 0;
      let maxDelta = 0;
      for (let i = 0; i < A.length; i += 4) {
        const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
        if (d) {
          differing++;
          if (d > maxDelta) maxDelta = d;
        }
      }
      return { differing, total: A.length / 4, maxDelta };
    },
    { src: other, r: rect },
  );

export const expectSameFrame = async (page: Page, other: string, label: string): Promise<void> => {
  const d = await frameDiff(page, other);
  expect(d.maxDelta, `${label}: channel delta`).toBeLessThanOrEqual(4);
  expect(d.differing / d.total, `${label}: differing pixel share`).toBeLessThan(0.0001);
};

/** Mean luminance of the rendered canvas inside a CSS-px rect. */
export const meanLum = (page: Page, rect: { x: number; y: number; w: number; h: number }): Promise<number> =>
  page.evaluate((r) => {
    const src = document.querySelector("canvas") as HTMLCanvasElement;
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const x = c.getContext("2d") as CanvasRenderingContext2D;
    x.drawImage(src, 0, 0);
    const d = x.getImageData(Math.max(0, r.x | 0), Math.max(0, r.y | 0), Math.max(1, r.w | 0), Math.max(1, r.h | 0)).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4);
  }, rect);
