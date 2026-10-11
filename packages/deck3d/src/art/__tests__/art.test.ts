/**
 * Art tooling — change deck3d-pptx-import, test-plan #E37–#E42, #X9, #X10.
 * The trace core is exercised browser-free on RGBA buffers rasterised here
 * from Poppins glyph outlines; decode/cutout scenarios drive chromium.
 * Exemplar: `src/fx/__tests__/fx-cli.test.ts`.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { canvas, fill, font, glyphRings } from "../../__tests__/helpers/glyphs.js";
import { solidPng } from "../../__tests__/helpers/pptx.js";
import { run } from "../../cli.js";
import { openSandbox } from "../decode.js";
import { flattenPath, ICON_LIMITS, svgToPolylines } from "../icon.js";
import { decodePng } from "../png.js";
import { type Pt, signedArea, traceImage } from "../trace.js";

const hasChromium = await chromiumAvailable();
function inside(pt: Pt, ring: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

describe("art trace core", () => {
  it("traces `Rap`: CCW outers (area > 0), three CW holes inside their letters (E37)", () => {
    const img = canvas(360, 140, [255, 255, 255]);
    fill(img, glyphRings("Rap", 10, 100, 110), [20, 20, 20]);
    const out = traceImage(img);
    expect(out.polygons).toHaveLength(3);
    for (const p of out.polygons) expect(signedArea(p.outer)).toBeGreaterThan(0);
    const holes = out.polygons.flatMap((p) => p.holes.map((h) => ({ h, parent: p.outer })));
    expect(holes).toHaveLength(3);
    for (const { h, parent } of holes) {
      expect(signedArea(h)).toBeLessThan(0);
      // Every hole vertex lies within its own letter's outer ring.
      expect(h.every((v) => inside([v[0] + 0.01, v[1] + 0.01], parent) || parent.some((o) => o[0] === v[0] && o[1] === v[1]))).toBe(true);
    }
  });

  it("separates touching dark `Rack` and orange `Inspect` by palette class (E38)", () => {
    const img = canvas(820, 140, [255, 255, 255]);
    const dark: [number, number, number] = [0x16, 0x1e, 0x23];
    const orange: [number, number, number] = [0xf6, 0x75, 0x19];
    fill(img, glyphRings("Rack", 10, 100, 100), dark);
    const rackEnd = 10 + font.getAdvanceWidth("Rack", 100);
    // Overlap 3 px so the first orange glyph touches the dark `k`.
    fill(img, glyphRings("Inspect", rackEnd - 3, 100, 100), orange);
    const out = traceImage(img, { palette: ["#161e23", "#f67519"] });
    expect(new Set(out.polygons.map((p) => p.color))).toEqual(new Set(["#161e23", "#f67519"]));
    // No polygon covers pixels of the other class (interior samples only).
    for (const p of out.polygons) {
      const want = p.color === "#161e23" ? dark : orange;
      const other = want === dark ? orange : dark;
      let mixed = 0;
      let total = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const c: Pt = [x + 0.5, y + 0.5];
          if (!inside(c, p.outer) || p.holes.some((h) => inside(c, h))) continue;
          total++;
          const i = (y * img.width + x) * 4;
          if (img.data[i] === other[0] && img.data[i + 1] === other[1] && img.data[i + 2] === other[2]) mixed++;
        }
      }
      expect(mixed / Math.max(1, total), p.color).toBeLessThan(0.02);
    }
  });

  it("is byte-identical for identical pixels and flags (E39)", () => {
    const img = canvas(200, 120, [255, 255, 255]);
    fill(img, glyphRings("Ok", 10, 90, 90), [0, 0, 0]);
    const a = JSON.stringify(traceImage(img, { tolerance: 1.5, minArea: 8 }));
    const b = JSON.stringify(traceImage(img, { tolerance: 1.5, minArea: 8 }));
    expect(a).toBe(b);
  });
});

/** Independent SVG F.6.5 centre parameterisation (radii scaled when too small). */
function arcCentre(x1: number, y1: number, rxIn: number, ryIn: number, phiDeg: number, fa: boolean, fs: boolean, x2: number, y2: number) {
  const phi = (phiDeg * Math.PI) / 180;
  const xp = (Math.cos(phi) * (x1 - x2)) / 2 + (Math.sin(phi) * (y1 - y2)) / 2;
  const yp = (-Math.sin(phi) * (x1 - x2)) / 2 + (Math.cos(phi) * (y1 - y2)) / 2;
  let rx = rxIn;
  let ry = ryIn;
  const L = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (L > 1) {
    rx *= Math.sqrt(L);
    ry *= Math.sqrt(L);
  }
  const sq = Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp) / (rx * rx * yp * yp + ry * ry * xp * xp)));
  const s = fa === fs ? -sq : sq;
  const cxp = (s * rx * yp) / ry;
  const cyp = (-s * ry * xp) / rx;
  return { cx: Math.cos(phi) * cxp - Math.sin(phi) * cyp + (x1 + x2) / 2, cy: Math.sin(phi) * cxp + Math.cos(phi) * cyp + (y1 + y2) / 2, rx, ry, phi };
}

