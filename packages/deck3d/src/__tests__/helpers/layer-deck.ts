/**
 * Builds small decks that carry an imported layout (and arbitrary assets) for
 * the chromium suites of change deck3d-pptx-import. Everything goes through
 * the real CLI (`parse`, `render`), so the tests exercise the shipped path.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright";
import { run } from "../../cli.js";
import type { ImgItem, Layout, LayoutItem, LayoutSlide, RectItem, TextItem } from "../../pptx/types.js";

const base = { rotation: 0, flipH: false, flipV: false };

export function textItem(id: string, rect: TextItem["rect"], text: string, o: { size?: number; placeholder?: string; color?: string; font?: string } = {}): TextItem {
  return {
    id,
    kind: "text",
    rect,
    ...base,
    ...(o.placeholder ? { placeholder: o.placeholder } : {}),
    anchor: "t",
    insets: { l: 14.4, t: 7.2, r: 14.4, b: 7.2 },
    vertical: false,
    autofit: "none",
    paragraphs: [
      {
        align: "l",
        lineSpacing: 1,
        spaceBefore: 0,
        spaceAfter: 0,
        level: 0,
        runs: [{ text, size: o.size ?? 56, bold: true, italic: false, underline: false, color: o.color ?? "#161e23", font: o.font ?? "Poppins" }],
      },
    ],
  };
}

export const rectItem = (id: string, rect: RectItem["rect"], fill: string): RectItem => ({ id, kind: "rect", rect, ...base, preset: "rect", fill, alpha: 1 });

export const imgItem = (id: string, rect: ImgItem["rect"], asset: string): ImgItem => ({
  id,
  kind: "img",
  rect,
  ...base,
  media: `${asset}.png`,
  asset,
  crop: { l: 0, t: 0, r: 0, b: 0 },
});

export interface AssetSpec {
  id: string;
  mime: string;
  bytes: Uint8Array | string;
}

export interface LayerDeckSpec {
  size?: { w: number; h: number };
  slides: Array<{ id: string; title?: string; items?: LayoutItem[]; background?: LayoutSlide["background"] }>;
  assets?: AssetSpec[];
  /** slide id → `overrides.slides[id]` (effects, camera, transition, …). */
  slideOverrides?: Record<string, Record<string, unknown>>;
  /** Deck-scope `overrides.effects` (persistent cards only). */
  deckEffects?: unknown[];
  /** `overrides.deck` knobs. */
  deck?: Record<string, unknown>;
}

export interface LayerDeck {
  dir: string;
  html: string;
  json: string;
}

const noIo = { stdout: () => {}, stderr: () => {} };

export async function buildLayerDeck(spec: LayerDeckSpec): Promise<LayerDeck> {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-layers-"));
  const size = spec.size ?? { w: 1920, h: 1080 };
  const layout: Layout = {
    version: 1,
    size,
    theme: { colors: {}, fonts: { major: "Poppins", minor: "Poppins" } },
    slides: spec.slides.map((s, i) => ({
      id: s.id,
      index: i + 1,
      title: s.title ?? s.id,
      fingerprint: s.id,
      ...(s.background ? { background: s.background } : {}),
      items: s.items ?? [],
    })),
  };
  const files: AssetSpec[] = [{ id: "lay", mime: "application/json", bytes: `${JSON.stringify(layout)}\n` }, ...(spec.assets ?? [])];
  const entries = files.map((a) => {
    const ext = a.mime === "application/json" ? "json" : a.mime === "image/png" ? "png" : a.mime.startsWith("font/") ? a.mime.slice(5) : "bin";
    const path = `assets/${a.id}.${ext}`;
    mkdirSync(join(dir, "assets"), { recursive: true });
    const buf = typeof a.bytes === "string" ? Buffer.from(a.bytes) : Buffer.from(a.bytes);
    writeFileSync(join(dir, path), buf);
    return { id: a.id, path, sha256: createHash("sha256").update(buf).digest("hex"), mime: a.mime };
  });
  writeFileSync(join(dir, "deck.md"), `${spec.slides.map((s) => `# ${s.title ?? s.id} {#${s.id}}\n\nBody of ${s.id}\n\n- one\n- two\n`).join("\n")}`);
  const parsed = await run(["parse", join(dir, "deck.md"), "-o", join(dir, "deck.json")], noIo);
  if (parsed !== 0) throw new Error("parse failed");
  const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
  deck.overrides.assets = entries;
  if (spec.deckEffects) deck.overrides.effects = spec.deckEffects;
  if (spec.deck) deck.overrides.deck = { ...(deck.overrides.deck ?? {}), ...spec.deck };
  for (const [id, ov] of Object.entries(spec.slideOverrides ?? {})) deck.overrides.slides[id] = { ...(deck.overrides.slides[id] ?? {}), ...ov };
  writeFileSync(join(dir, "deck.json"), `${JSON.stringify(deck, null, 2)}\n`);
  const errs: string[] = [];
  const rendered = await run(["render", join(dir, "deck.json"), "-o", join(dir, "deck.html")], { stdout: () => {}, stderr: (l) => errs.push(l) });
  if (rendered !== 0) throw new Error(`render failed: ${errs.join("; ")}`);
  return { dir, html: join(dir, "deck.html"), json: join(dir, "deck.json") };
}

/** Open a built deck at a viewport and wait until its api is ready. */
export async function openDeck(browser: Browser, html: string, viewport = { width: 1920, height: 1080 }): Promise<Page> {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(html).href);
  await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__deck3d?.ready());
  return page;
}

/** Go to a 1-based slide and pin the clock at 0 (the settled pose, no idle drift). */
export async function settle(page: Page, slide1: number, t = 0): Promise<void> {
  await page.evaluate(
    ([n, time]) => {
      window.__deck3d?.gotoSlide(n);
      window.__deck3d?.setTime(time);
    },
    [slide1, t] as [number, number],
  );
  await page.waitForTimeout(80);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Largest per-edge difference (px) between two rects. */
export function rectDelta(a: Rect, b: Rect): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.w - (b.x + b.w)), Math.abs(a.y + a.h - (b.y + b.h)));
}

/** Where a layout rect should land: the slide frame contain-fitted into the viewport. */
export function mappedRect(item: Rect, size: { w: number; h: number }, vw: number, vh: number): Rect {
  const a = size.w / size.h;
  const fw = vw / vh > a ? vh * a : vw;
  const fh = vw / vh > a ? vh : vw / a;
  const x0 = (vw - fw) / 2;
  const y0 = (vh - fh) / 2;
  return { x: x0 + (item.x * fw) / size.w, y: y0 + (item.y * fh) / size.h, w: (item.w * fw) / size.w, h: (item.h * fh) / size.h };
}

export { dirname };
