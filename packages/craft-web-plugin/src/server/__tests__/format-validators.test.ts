/**
 * Test-plan #E20 — per-format validators behind the dispatcher (design D7): a valid sample and invalid
 * ones per extension, a 10 001-entry zip, an unknown extension. Pure module calls here; the worker-pool
 * leg (each route loads and runs in the REAL pool) is in `validator-worker.test.ts`.
 * See change: extend-craft-web-to-all-apps.
 */
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ROUTES, validate } from "../validators/index.mjs";

const bytes = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "latin1"));
const pad = (b: Uint8Array, n: number): Uint8Array => {
  const out = new Uint8Array(Math.max(n, b.length));
  out.set(b);
  return out;
};
const ok = (b: Uint8Array, ext: string) => expect(validate(b, ext), ext).toEqual({ ok: true });
const bad = (b: Uint8Array, ext: string) => expect(validate(b, ext).ok, ext).toBe(false);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const PDF = bytes("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const DXF = bytes("999\ncomment\n  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nSECTION\n  2\nENTITIES\n  0\nCIRCLE\n 10\n10.0\n 20\n10.0\n 40\n5.0\n  0\nENDSEC\n  0\nEOF\n");
const zip = (files: Record<string, string | [string, number]>): Uint8Array =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Array.isArray(v) ? [strToU8(v[0]), { level: v[1] as 0 }] : strToU8(v)])));
const ODT_MIME = "application/vnd.oasis.opendocument.text";

describe("E20 format validators", () => {
  it(".pdf: header + %%EOF ok; no %%EOF, PNG bytes rejected", () => {
    ok(PDF, ".pdf");
    bad(bytes("%PDF-1.4\n1 0 obj<<>>endobj\n"), ".pdf");
    bad(PNG, ".pdf");
  });

  it(".dxf: ASCII and binary sentinel ok; PDF bytes and a truncated ASCII file rejected", () => {
    ok(DXF, ".dxf");
    ok(bytes("  0\r\nSECTION\r\n  2\r\nENTITIES\r\n  0\r\nENDSEC\r\n  0\r\nEOF\r\n"), ".dxf");
    ok(pad(bytes("AutoCAD Binary DXF\r\n\x1a\0"), 64), ".dxf");
    bad(PDF, ".dxf");
    bad(bytes("  0\nSECTION\n  2\nENTITIES\n  0\nENDSEC\n"), ".dxf");
    bad(bytes("  0\nSECTION\nnot-a-code\nx\n  0\nEOF\n"), ".dxf");
  });

  it(".dwg: AC1015 ok; AC9999 and garbage rejected", () => {
    ok(pad(bytes("AC1015"), 256), ".dwg");
    ok(pad(bytes("AC1032"), 256), ".dwg");
    bad(pad(bytes("AC9999"), 256), ".dwg");
    bad(pad(bytes("garbage!"), 256), ".dwg");
  });

  it(".odt: stored mimetype first + content.xml ok; wrong mimetype, deflated / not-first mimetype, no content.xml rejected", () => {
    ok(zip({ mimetype: [ODT_MIME, 0], "content.xml": "<x/>", "styles.xml": "<s/>" }), ".odt");
    bad(zip({ mimetype: ["application/vnd.oasis.opendocument.spreadsheet", 0], "content.xml": "<x/>" }), ".odt");
    bad(zip({ mimetype: [ODT_MIME, 0] }), ".odt");
    bad(zip({ "content.xml": "<x/>", mimetype: [ODT_MIME, 0] }), ".odt");
    bad(zip({ mimetype: [ODT_MIME.repeat(1), 9], "content.xml": "<x/>" }), ".odt");
    bad(PDF, ".odt");
  });

  it(".rtf: {\\rtf1 ok; {\\rtf2 rejected", () => {
    ok(bytes("{\\rtf1\\ansi hello}"), ".rtf");
    bad(bytes("{\\rtf2\\ansi hello}"), ".rtf");
    bad(bytes("{\\rtf12}"), ".rtf");
    bad(bytes("hello"), ".rtf");
  });

  it(".designcraft: mimetype + document.json ok; without document.json or with a wrong mimetype rejected", () => {
    ok(zip({ mimetype: ["application/vnd.designcraft+zip", 0], "meta.json": "{}", "document.json": "{}", "assets/1.png": "x" }), ".designcraft");
    bad(zip({ mimetype: ["application/vnd.designcraft+zip", 0], "meta.json": "{}" }), ".designcraft");
    bad(zip({ mimetype: ["application/zip", 0], "document.json": "{}" }), ".designcraft");
  });

  it(".scraftz: exactly one top-level .scraft ok (Audio Files/ optional); two or none rejected", () => {
    ok(zip({ "Midnight Groove.scraft": "{}", "Audio Files/tone.wav": "RIFF" }), ".scraftz");
    ok(zip({ "Mix.scraft": "{}" }), ".scraftz");
    bad(zip({ "a.scraft": "{}", "b.scraft": "{}" }), ".scraftz");
    bad(zip({ "Audio Files/tone.wav": "RIFF" }), ".scraftz");
    bad(zip({ "nested/a.scraft": "{}" }), ".scraftz");
  });

  it("a zip with 10 001 entries is rejected", () => {
    const files: Record<string, string> = { "Mix.scraft": "{}" };
    for (let i = 0; i < 10_000; i++) files[`Audio Files/${i}.wav`] = "";
    bad(zip(files), ".scraftz");
  });

  it("an unknown extension is rejected; empty bytes are rejected", () => {
    expect(validate(PDF, ".exe")).toMatchObject({ ok: false, reason: "unsupported extension .exe" });
    bad(new Uint8Array(0), ".pdf");
  });

  it("the OOXML route is unchanged (docx stays a docx check)", () => {
    expect(ROUTES[".docx"]).toBe(ROUTES[".xlsx"]);
    bad(PDF, ".docx");
  });
});