describe("art icon", () => {
  it("flattens an elliptical arc onto the analytic ellipse within 0.5 units (E40)", () => {
    const [sub] = flattenPath("M10 10 A 20 10 30 0 1 50 40");
    const e = arcCentre(10, 10, 20, 10, 30, false, true, 50, 40);
    expect(sub.points.length).toBeGreaterThan(8);
    for (const [x, y] of sub.points) {
      const dx = x - e.cx;
      const dy = y - e.cy;
      const u = (Math.cos(e.phi) * dx + Math.sin(e.phi) * dy) / e.rx;
      const v = (-Math.sin(e.phi) * dx + Math.cos(e.phi) * dy) / e.ry;
      const r = Math.hypot(u, v);
      // Radial distance from the ellipse, in user units (upper bound).
      expect(Math.abs(r - 1) * Math.max(e.rx, e.ry)).toBeLessThan(0.5);
    }
  });

  it("applies group transforms to element coordinates (E41)", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><g transform="translate(5,5) rotate(90)"><line x1="0" y1="0" x2="10" y2="0" stroke-width="2"/></g></svg>';
    const { icon } = svgToPolylines(new TextEncoder().encode(svg));
    expect(icon.polylines).toHaveLength(1);
    const [a, b] = icon.polylines[0].points;
    expect(a[0]).toBeCloseTo(5, 6);
    expect(a[1]).toBeCloseTo(5, 6);
    expect(b[0]).toBeCloseTo(5, 6);
    expect(b[1]).toBeCloseTo(15, 6);
    expect(icon.polylines[0].width).toBeCloseTo(2, 6);
  });

  it("passes inputs at the caps and rejects each over-limit or DOCTYPE input naming file and limit (X10)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-icon-"));
    const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">';
    const tail = "</svg>";
    const padTo = (n: number) => {
      const body = '<path d="M0 0L1 1"/>';
      const fixed = head.length + body.length + tail.length + "<!---->".length;
      return `${head}${body}<!--${"x".repeat(n - fixed)}-->${tail}`;
    };
    const elements = (n: number) => `${head}${'<g/>'.repeat(n - 2)}<path d="M0 0L1 1"/>${tail}`;
    const points = (n: number) => `${head}<path d="M0 0${"H1".repeat(n - 1)}"/>${tail}`;
    const cases: Array<[string, string, RegExp | null]> = [
      ["max-bytes.svg", padTo(ICON_LIMITS.maxBytes), null],
      ["over-bytes.svg", padTo(ICON_LIMITS.maxBytes + 1), /over-bytes\.svg.*2 MB limit/],
      ["doctype.svg", `<!DOCTYPE svg [<!ENTITY a "x"><!ENTITY b "&a;&a;">]>${head}${tail}`, /doctype\.svg.*DOCTYPE/],
      ["max-el.svg", elements(ICON_LIMITS.maxElements), null],
      ["over-el.svg", elements(ICON_LIMITS.maxElements + 1), /over-el\.svg.*50000 element limit/],
      ["max-pts.svg", points(ICON_LIMITS.maxPoints), null],
      ["over-pts.svg", points(ICON_LIMITS.maxPoints + 1), /over-pts\.svg.*500000 points/],
    ];
    for (const [name, body, err] of cases) {
      writeFileSync(join(dir, name), body);
      const errs: string[] = [];
      const code = await run(["art", "icon", join(dir, name), "-o", join(dir, `${name}.json`)], { stdout: () => {}, stderr: (l) => errs.push(l) });
      if (err) {
        expect(code, name).not.toBe(0);
        expect(errs.join("\n"), name).toMatch(err);
      } else expect(code, `${name}: ${errs.join(";")}`).toBe(0);
    }
    expect(readFileSync(join(dir, "max-bytes.svg")).length).toBe(ICON_LIMITS.maxBytes);
  }, 60_000);
});

