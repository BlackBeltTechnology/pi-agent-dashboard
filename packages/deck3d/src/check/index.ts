/**
 * `check` driver — opens a rendered `deck.html` headless, measures every slide at
 * `t=0` and each animation peak per viewport, and applies the pure rules in
 * `rules.ts`. Contrast needs pixels; geometric rules are report-deterministic.
 */
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import {
  contrastFindings,
  type Finding,
  fitFindings,
  legibilityFindings,
  type Measurement,
  occlusionFindings,
  overlapFindings,
  type SlideRef,
} from "./rules.js";

export type { Finding, Measurement, RuleName, Severity } from "./rules.js";
export { formatFinding } from "./rules.js";

export const DEFAULT_CHECK_TIMEOUT_MS = 120_000;
export const DEFAULT_VIEWPORTS: Viewport[] = [
  { w: 1920, h: 1080 },
  { w: 1280, h: 720 },
];

export interface Viewport {
  w: number;
  h: number;
}

export interface CheckOptions {
  viewports?: Viewport[];
  slides?: number[];
  timeoutMs?: number;
}

export interface ViewportReport {
  viewport: string;
  findings: Finding[];
}

export interface CheckReport {
  viewports: ViewportReport[];
}

/** Raised when chromium is not installed; the CLI turns this into a skip. */
export class CheckUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckUnavailableError";
  }
}

export function parseViewports(spec: string | undefined): Viewport[] {
  if (!spec) return DEFAULT_VIEWPORTS;
  const out: Viewport[] = [];
  for (const part of spec.split(",")) {
    const m = /^(\d+)x(\d+)$/.exec(part.trim());
    if (m) out.push({ w: Number(m[1]), h: Number(m[2]) });
  }
  return out.length ? out : DEFAULT_VIEWPORTS;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function sampleLuminance(page: Page, rects: Array<{ x: number; y: number; w: number; h: number }>): Promise<number[]> {
  return page.evaluate((list) => {
    const src = document.querySelector("canvas");
    const out: number[] = [];
    for (const r of list) {
      if (r.w <= 0 || r.h <= 0 || !src) {
        out.push(0.5);
        continue;
      }
      const w = Math.max(1, Math.round(r.w));
      const h = Math.max(1, Math.round(r.h));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      let value = 0.5;
      if (g) {
        try {
          g.drawImage(src, r.x, r.y, w, h, 0, 0, w, h);
          const data = g.getImageData(0, 0, w, h).data;
          let sum = 0;
          let n = 0;
          for (let i = 0; i < data.length; i += 4) {
            sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
            n++;
          }
          value = n ? sum / n : 0.5;
        } catch {
          value = 0.5;
        }
      }
      out.push(value);
    }
    return out;
  }, rects);
}

function ruleFindings(measurements: Array<Measurement & { bgLuminance: number }>, viewport: Viewport, slide: SlideRef): Finding[] {
  return [
    ...fitFindings(measurements, viewport, slide),
    ...legibilityFindings(measurements, viewport.h, slide),
    ...overlapFindings(measurements, slide),
    ...occlusionFindings(measurements, slide),
    ...contrastFindings(measurements, slide),
  ];
}

async function annotate(page: Page, measurements: Measurement[]): Promise<Array<Measurement & { bgLuminance: number }>> {
  const textRects = measurements.filter((m) => m.color).map((m) => m.rect);
  const bg = textRects.length ? await sampleLuminance(page, textRects) : [];
  let bi = 0;
  return measurements.map((m) => ({ ...m, bgLuminance: m.color ? (bg[bi++] ?? 0.5) : 0.5 }));
}

async function checkSlide(page: Page, index: number, ids: string[], viewport: Viewport, findings: Finding[]): Promise<void> {
  await page.evaluate((n) => window.__deck3d?.gotoSlide(n), index);
  const peaks = await page.evaluate(() => window.__deck3d?.peaks() ?? [0]);
  const times = [...new Set([0, ...peaks.filter((t) => t > 0)])];
  for (const t of times) {
    await page.evaluate((time) => window.__deck3d?.setTime(time), t);
    const measurements = (await page.evaluate(() => window.__deck3d?.measure() ?? [])) as Measurement[];
    const annotated = await annotate(page, measurements);
    findings.push(...ruleFindings(annotated, viewport, { id: ids[index - 1] ?? `slide-${index}`, index }));
  }
}

async function checkViewport(browser: Awaited<ReturnType<typeof chromium.launch>>, htmlPath: string, viewport: Viewport, slides: number[] | undefined): Promise<ViewportReport> {
  const page = await browser.newPage({ viewport: { width: viewport.w, height: viewport.h }, deviceScaleFactor: 1 });
  const findings: Finding[] = [];
  try {
    await page.goto(pathToFileURL(htmlPath).href);
    await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
    const ids = await page.evaluate(() => window.__DECK.slides.map((s) => s.id));
    const indices = slides ?? ids.map((_, i) => i + 1);
    for (const index of indices) await checkSlide(page, index, ids, viewport, findings);
  } finally {
    await page.close();
  }
  return { viewport: `${viewport.w}x${viewport.h}`, findings };
}

/** Open `htmlPath` headless and evaluate the rules for the requested viewports. */
export async function runCheck(htmlPath: string, opts: CheckOptions = {}): Promise<CheckReport> {
  const viewports = opts.viewports ?? DEFAULT_VIEWPORTS;
  const timeoutMs = opts.timeoutMs ?? Number(process.env.DECK3D_CHECK_TIMEOUT_MS ?? DEFAULT_CHECK_TIMEOUT_MS);
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({ channel: "chromium" });
  } catch (err) {
    throw new CheckUnavailableError(`chromium not available for check — install with: npx playwright install chromium (${(err as Error).message.split("\n")[0]})`);
  }
  try {
    const report: CheckReport = { viewports: [] };
    for (const viewport of viewports) {
      const result = await withTimeout(checkViewport(browser, htmlPath, viewport, opts.slides), timeoutMs, `viewport ${viewport.w}x${viewport.h}: check timeout after ${timeoutMs} ms`);
      report.viewports.push(result);
    }
    return report;
  } finally {
    await browser.close();
  }
}
