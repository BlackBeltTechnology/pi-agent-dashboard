/**
 * `check` driver — opens a rendered `deck.html` headless, measures every slide at
 * `t=0` and each animation peak per viewport, and applies the pure rules in
 * `rules.ts`. Contrast needs pixels; geometric rules are report-deterministic.
 */
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import {
  type BudgetInfo,
  budgetFindings,
  contrastFindings,
  type Finding,
  filterIgnored,
  fitFindings,
  legibilityFindings,
  localFxErrorFindings,
  localFxNetworkFindings,
  type Measurement,
  occlusionFindings,
  overlapFindings,
  type SlideRef,
  skippedFindings,
  type StyleSlide,
  styleFindings,
} from "./rules.js";

export type { Finding, Measurement, RuleName, Severity } from "./rules.js";
export { formatFinding, NON_DETERMINISTIC_RULES } from "./rules.js";

/** `effects().errors` entry, as the runtime reports it. */
interface LocalFxErrorRecord {
  slide: string;
  effectId: string;
  phase: "create" | "tick" | "dispose";
}

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
  /** Report `style-defaults` warnings for slides still on parse defaults (D7). */
  style?: boolean;
}

/** Schemes a self-contained deck may legitimately load from. */
const LOCAL_SCHEMES = new Set(["file:", "data:", "blob:", "about:"]);

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
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: pixel sampling is inherently branchy (guard + try/catch + loop)
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

async function checkSlide(
  page: Page,
  index: number,
  ids: string[],
  viewport: Viewport,
  findings: Finding[],
  onSlide?: (id: string) => void,
): Promise<void> {
  const slideRef = { id: ids[index - 1] ?? `slide-${index}`, index };
  // Tell the route handler which slide any blocked request belongs to.
  onSlide?.(slideRef.id);
  await page.evaluate((n) => window.__deck3d?.gotoSlide(n), index);
  // Merged per-slide `check.ignore` (derived slide + override), applied per viewport.
  const ignore = (await page.evaluate((i) => (window.__DECK.slides[i - 1]?.check?.ignore ?? []) as string[], index)) as string[];
  const slideFindings: Finding[] = [];
  const peaks = await page.evaluate(() => window.__deck3d?.peaks() ?? [0]);
  const times = [...new Set([0, ...peaks.filter((t) => t > 0)])];
  for (const t of times) {
    await page.evaluate((time) => window.__deck3d?.setTime(time), t);
    const measurements = (await page.evaluate(() => window.__deck3d?.measure() ?? [])) as Measurement[];
    const annotated = await annotate(page, measurements);
    slideFindings.push(...ruleFindings(annotated, viewport, slideRef));
  }
  const effects = (await page.evaluate(() => window.__deck3d?.effects() ?? {
    active: [],
    skipped: [],
    budget: { sum: 0, limit: 0 },
    errors: [],
  })) as { skipped: string[]; budget: BudgetInfo; errors?: LocalFxErrorRecord[] };
  slideFindings.push(...skippedFindings(effects.skipped ?? [], slideRef));
  slideFindings.push(...budgetFindings(effects.budget, slideRef));
  slideFindings.push(...localFxErrorFindings(effects.errors ?? [], slideRef));
  findings.push(...filterIgnored(slideFindings, ignore));
}

async function checkViewport(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  htmlPath: string,
  viewport: Viewport,
  opts: CheckOptions,
): Promise<ViewportReport> {
  const page = await browser.newPage({ viewport: { width: viewport.w, height: viewport.h }, deviceScaleFactor: 1 });
  const findings: Finding[] = [];
  const hits: Array<{ slide: string; host: string }> = [];
  let current = "";
  try {
    // "Offline" is measured, not assumed: every non-local request is blocked
    // and reported against the slide being measured.
    await page.route("**/*", (route) => {
      const url = route.request().url();
      const scheme = url.slice(0, url.indexOf(":") + 1);
      if (LOCAL_SCHEMES.has(scheme)) return route.continue();
      try {
        hits.push({ slide: current, host: new URL(url).host });
      } catch {
        hits.push({ slide: current, host: url });
      }
      return route.abort();
    });
    await clearHudState(page);

    await page.goto(pathToFileURL(htmlPath).href);
    await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
    const ids = await page.evaluate(() => window.__DECK.slides.map((s) => s.id));
    current = ids[0] ?? "";
    const indices = opts.slides ?? ids.map((_, i) => i + 1);
    for (const index of indices) {
      await checkSlide(page, index, ids, viewport, findings, (id) => {
        current = id;
      });
    }
    if (opts.style) findings.push(...(await styleFindingsFor(page)));
    // Every slide is built at load, so a request can fire before any slide is
    // being measured. That is a deck-level property; attribute it to slide 1
    // rather than dropping it or inventing a per-effect owner.
    for (const hit of hits) {
      if (!hit.slide) hit.slide = ids[0] ?? "";
    }
    findings.push(...localFxNetworkFindings(hits, ids.map((id, i) => ({ id, index: i + 1 }))));
  } finally {
    await page.close();
  }
  return { viewport: `${viewport.w}x${viewport.h}`, findings };
}

/**
 * The configurator persists per-deck state under `deck3d:<derivedHash>`;
 * `check` must measure a deck as a fresh viewer sees it, not as the last
 * person to fiddle with the panel left it.
 */
export async function clearHudState(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("deck3d:")) localStorage.removeItem(key);
    }
  });
}

/** Recompute the parse defaults for the embedded deck and compare (D7). */
async function styleFindingsFor(page: Page): Promise<Finding[]> {
  const deck = (await page.evaluate(() => ({
    slides: window.__DECK.slides.map((s) => ({
      id: s.id,
      title: s.title,
      bullets: s.bullets ?? [],
      diagram: { kind: s.diagram?.kind ?? "none" },
      effects: (s.effects ?? []).map((e) => ({ id: e.id })),
    })),
    propSlides: ((window.__DECK as { props?: Array<{ slide: string }> }).props ?? []).map((p) => p.slide),
    autoStyle: (window.__DECK.defaults as { autoStyle?: boolean }).autoStyle !== false,
  }))) as { slides: StyleSlide[]; propSlides: string[]; autoStyle: boolean };

  const { defaultEffectsFor } = await import("../fx/defaults.js");
  const { builtKindFor } = await import("../parse/derive.js");
  return styleFindings(
    deck.slides,
    new Set(deck.propSlides),
    (slide) =>
      defaultEffectsFor(
        { id: slide.id, title: slide.title, bullets: slide.bullets, diagram: slide.diagram as never },
        deck.autoStyle,
      ).map((e) => e.id),
    (slide) =>
      slide.diagram.kind === "flowchart" || slide.diagram.kind === "sequence"
        ? slide.diagram.kind
        : deck.autoStyle
          ? builtKindFor({ title: slide.title, bullets: slide.bullets })
          : "none",
  );
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
      const result = await withTimeout(checkViewport(browser, htmlPath, viewport, opts), timeoutMs, `viewport ${viewport.w}x${viewport.h}: check timeout after ${timeoutMs} ms`);
      report.viewports.push(result);
    }
    return report;
  } finally {
    await browser.close();
  }
}