describe.skipIf(!hasChromium)("art decode / cutout (chromium)", () => {
  it("decodes a hostile SVG without a network request or script run (X9)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-hostile-"));
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64"><script>fetch("https://example.com/marker")</script><image href="https://example.com/x.png" width="64" height="64"/><rect x="8" y="8" width="48" height="48" fill="#000"/></svg>';
    writeFileSync(join(dir, "hostile.svg"), svg);
    const sb = await openSandbox();
    try {
      const img = await sb.decode(new TextEncoder().encode(svg), "image/svg+xml", { size: 64 });
      expect(img.width).toBe(64);
      expect(sb.blocked).toEqual([]);
    } finally {
      await sb.close();
    }
    const r = await run(["art", "trace", join(dir, "hostile.svg"), "-o", join(dir, "out.json"), "--size", "64"], { stdout: () => {}, stderr: () => {} });
    expect(r).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "out.json"), "utf8")).polygons.length).toBeGreaterThan(0);
  }, 60_000);

  it("cuts orange corner bands off #f8f8f8 into two transparent PNGs with source boxes (E42)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-cutout-"));
    const w = 400;
    const h = 225;
    const img = decodePng(solidPng(w, h, [0xf8, 0xf8, 0xf8, 255], { x: 0, y: 0, w: 120, h: 30, rgba: [0xf6, 0x75, 0x19, 255] }));
    for (let y = h - 30; y < h; y++) for (let x = w - 120; x < w; x++) img.data.set([0xf6, 0x75, 0x19, 255], (y * w + x) * 4);
    const { encodePng } = await import("../png.js");
    writeFileSync(join(dir, "bg.png"), encodePng(img));
    const code = await run(["art", "cutout", join(dir, "bg.png"), "--bg", "#f8f8f8", "--split", "-o", join(dir, "out")], { stdout: () => {}, stderr: () => {} });
    expect(code).toBe(0);
    const pngs = readdirSync(join(dir, "out")).filter((n) => n.endsWith(".png")).sort();
    expect(pngs).toEqual(["bg-0.png", "bg-1.png"]);
    const index = JSON.parse(readFileSync(join(dir, "out", "bg.cutout.json"), "utf8"));
    const boxes = index.regions.map((r: { x: number; y: number; w: number; h: number }) => [r.x, r.y, r.w, r.h]);
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 1);
    expect(boxes.some((b: number[]) => near(b, [0, 0, 120, 30]))).toBe(true);
    expect(boxes.some((b: number[]) => near(b, [w - 120, h - 30, 120, 30]))).toBe(true);
    // Colour-to-alpha: a band pixel composited back over #f8f8f8 reproduces the source.
    const piece = decodePng(new Uint8Array(readFileSync(join(dir, "out", "bg-0.png"))));
    const a = piece.data[3] / 255;
    expect(a).toBeGreaterThan(0.8);
    const back = [0, 1, 2].map((c) => Math.round(piece.data[c] * a + 0xf8 * (1 - a)));
    expect(back.map((v, c) => Math.abs(v - [0xf6, 0x75, 0x19][c]) <= 2)).toEqual([true, true, true]);
    const whole = await run(["art", "cutout", join(dir, "bg.png"), "--bg", "#f8f8f8", "-o", join(dir, "whole")], { stdout: () => {}, stderr: () => {} });
    expect(whole).toBe(0);
    const full = decodePng(new Uint8Array(readFileSync(join(dir, "whole", "bg.png"))));
    expect(full.data[((h >> 1) * w + (w >> 1)) * 4 + 3]).toBe(0);
    expect(existsSync(join(dir, "whole", "bg.cutout.json"))).toBe(false);
  }, 60_000);
});
