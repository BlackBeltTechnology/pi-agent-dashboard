/**
 * E18 — OOXML validator (worker module). Only a zip package declaring AND containing the target kind's
 * main document part is accepted. See change: edit-office-in-pane-with-craft-web (D5, task 4.4).
 */
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { validate } from "../validators/ooxml.mjs";

const MAIN = {
  ".docx": ["/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"],
  ".xlsx": ["/xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"],
  ".pptx": ["/ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"],
} as const;

const contentTypes = (ext: keyof typeof MAIN, prefix = ""): string =>
  `<?xml version="1.0"?><${prefix}Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="${MAIN[ext][0]}" ContentType="${MAIN[ext][1]}"/></${prefix}Types>`;

function pkg(ext: keyof typeof MAIN, o: { types?: string; skipMain?: boolean; level?: 0 | 6; extra?: Record<string, Uint8Array> } = {}): Uint8Array {
  const files: Record<string, Uint8Array> = { "[Content_Types].xml": strToU8(o.types ?? contentTypes(ext)), ...(o.extra ?? {}) };
  if (!o.skipMain) files[MAIN[ext][0].slice(1)] = strToU8("<doc/>");
  return zipSync(Object.fromEntries(Object.entries(files).map(([n, b]) => [n, [b, { level: o.level ?? 6 }]])) as never);
}

describe("ooxml-validator (E18)", () => {
  it("accepts a valid package per kind (deflated and stored)", () => {
    for (const ext of [".docx", ".xlsx", ".pptx"] as const) {
      expect(validate(pkg(ext), ext)).toEqual({ ok: true });
      expect(validate(pkg(ext, { level: 0 }), ext)).toEqual({ ok: true });
    }
  });

  it("accepts single-quoted attributes and a namespace-prefixed Override", () => {
    const types = `<Types><x:Override ContentType='${MAIN[".docx"][1]}' PartName='/word/document.xml'/></Types>`;
    expect(validate(pkg(".docx", { types }), ".docx")).toEqual({ ok: true });
  });

  it("rejects a spreadsheet package sent as .docx", () => {
    const r = validate(pkg(".xlsx"), ".docx");
    expect(r.ok).toBe(false);
  });

  it("rejects non-zip bytes, empty bytes and an unsupported extension", () => {
    expect(validate(new Uint8Array(Buffer.from("plain text, not a zip at all")), ".docx").ok).toBe(false);
    expect(validate(new Uint8Array(0), ".docx").ok).toBe(false);
    expect(validate(pkg(".docx"), ".pdf").ok).toBe(false);
  });

  it("rejects a DOCTYPE / ENTITY in the content types and never expands entities", () => {
    for (const decl of ['<!DOCTYPE Types [<!ENTITY x "y">]>', "<!ENTITY a 'b'>", "<!doctype x>"]) {
      const r = validate(pkg(".docx", { types: `${decl}${contentTypes(".docx")}` }), ".docx");
      expect(r.ok).toBe(false);
    }
  });

  it("rejects a package whose Override main part is missing from the archive", () => {
    expect(validate(pkg(".docx", { skipMain: true }), ".docx").ok).toBe(false);
  });

  it("rejects a package with no [Content_Types].xml, or no main Override", () => {
    expect(validate(zipSync({ "word/document.xml": strToU8("<doc/>") }), ".docx").ok).toBe(false);
    expect(validate(pkg(".docx", { types: '<Types><Default Extension="xml" ContentType="application/xml"/></Types>' }), ".docx").ok).toBe(false);
  });

  it("rejects 10,001 entries and accepts exactly 10,000", () => {
    const many = (n: number): Record<string, Uint8Array> => {
      const extra: Record<string, Uint8Array> = {};
      for (let i = 0; i < n; i++) extra[`p/${i}.bin`] = new Uint8Array(0);
      return extra;
    };
    // 2 base entries (types + main) + filler
    expect(validate(pkg(".docx", { extra: many(9_998), level: 0 }), ".docx")).toEqual({ ok: true });
    const over = validate(pkg(".docx", { extra: many(9_999), level: 0 }), ".docx");
    expect(over.ok).toBe(false);
  });

  it("rejects an oversized [Content_Types].xml (declared and inflated)", () => {
    const big = `${contentTypes(".docx")}<!-- ${"a".repeat(1024 * 1024 + 10)} -->`;
    expect(validate(pkg(".docx", { types: big }), ".docx").ok).toBe(false);
  });

  it("rejects a corrupt central directory without throwing", () => {
    const z = Buffer.from(pkg(".docx"));
    z.writeUInt32LE(0xdeadbeef, z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
    expect(validate(new Uint8Array(z), ".docx").ok).toBe(false);
    expect(validate(new Uint8Array(z.subarray(0, z.length - 10)), ".docx").ok).toBe(false);
  });
});
