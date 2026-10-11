/**
 * Imported-layout runtime — change deck3d-pptx-import, test-plan
 * #E21–#E23, #E26–#E34, #E36, #F1–#F3. Decks are built through the real CLI
 * (`helpers/layer-deck.ts`); browser scenarios skip without chromium.
 * Exemplar: `f1-measure-stable.test.ts`.
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import {
  buildLayerDeck,
  imgItem,
  mappedRect,
  openDeck,
  rectDelta,
  rectItem,
  settle,
  textItem,
} from "../../__tests__/helpers/layer-deck.js";
import { decodePng, encodePng } from "../../art/png.js";
import { run } from "../../cli.js";
import { stubChrome } from "../../fx/stub-assets.js";
import { FONT_PATH } from "../index.js";

const hasChromium = await chromiumAvailable();

function cli(args: string[]) {
  const err: string[] = [];
  return run(args, { stdout: () => {}, stderr: (l) => err.push(l) }).then((code) => ({ code, stderr: err.join("\n") }));
}

// ── asset bundle (no browser) ─────────────────────────────────────────────────

describe("deck asset bundle", () => {
  it("renders byte-identical HTML whatever the order of overrides.assets (E21)", async () => {
    const assets = Array.from({ length: 20 }, (_, i) => ({ id: `img-${String(i).padStart(2, "0")}`, mime: "image/png", bytes: stubChrome().map((b, k) => (k > 40 ? (b + i) & 255 : b)) }));
    const deck = await buildLayerDeck({ slides: [{ id: "s01" }], assets });
    const a = readFileSync(deck.html);
    const json = JSON.parse(readFileSync(deck.json, "utf8"));
    json.overrides.assets.reverse();
    writeFileSync(deck.json, JSON.stringify(json, null, 2));
    const second = join(deck.dir, "again.html");
    const r = await cli(["render", deck.json, "-o", second]);
    expect(r.code, r.stderr).toBe(0);
    expect(a.equals(readFileSync(second))).toBe(true);
  }, 120_000);

  it("budgets total asset size: warn above 25 MB, fail above 200 MB (E22)", async () => {
    const MB = 1024 * 1024;
    const zeroSha = (n: number) => {
      const h = createHash("sha256");
      const chunk = Buffer.alloc(MB);
      for (let left = n; left > 0; left -= MB) h.update(left >= MB ? chunk : chunk.subarray(0, left));
      return h.digest("hex");
    };
    const build = async (bytes: number) => {
      const dir = join(tmpdir(), `deck3d-budget-${bytes}-${process.pid}`);
      mkdirSync(join(dir, "assets"), { recursive: true });
      writeFileSync(join(dir, "deck.md"), "# One {#s01}\n\nBody\n");
      expect((await cli(["parse", join(dir, "deck.md"), "-o", join(dir, "deck.json")])).code).toBe(0);
      const file = join(dir, "assets", "big.txt");
      const fd = openSync(file, "w");
      closeSync(fd);
      truncateSync(file, bytes);
      const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
      deck.overrides.assets = [{ id: "big", path: "assets/big.txt", sha256: zeroSha(bytes), mime: "text/plain" }];
      writeFileSync(join(dir, "deck.json"), JSON.stringify(deck));
      const out = join(dir, "deck.html");
      const r = await cli(["render", join(dir, "deck.json"), "-o", out]);
      return { ...r, out };
    };
    const at25 = await build(25 * MB);
    expect(at25.code).toBe(0);
    expect(at25.stderr).not.toMatch(/exceeds 25 MiB/);
    const over25 = await build(25 * MB + 1);
    expect(over25.code).toBe(0);
    expect(over25.stderr).toMatch(/exceeds 25 MiB/);
    const at200 = await build(200 * MB);
    expect(at200.code, at200.stderr).toBe(0);
    expect(at200.stderr).toMatch(/exceeds 25 MiB/);
    expect(existsSync(at200.out)).toBe(true);
    expect(statSync(at200.out).size).toBeGreaterThan(200 * MB);
    const over200 = await build(200 * MB + 1);
    expect(over200.code).not.toBe(0);
    expect(over200.stderr).toMatch(/200 MiB/);
    expect(existsSync(over200.out)).toBe(false);
  }, 300_000);

  it("rejects the six invalid asset cases, each naming overrides.assets[i] and the rule (E20)", async () => {
    const png = encodePng({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) });
    const deck = await buildLayerDeck({ slides: [{ id: "s01" }], assets: [{ id: "ok-img", mime: "image/png", bytes: png }] });
    const base = JSON.parse(readFileSync(deck.json, "utf8"));
    const good = base.overrides.assets.find((a: { id: string }) => a.id === "ok-img");
    const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    const withAsset = (entry: Record<string, unknown>, files: Record<string, Uint8Array> = {}) => {
      for (const [name, bytes] of Object.entries(files)) writeFileSync(join(deck.dir, name), bytes);
      const d = JSON.parse(JSON.stringify(base));
      d.overrides.assets = [...base.overrides.assets, entry];
      writeFileSync(deck.json, JSON.stringify(d));
      return cli(["validate", deck.json]);
    };
    const stale = await withAsset({ ...good, id: "stale", sha256: "0".repeat(64) });
    expect(stale.stderr).toMatch(/overrides\.assets\[\d+\]\.sha256/);
    const escape = await withAsset({ ...good, id: "escape", path: "../secrets.json" });
    expect(escape.stderr).toMatch(/overrides\.assets\[\d+\]\.path.*outside the deck directory/);
    const dupe = await withAsset({ ...good });
    expect(dupe.stderr).toMatch(/overrides\.assets\[\d+\]\.id.*duplicate/);
    const bmp = await withAsset({ ...good, id: "bmp", mime: "image/bmp" });
    expect(bmp.code).not.toBe(0);
    expect(bmp.stderr).toMatch(/overrides\.assets\[\d+\]\.mime/);
    const ttf = new Uint8Array(readFileSync(FONT_PATH));
    const fontBad = await withAsset({ id: "calibri", path: "calibri.ttf", sha256: sha(ttf), mime: "font/ttf" }, { "calibri.ttf": ttf });
    expect(fontBad.stderr).toMatch(/overrides\.assets\[\d+\]\.id.*must start with 'font-'/);
    const pngFont = await withAsset({ ...good, id: "font-x" });
    expect(pngFont.stderr).toMatch(/overrides\.assets\[\d+\]\.id.*reserved for font assets/);
    const okFont = await withAsset({ id: "font-calibri", path: "calibri.ttf", sha256: sha(ttf), mime: "font/ttf" });
    expect(okFont.code, okFont.stderr).toBe(0);
  }, 120_000);

  it("rejects an asset that reaches outside the deck directory through a symlink (B3)", async () => {
    const deck = await buildLayerDeck({ slides: [{ id: "s01" }] });
    const outside = mkdtempSync(join(tmpdir(), "deck3d-outside-"));
    writeFileSync(join(outside, "secret.json"), '{"secret":true}');
    symlinkSync(join(outside, "secret.json"), join(deck.dir, "assets", "link.json"));
    symlinkSync(outside, join(deck.dir, "assets", "dir"));
    const sha = createHash("sha256").update(readFileSync(join(outside, "secret.json"))).digest("hex");
    const base = JSON.parse(readFileSync(deck.json, "utf8"));
    for (const path of ["assets/link.json", "assets/dir/secret.json"]) {
      const d = JSON.parse(JSON.stringify(base));
      d.overrides.assets = [...base.overrides.assets, { id: "linked", path, sha256: sha, mime: "application/json" }];
      writeFileSync(deck.json, JSON.stringify(d));
      const v = await cli(["validate", deck.json]);
      expect(v.code, path).not.toBe(0);
      expect(v.stderr, path).toMatch(/overrides\.assets\[\d+\]\.path.*outside the deck directory/);
      // And `render` refuses too: nothing outside the deck is ever embedded.
      const r = await cli(["render", deck.json, "-o", join(deck.dir, "linked.html")]);
      expect(r.code, path).not.toBe(0);
      expect(existsSync(join(deck.dir, "linked.html")), path).toBe(false);
    }
    // A symlink that stays INSIDE the deck directory is fine.
    symlinkSync(join(deck.dir, "assets", "lay.json"), join(deck.dir, "assets", "inside.json"));
    const d = JSON.parse(JSON.stringify(base));
    const lay = base.overrides.assets.find((a: { id: string }) => a.id === "lay");
    d.overrides.assets = [...base.overrides.assets, { ...lay, id: "inside", path: "assets/inside.json" }];
    writeFileSync(deck.json, JSON.stringify(d));
    expect((await cli(["validate", deck.json])).code).toBe(0);
  }, 120_000);

  it("rejects a persistent card on a slide but accepts it at deck scope, never prepended to slides (E34)", async () => {
    const png = stubChrome();
    const deck = await buildLayerDeck({ slides: [{ id: "s01" }, { id: "s02" }], assets: [{ id: "chrome", mime: "image/png", bytes: png }] });
    // `render` refuses such a deck (it validates first), so write the bad edit by hand.
    const edited = JSON.parse(readFileSync(deck.json, "utf8"));
    edited.overrides.slides.s02 = { effects: [{ id: "frame-chrome", params: { layers: [{ asset: "chrome" }] } }] };
    writeFileSync(deck.json, JSON.stringify(edited));
    const bad = await cli(["validate", deck.json]);
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toMatch(/overrides\.slides\["s02"\]\.effects\[0\].*deck-scope only/);
    const d = JSON.parse(readFileSync(deck.json, "utf8"));
    delete d.overrides.slides.s02.effects;
    d.overrides.effects = [{ id: "frame-chrome", params: { layers: [{ asset: "chrome" }] } }];
    writeFileSync(deck.json, JSON.stringify(d));
    const ok = await cli(["validate", deck.json]);
    expect(ok.code, ok.stderr).toBe(0);
    const { applyOverrides } = await import("../../ir/merge.js");
    for (const s of applyOverrides(d).slides) expect((s.effects ?? []).map((e) => e.id)).not.toContain("frame-chrome");
  }, 60_000);
});

// ── slide-layer (browser) ─────────────────────────────────────────────────────

const LAYOUT_ITEMS = [
  textItem("s01-i001", { x: 120, y: 80, w: 1000, h: 140 }, "Hello layers", { placeholder: "title", size: 80 }),
  textItem("s01-i002", { x: 120, y: 300, w: 900, h: 120 }, "First bullet", { size: 48 }),
  textItem("s01-i003", { x: 120, y: 440, w: 900, h: 120 }, "Second bullet", { size: 48 }),
  textItem("s01-i004", { x: 120, y: 580, w: 900, h: 120 }, "Third bullet", { size: 48 }),
  imgItem("s01-i005", { x: 1300, y: 300, w: 400, h: 400 }, "pic"),
];
const PIC = stubChrome();

describe.skipIf(!hasChromium)("slide-layer (chromium)", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  beforeAll(async () => {
    browser = await chromium.launch({ channel: "chromium" });
  }, 180_000);
  afterAll(async () => {
    await browser?.close();
  });

  const layerDeck = (mode: string, extra: Record<string, unknown> = {}, size?: { w: number; h: number }) =>
    buildLayerDeck({
      size,
      slides: [{ id: "s01", title: "Native one", items: LAYOUT_ITEMS }, { id: "s02", title: "Native two" }],
      assets: [{ id: "pic", mime: "image/png", bytes: PIC }],
      slideOverrides: { s01: { effects: [{ id: "slide-layer", params: { layout: "lay", slide: "s01", mode, ...extra } }] } },
    });

  async function probe(page: Awaited<ReturnType<typeof openDeck>>) {
    return page.evaluate(() => {
      const layer = window.__deck3d?.debug.layers().find((l) => l.id === "slide-layer");
      return layer?.state as { items: Array<{ id: string; rect: { x: number; y: number; w: number; h: number } }>; frame: { width: number; height: number } | null };
    });
  }

  it("places every item within 2 px of its layout rect at 1920×1080 in mode free (E26)", async () => {
    const deck = await layerDeck("free");
    const page = await openDeck(browser, deck.html);
    try {
      await settle(page, 1);
      const state = await probe(page);
      for (const item of LAYOUT_ITEMS) {
        const got = state.items.find((i) => i.id === item.id)?.rect;
        expect(got, item.id).toBeDefined();
        expect(rectDelta(got as never, mappedRect(item.rect, { w: 1920, h: 1080 }, 1920, 1080)), item.id).toBeLessThanOrEqual(2);
      }
      const measured = await page.evaluate(() => window.__deck3d?.measure().filter((m) => m.kind === "layer-text") ?? []);
      expect(measured.map((m) => m.id).sort()).toEqual(["s01-i001", "s01-i002", "s01-i003", "s01-i004"]);
      for (const m of measured) {
        const item = LAYOUT_ITEMS.find((i) => i.id === m.id) as (typeof LAYOUT_ITEMS)[number];
        expect(rectDelta(m.rect, mappedRect(item.rect, { w: 1920, h: 1080 }, 1920, 1080)), m.id).toBeLessThanOrEqual(2);
      }
    } finally {
      await page.close();
    }
  }, 120_000);

  it("centres a 1754×987 frame at 2000×987 and stays within 2×987/1080 px (E27)", async () => {
    const deck = await layerDeck("free");
    const page = await openDeck(browser, deck.html, { width: 2000, height: 987 });
    try {
      await settle(page, 1);
      const state = await probe(page);
      expect(state.frame?.height).toBeGreaterThan(0);
      const tol = (2 * 987) / 1080;
      for (const item of LAYOUT_ITEMS) {
        const got = state.items.find((i) => i.id === item.id)?.rect as never;
        const want = mappedRect(item.rect, { w: 1920, h: 1080 }, 2000, 987);
        expect(rectDelta(got, want), item.id).toBeLessThanOrEqual(tol);
      }
      const title = state.items.find((i) => i.id === "s01-i001")?.rect as { x: number };
      // The frame is centred: x0 = (2000 − 1754.67)/2 ≈ 122.7, and the title sits 120·(987/1080) px into it.
      expect(title.x).toBeCloseTo(122.67 + 120 * (987 / 1080), 0);
    } finally {
      await page.close();
    }
  }, 120_000);

  it("fits a 4:3 slide as a 1440×1080 frame at x0 = 240 (E28)", async () => {
    const items = [textItem("s01-i001", { x: 100, y: 100, w: 900, h: 150 }, "Four three", { size: 70 }), rectItem("s01-i002", { x: 0, y: 1300, w: 1920, h: 140 }, "#f67519")];
    const deck = await buildLayerDeck({
      size: { w: 1920, h: 1440 },
      slides: [{ id: "s01", items }],
      slideOverrides: { s01: { effects: [{ id: "slide-layer", params: { layout: "lay", slide: "s01", mode: "free" } }] } },
    });
    const page = await openDeck(browser, deck.html);
    try {
      await settle(page, 1);
      const state = await probe(page);
      for (const item of items) {
        const got = state.items.find((i) => i.id === item.id)?.rect as never;
        expect(rectDelta(got, mappedRect(item.rect, { w: 1920, h: 1440 }, 1920, 1080)), item.id).toBeLessThanOrEqual(2);
      }
      const bar = state.items.find((i) => i.id === "s01-i002")?.rect as { x: number; w: number };
      expect(bar.x).toBeCloseTo(240, 0);
      expect(bar.w).toBeCloseTo(1440, 0);
    } finally {
      await page.close();
    }
  }, 120_000);

  it("meets 2 px in screen, free and flat panel; a tilted panel is exempt (E29)", async () => {
    const cases: Array<[string, Record<string, unknown>, boolean]> = [
      ["screen", {}, true],
      ["free", {}, true],
      ["panel", { panel: { tilt: 0 } }, true],
      ["panel", { panel: { tilt: 0.2 } }, false],
    ];
    for (const [mode, extra, asserted] of cases) {
      const deck = await layerDeck(mode, extra);
      const page = await openDeck(browser, deck.html);
      try {
        await settle(page, 1);
        const state = await probe(page);
        const worst = Math.max(...LAYOUT_ITEMS.map((item) => rectDelta(state.items.find((i) => i.id === item.id)?.rect as never, mappedRect(item.rect, { w: 1920, h: 1080 }, 1920, 1080))));
        if (asserted) expect(worst, `${mode} ${JSON.stringify(extra)}`).toBeLessThanOrEqual(2);
        else expect(worst, "a tilted panel is a deliberate 3D look (the 2 px rule is not asserted)").toBeGreaterThan(2);
      } finally {
        await page.close();
      }
    }
  }, 240_000);

  it("applies retext and skip (E30)", async () => {
    const deck = await layerDeck("free", { retext: { "s01-i001": "Illustrative video" }, skip: ["s01-i002"] });
    const page = await openDeck(browser, deck.html);
    try {
      await settle(page, 1);
      const measured = await page.evaluate(() => window.__deck3d?.measure().filter((m) => m.kind === "layer-text") ?? []);
      expect(measured.find((m) => m.id === "s01-i001")?.text).toBe("Illustrative video");
      expect(measured.find((m) => m.id === "s01-i002")).toBeUndefined();
      const state = await probe(page);
      expect(state.items.find((i) => i.id === "s01-i002")).toBeUndefined();
    } finally {
      await page.close();
    }
  }, 120_000);

  it("replaces native content: only layer-text on the layer slide, native kinds elsewhere (E31)", async () => {
    const deck = await layerDeck("free");
    const page = await openDeck(browser, deck.html);
    try {
      await settle(page, 1);
      const a = await page.evaluate(() => window.__deck3d?.measure().map((m) => m.kind) ?? []);
      expect(new Set(a)).toEqual(new Set(["layer-text"]));
      await settle(page, 2);
      const b = await page.evaluate(() => window.__deck3d?.measure().map((m) => m.kind) ?? []);
      expect(b).toContain("title");
      expect(b).not.toContain("layer-text");
    } finally {
      await page.close();
    }
  }, 120_000);

  it("a live param edit that breaks the layer keeps the native slide, and a good one restores the layer (R2-B3)", async () => {
    const deck = await layerDeck("free");
    const page = await openDeck(browser, deck.html);
    try {
      await settle(page, 1);
      const kinds = () => page.evaluate(() => [...new Set(window.__deck3d?.measure().map((m) => m.kind) ?? [])].sort());
      expect(await kinds()).toEqual(["layer-text"]);
      // The same path the configurator takes when a param changes.
      await page.evaluate(() => window.__deck3d?.debug.applyParams("slide-layer", { slide: "s99" }));
      expect(await kinds(), "a failed live edit must not blank the slide").toContain("title");
      expect(await page.evaluate(() => window.__deck3d?.effects().errors.map((e) => e.effectId))).toContain("slide-layer");
      await page.evaluate(() => window.__deck3d?.debug.applyParams("slide-layer", { slide: "s01" }));
      expect(await kinds(), "fixing the param brings the layer back and retires the native content").toEqual(["layer-text"]);
    } finally {
      await page.close();
    }
  }, 120_000);

  /** Dark-pixel statistics of the canvas inside a CSS-px rect (text on a white slide, bloom off). */
  async function ink(page: Awaited<ReturnType<typeof openDeck>>, r: { x: number; y: number; w: number; h: number }) {
    return page.evaluate((rect) => {
      const c = document.querySelector("canvas") as HTMLCanvasElement;
      const k = document.createElement("canvas");
      k.width = c.width;
      k.height = c.height;
      const g = k.getContext("2d") as CanvasRenderingContext2D;
      g.drawImage(c, 0, 0);
      const d = g.getImageData(rect.x, rect.y, rect.w, rect.h).data;
      let n = 0;
      let sy = 0;
      let minX = rect.w;
      let maxX = 0;
      let minY = rect.h;
      let maxY = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 100 || d[i + 1] > 100 || d[i + 2] > 100) continue;
        const px = (i / 4) % rect.w;
        const py = Math.floor(i / 4 / rect.w);
        n++;
        sy += py;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
      return { n, cy: n ? sy / n : -1, w: maxX - minX, h: maxY - minY };
    }, r);
  }

  it("turns text upside down for flipV and never mirrors it for flipH, like PowerPoint (R4-B2)", async () => {
    const mk = (id: string, flip: { flipV?: boolean; flipH?: boolean }) => ({ ...textItem(`${id}-i001`, { x: 200, y: 100, w: 600, h: 700 }, "T", { size: 560 }), ...flip });
    const deck = await buildLayerDeck({
      slides: [
        { id: "s01", items: [mk("s01", {})], background: { color: "#ffffff" } },
        { id: "s02", items: [mk("s02", { flipV: true })], background: { color: "#ffffff" } },
        { id: "s03", items: [mk("s03", { flipH: true })], background: { color: "#ffffff" } },
      ],
      deck: { quality: "low", mode: "light" },
      slideOverrides: Object.fromEntries(["s01", "s02", "s03"].map((id) => [id, { effects: [{ id: "slide-layer", params: { layout: "lay", slide: id, mode: "free" } }] }])),
    });
    const page = await openDeck(browser, deck.html);
    try {
      const box = { x: 200, y: 100, w: 600, h: 700 };
      await settle(page, 1);
      const plain = await ink(page, box);
      await settle(page, 2);
      const flippedV = await ink(page, box);
      await settle(page, 3);
      const flippedH = await ink(page, box);
      expect(plain.n).toBeGreaterThan(5000);
      // The bar of a `T` is at the top: its ink sits ABOVE the box centre; upside down it sits below.
      expect(plain.cy).toBeLessThan(box.h / 2);
      expect(flippedV.cy, "flipV must turn the text upside down").toBeGreaterThan(box.h / 2);
      // A mirrored `T` is symmetric, so horizontal flips are checked by "not rotated": same ink rows as plain.
      expect(Math.abs(flippedH.cy - plain.cy), "flipH must not turn the text over").toBeLessThan(8);
    } finally {
      await page.close();
    }
  }, 180_000);

  it("lays vertical text out along the box's height, in the recorded direction (R4-B2)", async () => {
    const mk = (id: string, rot: 90 | 270 | undefined) => ({ ...textItem(`${id}-i001`, { x: 300, y: 100, w: 360, h: 800 }, "VE", { size: 220 }), vertical: rot !== undefined, ...(rot ? { textRotation: rot } : {}) });
    const deck = await buildLayerDeck({
      slides: [
        { id: "s01", items: [mk("s01", 90)], background: { color: "#ffffff" } },
        { id: "s02", items: [mk("s02", 270)], background: { color: "#ffffff" } },
        { id: "s03", items: [mk("s03", undefined)], background: { color: "#ffffff" } },
      ],
      deck: { quality: "low", mode: "light" },
      slideOverrides: Object.fromEntries(["s01", "s02", "s03"].map((id) => [id, { effects: [{ id: "slide-layer", params: { layout: "lay", slide: id, mode: "free" } }] }])),
    });
    const page = await openDeck(browser, deck.html);
    try {
      const box = { x: 300, y: 100, w: 360, h: 800 };
      await settle(page, 1);
      const cw = await ink(page, box);
      await settle(page, 2);
      const ccw = await ink(page, box);
      await settle(page, 3);
      const flat = await ink(page, box);
      expect(cw.n).toBeGreaterThan(3000);
      // Text reads along the long axis, from the top (90°) or from the bottom (270°).
      expect(cw.cy, "vert: the line starts at the top").toBeLessThan(box.h * 0.4);
      expect(ccw.cy, "vert270: the line starts at the bottom").toBeGreaterThan(box.h * 0.6);
      // Horizontal text in the same narrow box stays on one row near the top and overflows sideways.
      expect(flat.w, "horizontal text runs along the WIDTH").toBeGreaterThan(flat.h);
      expect(cw.h, "vertical text runs along the HEIGHT").toBeGreaterThan(cw.w * 0.8);
    } finally {
      await page.close();
    }
  }, 180_000);

  it("keeps the original z-order: a picture UNDER a title does not cover it (B7)", async () => {
    // Pptx order is back-to-front: the red picture first, the black title on top of it.
    const red = encodePng({ width: 8, height: 8, data: new Uint8Array(Array.from({ length: 64 }, () => [200, 30, 30, 255]).flat()) });
    const items = [imgItem("s01-i001", { x: 100, y: 60, w: 1000, h: 260 }, "red"), textItem("s01-i002", { x: 120, y: 80, w: 960, h: 200 }, "VISIBLE", { size: 150, placeholder: "title" })];
    const deck = await buildLayerDeck({
      slides: [{ id: "s01", items, background: { color: "#ffffff" } }],
      assets: [{ id: "red", mime: "image/png", bytes: red }],
      // Baseline bloom follows the quality tier and would lift the black glyphs to
      // grey next to the bright picture; this test is about layering only.
      deck: { quality: "low" },
      slideOverrides: { s01: { effects: [{ id: "slide-layer", params: { layout: "lay", slide: "s01", mode: "free" } }] } },
    });
    const page = await openDeck(browser, deck.html);
    try {
      await settle(page, 1);
      const dark = await page.evaluate(() => {
        const c = document.querySelector("canvas") as HTMLCanvasElement;
        const k = document.createElement("canvas");
        k.width = c.width;
        k.height = c.height;
        const g = k.getContext("2d") as CanvasRenderingContext2D;
        g.drawImage(c, 0, 0);
        const d = g.getImageData(120, 80, 960, 200).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) n++;
        return n;
      });
      expect(dark, "the title's dark glyph pixels must be drawn over the picture").toBeGreaterThan(1500);
    } finally {
      await page.close();
    }
  }, 120_000);

  it("keeps the native slide when slide-layer fails to construct (B8)", async () => {
    // The layout has no slide `s99`: the effect throws in create.
    const deck = await buildLayerDeck({
      slides: [{ id: "s01", title: "Still here", items: LAYOUT_ITEMS }],
      assets: [{ id: "pic", mime: "image/png", bytes: PIC }],
      slideOverrides: { s01: { effects: [{ id: "slide-layer", params: { layout: "lay", slide: "s99", mode: "free" } }] } },
    });
    const page = await openDeck(browser, deck.html);
    try {
      await settle(page, 1);
      const kinds = await page.evaluate(() => window.__deck3d?.measure().map((m) => m.kind) ?? []);
      expect(kinds, "a failed replacement must not leave a blank slide").toContain("title");
      expect(kinds).not.toContain("layer-text");
      expect(await page.evaluate(() => window.__deck3d?.effects().errors)).toEqual([{ slide: "s01", effectId: "slide-layer", phase: "create" }]);
    } finally {
      await page.close();
    }
  }, 120_000);

  it("`check` reports an error fit naming the widened item (E32)", async () => {
    const deck = await layerDeck("free", { widen: { "s01-i001": 2000 } });
    const report = join(deck.dir, "check.json");
    const r = await cli(["check", deck.html, "--slide", "1", "-o", report]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/error fit slide 1 right .*s01-i001/);
    const findings = JSON.parse(readFileSync(report, "utf8")).viewports.flatMap((v: { findings: Array<{ rule: string; severity: string; id?: string }> }) => v.findings);
    expect(findings.some((f: { rule: string; severity: string; id?: string }) => f.rule === "fit" && f.severity === "error" && f.id === "s01-i001")).toBe(true);
  }, 180_000);

  it("falls back once for a missing font, and not when a font asset covers it (E33)", async () => {
    const font = "Zzyzx Sans";
    const items = [textItem("s01-i001", { x: 120, y: 80, w: 1000, h: 140 }, "Fallback", { font, size: 80 })];
    const ttf = new Uint8Array(readFileSync(FONT_PATH));
    const params = { layout: "lay", slide: "s01", mode: "free" };
    const without = await buildLayerDeck({ slides: [{ id: "s01", items }], slideOverrides: { s01: { effects: [{ id: "slide-layer", params }] } } });
    const a = await openDeck(browser, without.html);
    try {
      await settle(a, 1);
      expect(await a.evaluate(() => window.__deck3d?.fonts().fallbacks)).toEqual([font]);
    } finally {
      await a.close();
    }
    const withAsset = await buildLayerDeck({
      slides: [{ id: "s01", items }],
      assets: [{ id: "font-zzyzx-sans", mime: "font/ttf", bytes: ttf }],
      slideOverrides: { s01: { effects: [{ id: "slide-layer", params }] } },
    });
    const b = await openDeck(browser, withAsset.html);
    try {
      await settle(b, 1);
      expect(await b.evaluate(() => window.__deck3d?.fonts().fallbacks)).toEqual([]);
    } finally {
      await b.close();
    }
  }, 120_000);

  it("draws a 4 MB image asset at snapshot time (E23)", async () => {
    // Deterministic noise: PNG cannot compress it, so the asset is ~4 MB.
    const n = 1100;
    const data = new Uint8Array(n * n * 4);
    let x = 12345;
    for (let i = 0; i < data.length; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      data[i] = i % 4 === 3 ? 255 : (x >>> 16) & 255;
    }
    const big = encodePng({ width: n, height: n, data });
    expect(big.length).toBeGreaterThan(3.5 * 1024 * 1024);
    const items = [imgItem("s01-i001", { x: 400, y: 200, w: 600, h: 600 }, "big")];
    const deck = await buildLayerDeck({
      slides: [{ id: "s01", items, background: { color: "#ffffff" } }],
      assets: [{ id: "big", mime: "image/png", bytes: big }],
      slideOverrides: { s01: { effects: [{ id: "slide-layer", params: { layout: "lay", slide: "s01", mode: "free" } }] } },
    });
    const out = join(deck.dir, "s1.png");
    const r = await cli(["snapshot", deck.html, "--slide", "1", "-o", out]);
    expect(r.code, r.stderr).toBe(0);
    const img = decodePng(new Uint8Array(readFileSync(out)));
    let sum = 0;
    let sq = 0;
    let count = 0;
    for (let y = 300; y < 700; y += 2) {
      for (let xx = 500; xx < 900; xx += 2) {
        const v = img.data[(y * img.width + xx) * 4];
        sum += v;
        sq += v * v;
        count++;
      }
    }
    const variance = sq / count - (sum / count) ** 2;
    // The 1100 px noise is drawn ~2:1 downscaled, which averages some of it away
    // (measured ≈ 300); an empty frame over the white background is exactly 0.
    expect(variance, "noise has high variance; an empty frame would be flat").toBeGreaterThan(100);
  }, 180_000);

  it("shows parallax between depths halfway through a transition (F1)", async () => {
    const deck = await buildLayerDeck({
      slides: [{ id: "s00", title: "Lead" }, { id: "s01", items: LAYOUT_ITEMS }],
      assets: [{ id: "pic", mime: "image/png", bytes: PIC }],
      slideOverrides: { s01: { transition: "swing", effects: [{ id: "slide-layer", params: { layout: "lay", slide: "s01", mode: "free", depths: { title: 2.5, body: 0 } } }] } },
    });
    const page = await openDeck(browser, deck.html);
    try {
      const gap = () =>
        page.evaluate(() => {
          const m = window.__deck3d?.measure().filter((r) => r.kind === "layer-text") ?? [];
          const c = (id: string) => {
            const r = m.find((x) => x.id === id)?.rect as { x: number; y: number; w: number; h: number };
            return [r.x + r.w / 2, r.y + r.h / 2];
          };
          const [tx, ty] = c("s01-i001");
          const [bx, by] = c("s01-i002");
          return [bx - tx, by - ty];
        });
      await settle(page, 2);
      const settled = await gap();
      await page.evaluate(() => window.__deck3d?.debug.transitionAt(1, 2, 0.5));
      const mid = await gap();
      expect(Math.hypot(mid[0] - settled[0], mid[1] - settled[1])).toBeGreaterThan(4);
    } finally {
      await page.close();
    }
  }, 120_000);
});

