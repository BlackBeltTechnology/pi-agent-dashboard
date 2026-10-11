/**
 * pptx import — change deck3d-pptx-import, test-plan #E5–#E19, #X1–#X8.
 * Synthetic decks come from `helpers/pptx.ts` (generated at test time).
 * Exemplar: `src/__tests__/cli-build.test.ts`.
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "fflate";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import {
  basicDeck,
  bodyShape,
  buildPptx,
  EMU_4x3,
  graphicFrame,
  groupShape,
  picShape,
  rawZip,
  solidPng,
  textBox,
  titleShape,
  URI,
} from "../../__tests__/helpers/pptx.js";
import { decodePng } from "../../art/png.js";
import { run } from "../../cli.js";
import { importPptx } from "../import.js";
import type { ImgItem, Layout, TextItem } from "../types.js";
import { ZIP_LIMITS, ZipLimitError } from "../zip.js";

const hasChromium = await chromiumAvailable();
const NO_PATH = { PATH: "" };

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "deck3d-pptx-"));
}

async function cli(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, { stdout: (l) => out.push(l), stderr: (l) => err.push(l) });
  return { code, out, err, stderr: err.join("\n") };
}

function writeDeck(dir: string, spec: Parameters<typeof buildPptx>[0], name = "talk.pptx"): string {
  const p = join(dir, name);
  writeFileSync(p, buildPptx(spec));
  return p;
}

function layoutOf(dir: string): Layout {
  return JSON.parse(readFileSync(join(dir, "pptx", "layout.json"), "utf8")) as Layout;
}

/** Recursive digest of a directory tree (names + bytes). */
function treeHash(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string, rel: string): void => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      h.update(`${rel}/${name}\n`);
      if (statSync(p).isDirectory()) walk(p, `${rel}/${name}`);
      else h.update(readFileSync(p));
    }
  };
  walk(dir, "");
  return h.digest("hex");
}

