/**
 * `deck3d compare <deck.html>` (spec deck3d-variant-loop "Compare against the
 * original"): per slide with a reference render, a score of how closely the
 * rest-state frame matches it; a font-fallback report; optional transition
 * frames for review.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { decodePng, type RgbaImage } from "../art/png.js";
import { closeQuietly } from "../util/cleanup.js";
import { scoreFrame } from "./ssim.js";

export interface CompareOptions {
  html: string;
  /** Default `<html dir>/pptx/ref`. */
  refDir?: string;
  viewport?: { width: number; height: number };
  threshold?: number;
  transition?: boolean;
  /** Default `<html dir>/compare`. */
  outDir?: string;
}

export interface SlideScore {
  slide: string;
  index: number;
  score: number;
  rgb: number;
  below: boolean;
}

export interface CompareReport {
  threshold: number;
  scores: SlideScore[];
  fallbacks: string[];
  transitions: string[];
  /** Slides without a reference render. */
  unreferenced: string[];
}

export const DEFAULT_THRESHOLD = 0.85;
/** 8K UHD (7680×4320 ≈ 33 MP) fits; reference PNGs keep the stricter default cap. */
const SNAPSHOT_MAX_PIXELS = 64 * 1024 * 1024;

export class CompareUnavailableError extends Error {
  constructor() {
    super("chromium missing (npx playwright install chromium)");
    this.name = "CompareUnavailableError";
  }
}

/** Slide aspect: `pptx/layout.json` beside the deck, else the reference image's. */
function aspectOf(htmlDir: string, ref: RgbaImage): number {
  const f = join(htmlDir, "pptx", "layout.json");
  if (existsSync(f)) {
    const size = (JSON.parse(readFileSync(f, "utf8")) as { size?: { w: number; h: number } }).size;
    if (size?.w && size.h) return size.w / size.h;
  }
  return ref.width / ref.height;
}

export async function compareDeck(opts: CompareOptions): Promise<CompareReport> {
  const htmlDir = dirname(opts.html);
  const refDir = opts.refDir ?? join(htmlDir, "pptx", "ref");
  const vp = opts.viewport ?? { width: 1920, height: 1080 };
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  let browser: import("playwright").Browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ channel: "chromium" });
  } catch {
    throw new CompareUnavailableError();
  }
  const scores: SlideScore[] = [];
  const unreferenced: string[] = [];
  const transitions: string[] = [];
  let fallbacks: string[] = [];
  try {
    const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
    try {
      await page.goto(pathToFileURL(opts.html).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 60_000 });
      await page.evaluate(() => window.__deck3d?.ready());
      const ids = await page.evaluate(() => window.__DECK.slides.map((s) => s.id));
      const settle = async (n: number) => {
        await page.evaluate(
          ([slide]) => {
            window.__deck3d?.gotoSlide(slide);
            window.__deck3d?.setTime(0);
          },
          [n] as [number],
        );
        await page.evaluate(() => window.__deck3d?.ready());
        await page.waitForTimeout(150);
      };
      for (let i = 0; i < ids.length; i++) {
        const refFile = join(refDir, `${ids[i]}.png`);
        if (!existsSync(refFile)) {
          unreferenced.push(ids[i]);
          continue;
        }
        const reference = decodePng(new Uint8Array(readFileSync(refFile)));
        await settle(i + 1);
        // Our own browser snapshot (trusted, viewport-sized): a larger cap than for reference files.
        const snap = decodePng(new Uint8Array(await page.screenshot()), SNAPSHOT_MAX_PIXELS);
        const { score, rgb } = scoreFrame(snap, reference, aspectOf(htmlDir, reference));
        scores.push({ slide: ids[i], index: i + 1, score, rgb, below: score < threshold });
      }
      fallbacks = await page.evaluate(() => window.__deck3d?.fonts().fallbacks ?? []);
      if (opts.transition) {
        const dir = join(opts.outDir ?? join(htmlDir, "compare"), "transitions");
        mkdirSync(dir, { recursive: true });
        for (let i = 0; i + 1 < ids.length; i++) {
          for (const pct of [25, 50, 75]) {
            await page.evaluate(([a, b, p]) => window.__deck3d?.debug.transitionAt(a, b, p), [i + 1, i + 2, pct / 100] as [number, number, number]);
            await page.waitForTimeout(60);
            const file = join(dir, `${ids[i]}-${ids[i + 1]}-${pct}.png`);
            writeFileSync(file, await page.screenshot());
            transitions.push(file);
          }
        }
      }
    } finally {
      await closeQuietly(page);
    }
  } finally {
    await closeQuietly(browser);
  }
  return { threshold, scores, fallbacks, transitions, unreferenced };
}