// ── frame-chrome + configurator (browser) ─────────────────────────────────────

describe.skipIf(!hasChromium)("frame-chrome and the configurator (chromium)", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  beforeAll(async () => {
    browser = await chromium.launch({ channel: "chromium" });
  }, 180_000);
  afterAll(async () => {
    await browser?.close();
  });

  const chromeDeck = (suppress: string[] = []) =>
    buildLayerDeck({
      slides: [{ id: "s01" }, { id: "s02" }, { id: "s03" }],
      assets: [{ id: "chrome", mime: "image/png", bytes: stubChrome() }],
      deck: { floor: "mirror", quality: "high" },
      deckEffects: [{ id: "frame-chrome", params: { layers: [{ asset: "chrome", anchor: "tl", size: 0.3 }, { asset: "chrome", anchor: "br", size: 0.3 }], suppress } }],
    });

  const offsets = (page: Awaited<ReturnType<typeof openDeck>>) =>
    page.evaluate(() => {
      const state = window.__deck3d?.debug.persistent()[0]?.state as { offsets: number[] } | undefined;
      return state?.offsets ?? [];
    });

  it("flies out and back in monotonically; never absent at both ends; suppressed slide stays clear (F2)", async () => {
    const deck = await chromeDeck(["s03"]);
    const page = await openDeck(browser, deck.html);
    try {
      await settle(page, 1);
      const series: number[][] = [];
      for (let k = 0; k <= 10; k++) {
        await page.evaluate((p) => window.__deck3d?.debug.transitionAt(1, 2, p), k / 10);
        series.push(await offsets(page));
      }
      expect(series[0]).toEqual([0, 0]);
      expect(series[10]).toEqual([0, 0]);
      for (let layer = 0; layer < 2; layer++) {
        const v = series.map((s) => s[layer]);
        const peak = v.indexOf(Math.max(...v));
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeLessThan(v.length - 1);
        for (let i = 1; i <= peak; i++) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1] - 1e-9);
        for (let i = peak + 1; i < v.length; i++) expect(v[i]).toBeLessThanOrEqual(v[i - 1] + 1e-9);
      }
      // Pixels: the corner mark shows on a normal slide and is gone on the suppressed one.
      const orangeTL = () =>
        page.evaluate(() => {
          const c = document.querySelector("canvas") as HTMLCanvasElement;
          const k = document.createElement("canvas");
          k.width = c.width;
          k.height = c.height;
          const g = k.getContext("2d") as CanvasRenderingContext2D;
          g.drawImage(c, 0, 0);
          const d = g.getImageData(8, 8, 120, 120).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 80 && d[i + 1] < 170 && d[i + 2] < 90) n++;
          return n;
        });
      await settle(page, 2);
      expect(await orangeTL()).toBeGreaterThan(100);
      await settle(page, 3);
      expect(await offsets(page)).toEqual([1, 1]);
      expect(await orangeTL()).toBe(0);
    } finally {
      await page.close();
    }
  }, 180_000);

  it("keeps every chrome object off the floor reflection's layer mask (F3)", async () => {
    const deck = await chromeDeck();
    const page = await openDeck(browser, deck.html);
    try {
      await settle(page, 1);
      const [fx] = await page.evaluate(() => window.__deck3d?.debug.persistent() ?? []);
      expect(fx.id).toBe("frame-chrome");
      expect(fx.parent).toBe("scene");
      expect(fx.mirrorMask, "the deck must have a mirror for this to mean something").toBeGreaterThan(0);
      expect(fx.masks.length).toBeGreaterThan(0);
      for (const mask of fx.masks) expect(mask & fx.mirrorMask).toBe(0);
    } finally {
      await page.close();
    }
  }, 120_000);

  it("offers persistent cards only at deck scope and keeps one instance after an edit (E36)", async () => {
    const deck = await chromeDeck();
    const page = await openDeck(browser, deck.html);
    try {
      await settle(page, 1);
      await page.click("#deck3d-hud-toggle");
      // Blocks are collapsed by default except the first: open Effects.
      await page.locator("summary", { hasText: "Effects" }).click();
      const effectOptions = async (scope: "slide" | "deck") => {
        await page.click(`[data-scope="${scope}"]`);
        await page.click("[data-add-slot]");
        // The newest slot is the last; point its kind at `layer` and read the ring.
        const kinds = page.locator("[data-slot-kind]");
        const kind = kinds.nth((await kinds.count()) - 1);
        await kind.selectOption("layer");
        const eff = page.locator("[data-slot-effect]");
        return eff.nth((await eff.count()) - 1).locator("option").allTextContents();
      };
      expect(await effectOptions("slide")).not.toContain("frame-chrome");
      expect(await effectOptions("deck")).toContain("frame-chrome");
      // Edit a deck-scope param of the persistent card: one instance, outside every slide group.
      await page.click('[data-scope="deck"]');
      const knob = page.locator('[data-fxparam="frame-chrome.scale"]');
      await knob.waitFor({ timeout: 5000 });
      await knob.fill("1.5");
      await knob.dispatchEvent("input");
      await page.waitForTimeout(150);
      const fx = await page.evaluate(() => window.__deck3d?.debug.persistent() ?? []);
      expect(fx).toHaveLength(1);
      expect(fx[0].parent).toBe("scene");
    } finally {
      await page.close();
    }
  }, 180_000);
});