describe("pptx import: command and outputs", () => {
  it("fresh 5-slide import writes layout, media, deck.md and a valid deck.json (E5)", async () => {
    const dir = tmp();
    const input = writeDeck(dir, basicDeck(5));
    const r = await cli(["pptx", "import", input, "-o", join(dir, "talk")]);
    expect(r.code, r.stderr).toBe(0);
    const layout = layoutOf(join(dir, "talk"));
    expect(layout.slides.map((s) => s.id)).toEqual(["s01", "s02", "s03", "s04", "s05"]);
    const imgs = layout.slides.flatMap((s) => s.items).filter((i): i is ImgItem => i.kind === "img");
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expect(existsSync(join(dir, "talk", "pptx", "media", img.media)), img.media).toBe(true);
    const md = readFileSync(join(dir, "talk", "deck.md"), "utf8");
    expect(md.match(/^# .*\{#s0\d\}$/gm)).toHaveLength(5);
    const v = await cli(["validate", join(dir, "talk", "deck.json")]);
    expect(v.code, v.stderr).toBe(0);
  });

  it("refuses to clobber an existing deck.md without --force (E6)", async () => {
    const dir = tmp();
    const input = writeDeck(dir, basicDeck(2));
    mkdirSync(join(dir, "talk"));
    writeFileSync(join(dir, "talk", "deck.md"), "# Mine\n");
    const before = treeHash(join(dir, "talk"));
    const r = await cli(["pptx", "import", input, "-o", join(dir, "talk")]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(join(dir, "talk", "deck.md"));
    expect(treeHash(join(dir, "talk"))).toBe(before);
  });

  it("an aborted import leaves no pptx/, no new deck files and no staging dir (X7)", async () => {
    const dir = tmp();
    const media: Record<string, Uint8Array> = {};
    let shapes = titleShape("Many pictures");
    const rels: Record<string, [string, string]> = {};
    for (let i = 0; i < 45; i++) {
      media[`image${i}.png`] = solidPng(2, 2, [i, 255 - i, 7, 255]);
      rels[`rIdP${i}`] = ["image", `../media/image${i}.png`];
      shapes += picShape(`rIdP${i}`, 100000 * i, 100000, 90000, 90000);
    }
    const input = writeDeck(dir, { media, slides: [{ shapes, rels }] });
    mkdirSync(join(dir, "talk"));
    writeFileSync(join(dir, "talk", "notes.txt"), "keep");
    const before = treeHash(join(dir, "talk"));
    let mediaWrites = 0;
    await expect(
      importPptx({
        input,
        out: join(dir, "talk"),
        env: NO_PATH,
        write: (path, data) => {
          if (path.includes("/pptx/media/") && ++mediaWrites === 40) throw new Error("disk full (injected)");
          writeFileSync(path, data);
        },
      }),
    ).rejects.toThrow(/disk full/);
    expect(existsSync(join(dir, "talk", "pptx"))).toBe(false);
    expect(existsSync(join(dir, "talk", "deck.md"))).toBe(false);
    expect(treeHash(join(dir, "talk"))).toBe(before);
    expect(readdirSync(dir).filter((n) => n.includes("deck3d-import"))).toEqual([]);
  });
});

describe("pptx import: slide space and layout", () => {
  it("is deterministic: two imports give byte-identical layout.json (E7)", async () => {
    const dir = tmp();
    const input = writeDeck(dir, basicDeck(3));
    await importPptx({ input, out: join(dir, "a"), env: NO_PATH });
    await importPptx({ input, out: join(dir, "b"), env: NO_PATH });
    const a = readFileSync(join(dir, "a", "pptx", "layout.json"));
    expect(a.equals(readFileSync(join(dir, "b", "pptx", "layout.json")))).toBe(true);
    for (const name of readdirSync(join(dir, "a", "pptx", "media"))) expect(name).toMatch(/^m-[0-9a-f]{12}\.[a-z0-9]+$/);
  });

  it("resolves schemeClr accent2 + lumMod 75000 to the HSL-modulated hex (E8)", async () => {
    const dir = tmp();
    const run = ' sz="2400"><a:solidFill><a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr></a:solidFill></a:rPr>';
    const input = writeDeck(dir, { accent2: "F66D03", slides: [{ shapes: titleShape("Colour") + textBox("Orange", { runXml: run }) }] });
    await importPptx({ input, out: join(dir, "t"), env: NO_PATH });
    const text = layoutOf(join(dir, "t")).slides[0].items.find((i): i is TextItem => i.kind === "text" && i.paragraphs[0].runs[0].text === "Orange");
    // Golden: Python colorsys HLS of #F66D03 with L × 0.75 → (184.5, 81.75, 2.25),
    // rounded half-up per channel (Python's round() would give 184 — half-even).
    expect(text?.paragraphs[0].runs[0].color).toBe("#b95202");
  });

  it("composes a 90°-rotated group with chOff/chExt ≠ off/ext into the icon rect (E9)", async () => {
    const dir = tmp();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    const icon = picShape("rId2", 2000000, 0, 1000000, 1000000, { svgRId: "rId3" });
    const group = groupShape(icon, { x: 1000000, y: 1000000, w: 2000000, h: 1000000, chX: 0, chY: 0, chW: 4000000, chH: 2000000, rot: 5400000 });
    const input = writeDeck(dir, {
      media: { "image2.png": solidPng(4, 4, [0, 0, 0, 255]), "image3.svg": svg },
      slides: [{ shapes: titleShape("Icons") + group, rels: { rId2: ["image", "../media/image2.png"], rId3: ["image", "../media/image3.svg"] } }],
    });
    await importPptx({ input, out: join(dir, "t"), env: NO_PATH });
    const img = layoutOf(join(dir, "t")).slides[0].items.find((i): i is ImgItem => i.kind === "img");
    // Hand-computed: child centre (2.5M,0.5M) → scaled (2.25M,1.25M) → rotated
    // 90° cw about the group centre (2M,1.5M) → (2.25M,1.75M); size 0.5M.
    const k = 1920 / 12192000;
    expect(img?.rotation).toBe(90);
    expect(img?.svg).toMatch(/\.svg$/);
    expect(Math.abs((img?.rect.x ?? 0) - 2000000 * k)).toBeLessThanOrEqual(2);
    expect(Math.abs((img?.rect.y ?? 0) - 1500000 * k)).toBeLessThanOrEqual(2);
    expect(Math.abs((img?.rect.w ?? 0) - 500000 * k)).toBeLessThanOrEqual(2);
    expect(Math.abs((img?.rect.h ?? 0) - 500000 * k)).toBeLessThanOrEqual(2);
  });

  it("records a 4:3 deck as 1920×1440 slide space (E10)", async () => {
    const dir = tmp();
    const input = writeDeck(dir, {
      size: EMU_4x3,
      slides: [{ shapes: `${titleShape("Square")}<p:sp><p:nvSpPr><p:cNvPr id="90" name="Full"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:spPr></p:sp>` }],
    });
    await importPptx({ input, out: join(dir, "t"), env: NO_PATH });
    const layout = layoutOf(join(dir, "t"));
    expect(layout.size).toEqual({ w: 1920, h: 1440 });
    const full = layout.slides[0].items.find((i) => i.kind === "rect");
    expect(full?.rect).toEqual({ x: 0, y: 0, w: 1920, h: 1440 });
  });

  it("applies stored normAutofit scale + line reduction and keeps spAutoFit extents (E11)", async () => {
    const dir = tmp();
    const shapes =
      titleShape("Fit") +
      textBox("Shrunk", { runXml: ' sz="2800"/>', bodyPr: '<a:bodyPr><a:normAutofit fontScale="62500" lnSpcReduction="20000"/></a:bodyPr>' }) +
      textBox("Grown", { x: 914400, y: 3000000, w: 2000000, h: 777240, bodyPr: "<a:bodyPr><a:spAutoFit/></a:bodyPr>" });
    const input = writeDeck(dir, { slides: [{ shapes }] });
    await importPptx({ input, out: join(dir, "t"), env: NO_PATH });
    const items = layoutOf(join(dir, "t")).slides[0].items.filter((i): i is TextItem => i.kind === "text");
    const shrunk = items.find((i) => i.paragraphs[0].runs[0].text === "Shrunk");
    expect(shrunk?.autofit).toBe("norm");
    expect(shrunk?.paragraphs[0].runs[0].size).toBe(35); // 28 pt × 2 units/pt × 0.625
    expect(shrunk?.paragraphs[0].lineSpacing).toBeCloseTo(0.8, 6);
    const grown = items.find((i) => i.paragraphs[0].runs[0].text === "Grown");
    const k = 1920 / 12192000;
    expect(grown?.autofit).toBe("shape");
    expect(grown?.rect.w).toBeCloseTo(2000000 * k, 1);
    expect(grown?.rect.h).toBeCloseTo(777240 * k, 1);
  });
});

/** Slide with a chart, a table, an EMF picture and WordArt. */
function unsupportedDeck(): Parameters<typeof buildPptx>[0] {
  const wordArt = textBox("Wow", { x: 6000000, y: 4000000, w: 2000000, h: 1000000, bodyPr: '<a:bodyPr><a:prstTxWarp prst="textArchUp"><a:avLst/></a:prstTxWarp></a:bodyPr>' });
  return {
    media: { "image5.emf": new Uint8Array([1, 0, 0, 0, 9, 9, 9, 9]) },
    slides: [
      {
        shapes:
          titleShape("Unsupported") +
          graphicFrame(URI.chart, 609600, 1524000, 3048000, 2286000) +
          graphicFrame(URI.table, 4000000, 1524000, 3048000, 1000000) +
          picShape("rId5", 8000000, 1524000, 1000000, 1000000) +
          wordArt,
        rels: { rId5: ["image", "../media/image5.emf"] },
      },
    ],
  };
}

describe("pptx import: supported content and fallbacks", () => {
  it("turns chart/table/EMF/WordArt into 4 fallbacks: crops with --ref, placeholders without (E12)", async () => {
    const dir = tmp();
    const input = writeDeck(dir, unsupportedDeck());
    // Reference render with a red box exactly where the chart sits.
    const k = 1920 / 12192000;
    const chart = { x: Math.round(609600 * k), y: Math.round(1524000 * k), w: Math.round(3048000 * k), h: Math.round(2286000 * k) };
    mkdirSync(join(dir, "ref"));
    writeFileSync(join(dir, "ref", "Slide1.png"), solidPng(1920, 1080, [255, 255, 255, 255], { ...chart, rgba: [220, 0, 0, 255] }));

    const withRef = await importPptx({ input, out: join(dir, "a"), ref: join(dir, "ref"), env: NO_PATH });
    const fbA = layoutOf(join(dir, "a")).slides[0].items.filter((i) => i.kind === "fallback");
    expect(fbA.map((f) => (f as { construct: string }).construct).sort()).toEqual(["chart", "emf", "table", "wordart"]);
    for (const f of fbA) expect((f as { media?: string }).media, f.id).toMatch(/^m-[0-9a-f]{12}\.png$/);
    const chartItem = fbA.find((f) => (f as { construct: string }).construct === "chart") as { media: string; rect: { w: number; h: number } };
    const crop = decodePng(new Uint8Array(readFileSync(join(dir, "a", "pptx", "media", chartItem.media))));
    expect(Math.abs(crop.width - chartItem.rect.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(crop.height - chartItem.rect.h)).toBeLessThanOrEqual(1);
    const mid = ((crop.height >> 1) * crop.width + (crop.width >> 1)) * 4;
    expect([crop.data[mid], crop.data[mid + 1], crop.data[mid + 2]]).toEqual([220, 0, 0]);
    const lineA = withRef.warnings.filter((w) => /^warning s01-i\d{3} (chart|table|emf|wordart)\b/.test(w));
    expect(lineA).toHaveLength(4);

    const noRef = await importPptx({ input, out: join(dir, "b"), env: NO_PATH });
    const fbB = layoutOf(join(dir, "b")).slides[0].items.filter((i) => i.kind === "fallback");
    expect(fbB).toHaveLength(4);
    for (const f of fbB) expect((f as { media?: string }).media).toBeUndefined();
    expect(noRef.warnings.filter((w) => /^warning s01-i\d{3} (chart|table|emf|wordart)\b/.test(w))).toHaveLength(4);
  });

  it("names encryption for an OLE file with EncryptionInfo, and 'not a .pptx' for a legacy .ppt (X6)", async () => {
    const dir = tmp();
    const ole = (stream: string) => {
      const head = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
      const name = [...stream].flatMap((c) => [c.charCodeAt(0), 0]);
      return new Uint8Array([...head, ...new Array(504).fill(0), ...name, ...new Array(64).fill(0)]);
    };
    writeFileSync(join(dir, "enc.pptx"), ole("EncryptionInfo"));
    writeFileSync(join(dir, "old.pptx"), ole("PowerPoint Document"));
    const a = await cli(["pptx", "import", join(dir, "enc.pptx"), "-o", join(dir, "a")]);
    expect(a.code).not.toBe(0);
    expect(a.stderr).toMatch(/encrypted/);
    const b = await cli(["pptx", "import", join(dir, "old.pptx"), "-o", join(dir, "b")]);
    expect(b.code).not.toBe(0);
    expect(b.stderr).toContain("not a .pptx (OOXML) file");
    expect(existsSync(join(dir, "a"))).toBe(false);
    expect(existsSync(join(dir, "b"))).toBe(false);
  });
});

describe("pptx import: reference renders", () => {
  it.skipIf(!hasChromium)("maps PowerPoint/Keynote/plain names and warns once about leftovers (E13)", async () => {
    const dir = tmp();
    const input = writeDeck(dir, basicDeck(5));
    mkdirSync(join(dir, "ref"));
    const png = solidPng(32, 18, [10, 20, 30, 255]);
    writeFileSync(join(dir, "ref", "Slide1.PNG"), png);
    writeFileSync(join(dir, "ref", "Deck - 2.png"), png);
    writeFileSync(join(dir, "ref", "4.png"), png);
    writeFileSync(join(dir, "ref", "notes.png"), png);
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 32, height: 18 } });
      writeFileSync(join(dir, "ref", "slide_3.jpg"), await page.screenshot({ type: "jpeg" }));
    } finally {
      await browser.close();
    }
    const r = await importPptx({ input, out: join(dir, "t"), ref: join(dir, "ref"), env: NO_PATH });
    for (const id of ["s01", "s02", "s03", "s04"]) expect(existsSync(join(dir, "t", "pptx", "ref", `${id}.png`)), id).toBe(true);
    expect(existsSync(join(dir, "t", "pptx", "ref", "s05.png"))).toBe(false);
    expect(decodePng(new Uint8Array(readFileSync(join(dir, "t", "pptx", "ref", "s03.png")))).width).toBe(32);
    const ref = r.warnings.filter((w) => w.includes("--ref"));
    expect(ref).toHaveLength(1);
    expect(ref[0]).toContain("notes.png");
    expect(ref[0]).toMatch(/slides without a reference: 5\b/);
  });

  it("without --ref or soffice: exit 0, no pptx/ref, exactly one warning (E14)", async () => {
    const dir = tmp();
    const input = writeDeck(dir, basicDeck(2));
    const r = await importPptx({ input, out: join(dir, "t"), env: NO_PATH });
    expect(existsSync(join(dir, "t", "pptx", "ref"))).toBe(false);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/no reference renders/);
  });

  it("a failing soffice is one warning naming the tool and its status (X8)", async () => {
    const dir = tmp();
    const input = writeDeck(dir, basicDeck(2));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    for (const [tool, code] of [["soffice", 3], ["pdftoppm", 0]] as const) {
      writeFileSync(join(bin, tool), `#!/bin/sh\nexit ${code}\n`);
      chmodSync(join(bin, tool), 0o755);
    }
    const r = await importPptx({ input, out: join(dir, "t"), env: { PATH: bin } });
    expect(existsSync(join(dir, "t", "pptx", "ref"))).toBe(false);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/soffice.*status 3/);
  });
});