describe("E20 Wave 2 formats", () => {
  const psd = (version: number) => pad(new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, version]), 64);
  it(".psd: v1 and v2 ok; v3 rejected", () => {
    ok(psd(1), ".psd");
    ok(psd(2), ".psd");
    bad(psd(3), ".psd");
  });

  it("raster: each extension needs its own signature (PNG bytes fail a .jpg write)", () => {
    const png = pad(PNG, 64);
    ok(png, ".png");
    bad(png, ".jpg");
    ok(pad(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 64), ".jpeg");
    ok(pad(bytes("RIFF\0\0\0\0WEBPVP8 "), 64), ".webp");
    ok(pad(new Uint8Array([0x49, 0x49, 0x2a, 0]), 64), ".tif");
    ok(pad(new Uint8Array([0x4d, 0x4d, 0, 0x2a]), 64), ".tiff");
    bad(pad(bytes("RIFF\0\0\0\0WAVE"), 64), ".webp");
  });

  it(".deckcraft: mimetype + presentation.json ok; without presentation.json rejected", () => {
    ok(zip({ mimetype: ["application/vnd.storyteller.deckcraft+zip", 0], "presentation.json": "{}" }), ".deckcraft");
    bad(zip({ mimetype: ["application/vnd.storyteller.deckcraft+zip", 0] }), ".deckcraft");
  });

  it(".vectorcraft (VectorCraft 0.13.1 JSON): format + version ok; other JSON / truncated rejected", () => {
    ok(bytes('{\n  "format": "vectorcraft",\n  "version": 4,\n  "generator": "VectorCraft 0.13.1",\n  "document": {}\n}\n'), ".vectorcraft");
    bad(bytes('{"format": "other", "version": 1}'), ".vectorcraft");
    bad(bytes('{"format": "vectorcraft", "version": 4, "document": {'), ".vectorcraft");
  });
});

describe("E21 SVG script filter", () => {
  const svg = (s: string) => bytes(s);
  it("plain and comment + PI + XML declaration before <svg> → ok", () => {
    ok(svg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/><a href="https://example.com/x">x</a></svg>'), ".svg");
    ok(svg('<?xml version="1.0"?>\n<!-- c --><?pi x?>\n<svg xmlns="http://www.w3.org/2000/svg"><text>a &amp; b</text></svg>'), ".svg");
  });

  it.each([
    ['<!DOCTYPE svg [<!ENTITY x "y">]><svg/>', "DOCTYPE"],
    ['<svg><!ENTITY x "y"></svg>', "ENTITY"],
    ["<svg><script>alert(1)</script></svg>", "script"],
    ['<svg xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg>', "svg:script"],
    ["<svg onload=\"alert(1)\"></svg>", "onload"],
    ['<svg><rect><set attributeName="onmouseover" to="alert(1)"/></rect></svg>', "set on*"],
    ['<svg><a><animate attributeName="href" values="javascript:alert(1)"/></a></svg>', "animate href"],
    ['<svg><a href="&#106;avascript:alert(1)">x</a></svg>', "char-ref javascript"],
    ['<svg><a href=" java\tscript:alert(1)">x</a></svg>', "whitespace javascript"],
    ['<svg><image href="data:text/html;base64,PHNjcmlwdD4="/></svg>', "data:text/html"],
    ["<svg><foreignObject><div/></foreignObject></svg>", "foreignObject"],
    ["<html><svg/></html>", "root html"],
  ])("rejects %s (%s)", (doc) => {
    bad(svg(doc), ".svg");
  });

  it("a <script> after 1 MiB of padding is still rejected (full-document scan)", () => {
    bad(svg(`<svg><desc>${"x".repeat(1024 * 1024 + 10)}</desc><script>alert(1)</script></svg>`), ".svg");
  });
});

describe("P2 SVG validator cost", () => {
  it("a 16 MiB worst-case SVG validates in ≤ 2 s (max of 5 runs)", () => {
    const unit = '<g a="1" b="2" c="&amp;x;" d="3" e="4">';
    const close = "</g>";
    let body = "";
    const depth = 2000;
    body = unit.repeat(depth) + close.repeat(depth);
    let doc = '<svg xmlns="http://www.w3.org/2000/svg">';
    const target = 16 * 1024 * 1024 - 64;
    while (doc.length + body.length < target) doc += body;
    doc += "</svg>";
    const b = bytes(doc);
    let max = 0;
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      expect(validate(b, ".svg").ok).toBe(true);
      max = Math.max(max, performance.now() - t0);
    }
    expect(max).toBeLessThanOrEqual(2000);
  });
});
