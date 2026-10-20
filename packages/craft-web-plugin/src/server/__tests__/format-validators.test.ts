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