describe.skipIf(!hasChromium)("pptx import: baseline deck builds (chromium)", () => {
  it("builds as a native deck with no check errors and every pptx title measured (E15)", async () => {
    const dir = tmp();
    const titles = ["Opening", "Market", "Product", "Team", "Ask"];
    const input = writeDeck(dir, basicDeck(5, { titles }));
    await importPptx({ input, out: join(dir, "talk"), env: NO_PATH });
    const b = await cli(["build", join(dir, "talk", "deck.md"), "-o", join(dir, "talk", "deck.html")]);
    expect(b.code, b.stderr).toBe(0);
    expect(b.stderr).not.toMatch(/^error/m);
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(dir, "talk", "deck.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      for (let i = 0; i < titles.length; i++) {
        await page.evaluate((n) => {
          window.__deck3d?.gotoSlide(n);
          window.__deck3d?.setTime(0);
        }, i + 1);
        await page.evaluate(() => window.__deck3d?.ready());
        const m = await page.evaluate(() => window.__deck3d?.measure() ?? []);
        expect(m.find((r) => r.kind === "title")?.text, `slide ${i + 1}`).toBe(titles[i]);
      }
    } finally {
      await browser.close();
    }
  }, 240_000);
});

describe("pptx import: re-import keeps tuning", () => {
  async function baseImport(dir: string, spec = basicDeck(5)) {
    const input = writeDeck(dir, spec);
    await importPptx({ input, out: join(dir, "talk"), env: NO_PATH });
    return input;
  }

  it("keeps a configurator value and backs up deck.json (E16)", async () => {
    const dir = tmp();
    const input = await baseImport(dir);
    const deckPath = join(dir, "talk", "deck.json");
    const deck = JSON.parse(readFileSync(deckPath, "utf8"));
    deck.overrides.slides.s03 = { camera: { distance: 11 } };
    writeFileSync(deckPath, `${JSON.stringify(deck, null, 2)}\n`);
    const previous = readFileSync(deckPath);
    const r = await cli(["pptx", "import", input, "-o", join(dir, "talk"), "--force"]);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(deckPath, "utf8")).overrides.slides.s03.camera.distance).toBe(11);
    expect(readFileSync(join(dir, "talk", "deck.json.bak")).equals(previous)).toBe(true);
  });

  it("an inserted slide does not shift ids or tuning (E17)", async () => {
    const dir = tmp();
    const titles = ["One", "Two", "Three", "Four", "Five"];
    await baseImport(dir, basicDeck(5, { titles }));
    const deckPath = join(dir, "talk", "deck.json");
    const deck = JSON.parse(readFileSync(deckPath, "utf8"));
    deck.overrides.slides.s03 = { mode: "dark" };
    writeFileSync(deckPath, JSON.stringify(deck));
    // Same content, with "Inserted" before old slide 3.
    const spec = basicDeck(5, { titles });
    spec.slides.splice(2, 0, { shapes: titleShape("Inserted") + bodyShape(["New point"]) });
    const input = writeDeck(dir, spec);
    const r = await importPptx({ input, out: join(dir, "talk"), force: true, env: NO_PATH });
    const layout = layoutOf(join(dir, "talk"));
    expect(layout.slides.map((s) => s.title)).toEqual(["One", "Two", "Inserted", "Three", "Four", "Five"]);
    expect(layout.slides.map((s) => s.id)).toEqual(["s01", "s02", "s06", "s03", "s04", "s05"]);
    expect(JSON.parse(readFileSync(deckPath, "utf8")).overrides.slides.s03.mode).toBe("dark");
    expect(r.warnings.some((w) => /slide s06 is new/.test(w) && w.includes("Inserted"))).toBe(true);
  });

  it("a replaced image keeps its asset id with a new path and sha (E18)", async () => {
    const dir = tmp();
    const spec = (rgb: [number, number, number, number]) => ({
      media: { "image7.png": solidPng(4, 4, rgb) },
      slides: [{ shapes: titleShape("Pic") + picShape("rId7", 100000, 100000, 900000, 900000), rels: { rId7: ["image", "../media/image7.png"] as [string, string] } }],
    });
    await baseImport(dir, spec([1, 2, 3, 255]));
    const deckPath = join(dir, "talk", "deck.json");
    const deck = JSON.parse(readFileSync(deckPath, "utf8"));
    const before = deck.overrides.assets.find((a: { id: string }) => a.id === "pptx-ppt-media-image7-png");
    expect(before).toBeDefined();
    deck.overrides.slides.s01 = { effects: [{ id: "aurora", params: { note: "pptx-ppt-media-image7-png" } }] };
    writeFileSync(deckPath, JSON.stringify(deck));
    const input = writeDeck(dir, spec([200, 100, 50, 255]));
    await importPptx({ input, out: join(dir, "talk"), force: true, env: NO_PATH });
    const after = JSON.parse(readFileSync(deckPath, "utf8")).overrides.assets.find((a: { id: string }) => a.id === "pptx-ppt-media-image7-png");
    expect(after.path).not.toBe(before.path);
    expect(after.sha256).not.toBe(before.sha256);
    expect(after.path).toMatch(/^pptx\/media\/m-[0-9a-f]{12}\.png$/);
    const v = await cli(["validate", deckPath]);
    expect(v.code, v.stderr).toBe(0);
  });

  it("drops a vanished unreferenced asset with a warning; fails untouched when referenced (E19)", async () => {
    const make = (withImage9: boolean) => ({
      media: { "image1.png": solidPng(2, 2, [1, 1, 1, 255]), ...(withImage9 ? { "image9.png": solidPng(2, 2, [9, 9, 9, 255]) } : {}) },
      slides: [
        {
          shapes: titleShape("Pics") + picShape("rId1", 0, 0, 100000, 100000) + (withImage9 ? picShape("rId9", 200000, 0, 100000, 100000) : ""),
          rels: { rId1: ["image", "../media/image1.png"] as [string, string], ...(withImage9 ? { rId9: ["image", "../media/image9.png"] as [string, string] } : {}) },
        },
      ],
    });
    // A — unreferenced.
    const a = tmp();
    await baseImport(a, make(true));
    const ra = await importPptx({ input: writeDeck(a, make(false)), out: join(a, "talk"), force: true, env: NO_PATH });
    const assetsA = JSON.parse(readFileSync(join(a, "talk", "deck.json"), "utf8")).overrides.assets.map((x: { id: string }) => x.id);
    expect(assetsA).not.toContain("pptx-ppt-media-image9-png");
    expect(ra.warnings.filter((w) => w.includes("pptx-ppt-media-image9-png"))).toHaveLength(1);
    // B — referenced by an effect param.
    const b = tmp();
    await baseImport(b, make(true));
    const deckPath = join(b, "talk", "deck.json");
    const deck = JSON.parse(readFileSync(deckPath, "utf8"));
    deck.overrides.slides.s01 = { effects: [{ id: "aurora", params: { img: "pptx-ppt-media-image9-png" } }] };
    writeFileSync(deckPath, JSON.stringify(deck));
    const before = treeHash(join(b, "talk"));
    const rb = await cli(["pptx", "import", writeDeck(b, make(false)), "-o", join(b, "talk"), "--force"]);
    expect(rb.code).not.toBe(0);
    expect(rb.stderr).toContain('overrides.slides["s01"].effects[0].params.img');
    expect(treeHash(join(b, "talk"))).toBe(before);
  });
});

