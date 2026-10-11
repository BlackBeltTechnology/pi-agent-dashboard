/**
 * art3d / icon3d / haze and local-effect asset access — change
 * deck3d-pptx-import, test-plan #E24, #E43–#E47. Exemplar:
 * `f1-measure-stable.test.ts`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { canvas, fill, glyphRings } from "../../__tests__/helpers/glyphs.js";
import { buildLayerDeck, imgItem, mappedRect, openDeck, rectDelta, settle } from "../../__tests__/helpers/layer-deck.js";
import { stubCard } from "../../__tests__/helpers/local-fx.js";
import { decodePng } from "../../art/png.js";
import { traceImage } from "../../art/trace.js";
import { run } from "../../cli.js";
import { extrudePolygon, repairNormals } from "../../fx/art-geometry.js";
import { stubChrome, stubIcon } from "../../fx/stub-assets.js";

const hasChromium = await chromiumAvailable();

describe("art3d geometry", () => {
  it("gives every vertex normal length 1 ± 1e-6 despite collinear and duplicate vertices (E44)", () => {
    const outer: Array<[number, number]> = [
      [0, 0], [50, 0], [100, 0], [100, 0], [100, 50], [100, 100], [50, 100], [0, 100], [0, 50], [0, 0],
    ];
    const hole: Array<[number, number]> = [[30, 30], [30, 50], [30, 70], [50, 70], [70, 70], [70, 30], [50, 30]];
    const geom = extrudePolygon(THREE, outer, [hole], { depth: 0.3, bevel: 0.05, scale: 0.01, cx: 50, cy: 50 }) as THREE.BufferGeometry;
    expect(geom).toBeDefined();
    const nor = geom.getAttribute("normal");
    expect(nor.count).toBeGreaterThan(24);
    for (let i = 0; i < nor.count; i++) {
      const len = Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i));
      expect(Math.abs(len - 1), `vertex ${i}`).toBeLessThanOrEqual(1e-6);
    }
    // The repair is the safety net: a degenerate geometry is fixed, not shipped.
    const bad = new THREE.BufferGeometry();
    bad.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]), 3));
    bad.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(9), 3));
    expect(repairNormals(bad)).toBe(3);
    expect(Math.hypot(...(bad.getAttribute("normal").array as Float32Array).slice(0, 3))).toBeCloseTo(1, 6);
  });
});

describe.skipIf(!hasChromium)("art3d / icon3d / haze / local assets (chromium)", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  beforeAll(async () => {
    browser = await chromium.launch({ channel: "chromium" });
  }, 180_000);
  afterAll(async () => {
    await browser?.close();
  });

  const shot = (page: Awaited<ReturnType<typeof openDeck>>) => page.screenshot();
  /** RGB of one pixel of a screenshot. */
  const pixel = (png: Buffer, x: number, y: number): number[] => {
    const img = decodePng(new Uint8Array(png));
    const i = (Math.round(y) * img.width + Math.round(x)) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };

  it("keeps letter counters open on an extruded wordmark (E43)", async () => {
    const img = canvas(380, 150, [255, 255, 255]);
    fill(img, glyphRings("Rpe", 10, 110, 120), [20, 20, 20]);
    const outline = traceImage(img, { palette: ["#141414"] });
    expect(outline.polygons.flatMap((p) => p.holes).length).toBeGreaterThanOrEqual(3);
    const withArt = await buildLayerDeck({
      slides: [{ id: "s01", title: "Mark" }],
      assets: [{ id: "mark", mime: "application/json", bytes: JSON.stringify(outline) }],
      deck: { mode: "light" },
      slideOverrides: { s01: { effects: [{ id: "art3d", params: { outline: "mark", scale: 5, x: 0, y: 0.6, z: 0.4, depth: 0.2, bevel: 0.02 } }] } },
    });
    const without = await buildLayerDeck({ slides: [{ id: "s01", title: "Mark" }], deck: { mode: "light" }, slideOverrides: { s01: { effects: [] } } });
    const a = await openDeck(browser, withArt.html);
    const b = await openDeck(browser, without.html);
    try {
      await settle(a, 1);
      await settle(b, 1);
      const holes = await a.evaluate(() => {
        const state = window.__deck3d?.debug.layers().find((l) => l.id === "art3d")?.state as { holes: Array<{ x: number; y: number }> } | undefined;
        return state?.holes ?? [];
      });
      expect(holes.length).toBeGreaterThanOrEqual(3);
      const pa = await shot(a);
      const pb = await shot(b);
      for (const h of holes) {
        const got = pixel(pa, h.x, h.y);
        const bg = pixel(pb, h.x, h.y);
        // The counter shows what is behind the art: the same pixel as the deck without it.
        expect(Math.max(...got.map((v, i) => Math.abs(v - bg[i]))), `hole at ${Math.round(h.x)},${Math.round(h.y)}`).toBeLessThanOrEqual(14);
      }
      // …and the glyph body is NOT background: the dark wordmark covers real pixels.
      const dark = await a.evaluate(() => {
        const c = document.querySelector("canvas") as HTMLCanvasElement;
        const k = document.createElement("canvas");
        k.width = c.width;
        k.height = c.height;
        const g = k.getContext("2d") as CanvasRenderingContext2D;
        g.drawImage(c, 0, 0);
        const d = g.getImageData(0, 0, k.width, k.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) n++;
        return n;
      });
      expect(dark).toBeGreaterThan(2000);
    } finally {
      await a.close();
      await b.close();
    }
  }, 180_000);

  it("draws one 3D icon at the item rect and no flat copy (E45)", async () => {
    const item = imgItem("s01-i003", { x: 800, y: 400, w: 300, h: 300 }, "flat");
    const params = { layout: "lay", slide: "s01", mode: "free" };
    const deck = await buildLayerDeck({
      slides: [{ id: "s01", items: [item] }],
      assets: [
        { id: "flat", mime: "image/png", bytes: stubChrome() },
        { id: "icon", mime: "application/json", bytes: JSON.stringify(stubIcon()) },
      ],
      slideOverrides: {
        s01: {
          effects: [
            { id: "slide-layer", params: { ...params, skip: ["s01-i003"] } },
            { id: "icon3d", params: { asset: "icon", layout: "lay", slide: "s01", item: "s01-i003", card: true } },
          ],
        },
      },
    });
    const page = await openDeck(browser, deck.html);
    try {
      await settle(page, 1, 3);
      const layers = await page.evaluate(() => window.__deck3d?.debug.layers() ?? []);
      expect(layers.filter((l) => l.id === "icon3d")).toHaveLength(1);
      const slideLayer = layers.find((l) => l.id === "slide-layer")?.state as { items: Array<{ id: string }> };
      expect(slideLayer.items.find((i) => i.id === "s01-i003")).toBeUndefined();
      const icon = layers.find((l) => l.id === "icon3d")?.state as { rect: { x: number; y: number; w: number; h: number } };
      const want = mappedRect(item.rect, { w: 1920, h: 1080 }, 1920, 1080);
      // The 3D rig sits within the item's rect: centre agrees within 6 px.
      expect(Math.abs(icon.rect.x + icon.rect.w / 2 - (want.x + want.w / 2))).toBeLessThanOrEqual(6);
      expect(Math.abs(icon.rect.y + icon.rect.h / 2 - (want.y + want.h / 2))).toBeLessThanOrEqual(6);
      expect(rectDelta(icon.rect, want)).toBeLessThanOrEqual(8);
    } finally {
      await page.close();
    }
  }, 120_000);

  it("plays the entry once per arrival and never restarts under a pinned clock (E46)", async () => {
    const item = imgItem("s01-i003", { x: 800, y: 400, w: 300, h: 300 }, "flat");
    const deck = await buildLayerDeck({
      slides: [{ id: "s01", items: [item] }],
      assets: [
        { id: "flat", mime: "image/png", bytes: stubChrome() },
        { id: "icon", mime: "application/json", bytes: JSON.stringify(stubIcon()) },
      ],
      slideOverrides: { s01: { effects: [{ id: "icon3d", params: { asset: "icon", layout: "lay", slide: "s01", item: "s01-i003" } }] } },
    });
    const page = await openDeck(browser, deck.html);
    try {
      const samples: Array<{ arrivals: number; progress: number; active: boolean }> = [];
      for (let k = 0; k < 30; k++) {
        await page.evaluate((t) => window.__deck3d?.setTime(t), k * 0.1);
        samples.push(await page.evaluate(() => window.__deck3d?.debug.layers().find((l) => l.id === "icon3d")?.state as { arrivals: number; progress: number; active: boolean }));
      }
      expect(samples.every((s) => s.active)).toBe(true);
      expect(new Set(samples.map((s) => s.arrivals))).toEqual(new Set([1]));
      for (let i = 1; i < samples.length; i++) expect(samples[i].progress).toBeGreaterThanOrEqual(samples[i - 1].progress - 1e-9);
      expect(samples[0].progress).toBeLessThan(0.2);
      expect(samples[samples.length - 1].progress).toBe(1);
    } finally {
      await page.close();
    }
  }, 120_000);

  it("keeps every haze plane at or above the floor (E47)", async () => {
    const deck = await buildLayerDeck({
      slides: [{ id: "s01" }],
      deck: { mode: "light" },
      slideOverrides: { s01: { effects: [{ id: "haze" }] } },
    });
    const page = await openDeck(browser, deck.html);
    try {
      await settle(page, 1);
      const state = await page.evaluate(() => window.__deck3d?.debug.layers().find((l) => l.id === "haze")?.state as { minY: number; floor: number });
      expect(state.floor).toBe(-2.6);
      expect(state.minY).toBeGreaterThanOrEqual(-2.6 - 1e-6);
    } finally {
      await page.close();
    }
  }, 120_000);

  it("contains a throwing asset lookup in create and lets a valid one read a decoded image (E24)", async () => {
    const deck = await buildLayerDeck({ slides: [{ id: "s01" }], assets: [{ id: "pic", mime: "image/png", bytes: stubChrome() }] });
    const write = (name: string, src: string) => {
      mkdirSync(join(deck.dir, "fx"), { recursive: true });
      writeFileSync(join(deck.dir, "fx", `${name}.js`), src);
      writeFileSync(join(deck.dir, "fx", `${name}.meta.json`), stubCard(name));
      return createHash("sha256").update(readFileSync(join(deck.dir, "fx", `${name}.js`))).digest("hex");
    };
    const bad = write("bad", 'export default function (ctx) {\n  ctx.assets.get("nope");\n  return { object: new ctx.THREE.Group(), dispose: function () {} };\n}\n');
    const good = write(
      "good",
      'export default function (ctx) {\n  const img = ctx.assets.get("pic");\n  const g = new ctx.THREE.Group();\n  g.position.x = img.width / 100;\n  return { object: g, tick: function () {}, dispose: function () {} };\n}\n',
    );
    const d = JSON.parse(readFileSync(deck.json, "utf8"));
    d.overrides.slides.s01 = { effects: [{ id: "local:bad", sha256: bad }, { id: "local:good", sha256: good }] };
    writeFileSync(deck.json, JSON.stringify(d));
    const errs: string[] = [];
    expect(await run(["render", deck.json, "-o", deck.html], { stdout: () => {}, stderr: (l) => errs.push(l) }), errs.join(";")).toBe(0);
    const page = await openDeck(browser, deck.html);
    try {
      await settle(page, 1);
      const errors = await page.evaluate(() => window.__deck3d?.effects().errors ?? []);
      expect(errors).toEqual([{ slide: "s01", effectId: "local:bad", phase: "create" }]);
      const live = await page.evaluate(() => window.__deck3d?.debug.localFx() ?? []);
      expect(live.map((l) => l.id)).toEqual(["local:good"]);
      // The image decoded before the effect ran: its width (64 px) reached the module.
      expect(live[0].digest.split(",")[0]).toBe("0.64");
    } finally {
      await page.close();
    }
  }, 120_000);
});
