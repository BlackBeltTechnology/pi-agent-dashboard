/**
 * `variants render` (spec deck3d-variant-loop "Variant contact sheet"): the
 * deck is rendered once per variant with that variant's fragment deep-merged
 * into the current overrides IN MEMORY — `deck.json` is never touched — each
 * sample slide is snapshotted at rest, and a contact sheet is composed in
 * chromium: a header row, then one row per sample slide with the reference
 * render (when one exists) as the first column and one labelled column per
 * variant. Temporary HTML is removed before returning.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { deepMerge } from "../ir/merge.js";
import type { DeckIR } from "../ir/types.js";
import { formatIssue, validate } from "../ir/validate.js";
import { renderIrToHtml } from "../render/build.js";
import { requireStyle } from "./pick.js";

export const CELL_W = 480;
export const HEADER_H = 32;

export class RenderUnavailableError extends Error {
  constructor() {
    super("chromium missing (npx playwright install chromium)");
    this.name = "RenderUnavailableError";
  }
}

export interface RenderStepOptions {
  deckJson: string;
  step: string;
  viewport?: { width: number; height: number };
  /** Output root; default the deck directory. */
  outDir?: string;
  /** Reference renders (`<slideId>.png`); default `<deck dir>/pptx/ref`. */
  refDir?: string;
}

export interface RenderStepResult {
  dir: string;
  contact: string;
  columns: number;
  rows: number;
  warnings: string[];
  files: string[];
}

/** Merge `fragment` into the IR's overrides in memory (same rules as `overrides apply`). */
export function withFragment(ir: DeckIR, fragment: Record<string, unknown> | undefined): DeckIR {
  return fragment ? { ...ir, overrides: deepMerge(ir.overrides ?? {}, fragment) as DeckIR["overrides"] } : ir;
}

/** HTML of the deck with `fragment` merged in — shared by `variants render` and `serve ?variant=`. */
export async function renderWithFragment(deckJson: string, fragment: Record<string, unknown> | undefined): Promise<string> {
  const ir = JSON.parse(readFileSync(deckJson, "utf8")) as DeckIR;
  const merged = withFragment(ir, fragment);
  const result = validate(merged, { deckDir: dirname(deckJson) });
  if (!result.ok) throw new Error(result.errors.map((e) => formatIssue("error", e)).join("; "));
  const errs: string[] = [];
  const html = await renderIrToHtml(merged, deckJson, { stdout: () => {}, stderr: (l) => errs.push(l) });
  if (html === undefined) throw new Error(errs.join("; ") || "render failed");
  return html;
}

async function openPage(browser: import("playwright").Browser, htmlPath: string, vp: { width: number; height: number }): Promise<Page> {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__deck3d?.ready());
  return page;
}

const dataUri = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;

export async function renderStep(opts: RenderStepOptions): Promise<RenderStepResult> {
  const deckDir = dirname(opts.deckJson);
  const { style } = requireStyle(opts.deckJson);
  const step = style.steps.find((s) => s.id === opts.step);
  if (!step) throw new Error(`unknown step '${opts.step}' (steps: ${style.steps.map((s) => s.id).join(", ") || "none"})`);
  const vp = opts.viewport ?? { width: 1920, height: 1080 };
  const ir = JSON.parse(readFileSync(opts.deckJson, "utf8")) as DeckIR;
  const deckIds = new Set(ir.slides.map((s) => s.id));
  const warnings: string[] = [];
  const samples = step.slides.filter((id) => {
    if (deckIds.has(id)) return true;
    warnings.push(`warning step ${step.id}: sample slide '${id}' is not in the deck; skipped`);
    return false;
  });
  const outRoot = opts.outDir ?? deckDir;
  const dir = join(outRoot, "variants", step.id, `r${step.round}`);
  mkdirSync(dir, { recursive: true });
  const refDir = opts.refDir ?? join(deckDir, "pptx", "ref");
  const refs = new Map<string, Buffer>();
  for (const id of samples) {
    const f = join(refDir, `${id}.png`);
    if (existsSync(f)) refs.set(id, readFileSync(f));
  }

  let browser: import("playwright").Browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ channel: "chromium" });
  } catch {
    throw new RenderUnavailableError();
  }
  const tmp = mkdtempSync(join(tmpdir(), "deck3d-variants-"));
  const files: string[] = [];
  const shots = new Map<string, Buffer>();
  try {
    for (const variant of step.variants) {
      const html = join(tmp, `${variant.name}.html`);
      writeFileSync(html, await renderWithFragment(opts.deckJson, variant.overrides));
      const page = await openPage(browser, html, vp);
      try {
        const ids = await page.evaluate(() => window.__DECK.slides.map((s) => s.id));
        for (const id of samples) {
          const n = ids.indexOf(id) + 1;
          await page.evaluate(
            ([slide]) => {
              window.__deck3d?.gotoSlide(slide);
              window.__deck3d?.setTime(0);
            },
            [n] as [number],
          );
          await page.evaluate(() => window.__deck3d?.ready());
          await page.waitForTimeout(150);
          const png = await page.screenshot();
          const file = join(dir, `${variant.name}-${id}.png`);
          writeFileSync(file, png);
          files.push(file);
          shots.set(`${variant.name}|${id}`, png);
        }
      } finally {
        await page.close();
      }
    }

    const cellH = Math.round((CELL_W * vp.height) / vp.width);
    const cols = (refs.size ? 1 : 0) + step.variants.length;
    const header = [...(refs.size ? ["reference"] : []), ...step.variants.map((v) => `${v.name} — ${v.label}`)];
    const rows = samples.map((id) => {
      const cells = [
        ...(refs.size ? [refs.has(id) ? `<img src="${dataUri(refs.get(id) as Buffer)}">` : `<i>no reference</i>`] : []),
        ...step.variants.map((v) => `<img src="${dataUri(shots.get(`${v.name}|${id}`) as Buffer)}">`),
      ];
      return cells.map((c, k) => `<div class="c">${c}${k === 0 ? `<b>${id}</b>` : ""}</div>`).join("");
    });
    const sheet = `<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;background:#101114;color:#e5e7eb;font:600 13px/${HEADER_H}px system-ui,sans-serif}
      .g{display:grid;grid-template-columns:repeat(${cols},${CELL_W}px);gap:0}
      .h{height:${HEADER_H}px;padding:0 10px;box-sizing:border-box;background:#1b1d23;white-space:nowrap;overflow:hidden}
      .c{position:relative;width:${CELL_W}px;height:${cellH}px;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center}
      .c img{width:100%;height:100%;object-fit:contain}.c i{opacity:.5;font-weight:400}
      .c b{position:absolute;left:6px;top:4px;padding:0 6px;line-height:20px;background:rgba(0,0,0,.65);border-radius:4px;font-size:11px}
    </style><div class="g">${header.map((h) => `<div class="h">${h.replace(/</g, "&lt;")}</div>`).join("")}${rows.join("")}</div>`;
    const sheetHtml = join(tmp, "contact.html");
    writeFileSync(sheetHtml, sheet);
    const page = await browser.newPage({ viewport: { width: cols * CELL_W, height: HEADER_H + samples.length * cellH }, deviceScaleFactor: 1 });
    try {
      await page.goto(pathToFileURL(sheetHtml).href);
      await page.waitForFunction(() => [...document.images].every((i) => i.complete));
      const contact = join(dir, "contact.png");
      writeFileSync(contact, await page.screenshot());
      files.push(contact);
      return { dir, contact, columns: cols, rows: samples.length, warnings, files };
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