// ── untrusted input ──────────────────────────────────────────────────────────

const enc = (s: string) => new TextEncoder().encode(s);

/** Deflate `size` zero bytes, then pad the stored stream to `storedLen` bytes. */
function paddedZeros(size: number, storedLen: number): Uint8Array {
  const d = deflateSync(new Uint8Array(size), { level: 9 });
  if (d.length > storedLen) throw new Error(`deflate ${d.length} > ${storedLen}`);
  const out = new Uint8Array(storedLen);
  out.set(d);
  for (let i = d.length; i < storedLen; i++) out[i] = (i * 31) & 255;
  return out;
}

describe("pptx import: untrusted input", () => {
  it("stops inflating a bomb at the 128 MiB entry limit (X1)", async () => {
    const size = 129 * 1024 * 1024;
    const stored = paddedZeros(size, 1024 * 1024);
    const bytes = rawZip([{ name: "ppt/media/bomb.png", stored, method: 8, size: 1000 }]);
    const { readPptxZip } = await import("../zip.js");
    let caught: unknown;
    try {
      readPptxZip(bytes);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ZipLimitError);
    expect((caught as Error).message).toContain("ppt/media/bomb.png");
    expect((caught as Error).message).toContain("128 MiB");
    // One inflate step emits at most SLICE × 1032 bytes (deflate's max ratio).
    expect((caught as ZipLimitError).inflated).toBeLessThanOrEqual(ZIP_LIMITS.maxEntryBytes + 4096 * 1032);

    const dir = tmp();
    writeFileSync(join(dir, "bomb.pptx"), bytes);
    mkdirSync(join(dir, "t"));
    const before = treeHash(join(dir, "t"));
    const r = await cli(["pptx", "import", join(dir, "bomb.pptx"), "-o", join(dir, "t")]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("128 MiB");
    expect(treeHash(join(dir, "t"))).toBe(before);
  }, 60_000);

  it("accepts 4000 entries and rejects 4001 naming the limit (X2)", async () => {
    const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `f/${i}.txt`, stored: enc("x"), method: 0 as const, size: 1 }));
    const dir = tmp();
    writeFileSync(join(dir, "a.pptx"), rawZip(entries(4000)));
    writeFileSync(join(dir, "b.pptx"), rawZip(entries(4001)));
    const a = await cli(["pptx", "import", join(dir, "a.pptx"), "-o", join(dir, "a")]);
    expect(a.code).not.toBe(0);
    expect(a.stderr).not.toMatch(/4000/); // past the zip stage: fails as "not a .pptx" instead
    const b = await cli(["pptx", "import", join(dir, "b.pptx"), "-o", join(dir, "b")]);
    expect(b.code).not.toBe(0);
    expect(b.stderr).toMatch(/4001 entries \(limit 4000\)/);
  });

  it("accepts an actual 200:1 entry and rejects 201:1 naming entry and ratio (X3)", async () => {
    const { readPptxZip } = await import("../zip.js");
    const ok = rawZip([{ name: "ppt/a.bin", stored: paddedZeros(200 * 10000, 10000), method: 8, size: 1000 }]);
    expect(() => readPptxZip(ok)).not.toThrow();
    const bad = rawZip([{ name: "ppt/b.bin", stored: paddedZeros(201 * 10000, 10000), method: 8, size: 1000 }]);
    expect(() => readPptxZip(bad)).toThrow(/ppt\/b\.bin.*200:1/);
  });

  it("rejects zip-slip and absolute entry names and writes nothing outside the target (X4)", async () => {
    const root = tmp();
    const work = join(root, "work");
    mkdirSync(work);
    for (const name of ["ppt/media/../../../evil.png", "/abs.png"]) {
      const file = join(work, "slip.pptx");
      writeFileSync(file, rawZip([{ name, stored: enc("x"), method: 0, size: 1 }]));
      const r = await cli(["pptx", "import", file, "-o", join(work, "t")]);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain(name);
    }
    const all: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        all.push(n);
        if (statSync(join(d, n)).isDirectory()) walk(join(d, n));
      }
    };
    walk(root);
    expect(all.filter((n) => n.includes("evil") || n.includes("abs.png"))).toEqual([]);
    expect(existsSync(join(work, "t"))).toBe(false);
  });

  it("rejects a DOCTYPE in an XML part but not the same bytes inside a PNG (X5)", async () => {
    const dir = tmp();
    const evil = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "aa"><!ENTITY b "&a;&a;">]><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`;
    const xmlCase = writeDeck(dir, { ...basicDeck(1), extra: { "ppt/slides/slide1.xml": evil } }, "xml.pptx");
    const a = await cli(["pptx", "import", xmlCase, "-o", join(dir, "a")]);
    expect(a.code).not.toBe(0);
    expect(a.stderr).toContain("ppt/slides/slide1.xml");
    const png = new Uint8Array([...solidPng(2, 2, [0, 0, 0, 255]), ...enc("<!DOCTYPE x>")]);
    const pngCase = writeDeck(
      dir,
      { media: { "image1.png": png }, slides: [{ shapes: titleShape("P") + picShape("rId2", 0, 0, 100000, 100000), rels: { rId2: ["image", "../media/image1.png"] } }] },
      "png.pptx",
    );
    const b = await cli(["pptx", "import", pngCase, "-o", join(dir, "b")]);
    expect(b.code, b.stderr).toBe(0);
  });
});

