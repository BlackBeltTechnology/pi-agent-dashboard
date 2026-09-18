/**
 * Font subsetting — the embedded Poppins is reduced to the glyphs the merged IR
 * actually renders (titles, bullets, labels, override-added strings), so text
 * added through `overrides` always has glyphs and the HTML stays small.
 *
 * Determinism: opentype.js stamps `head.created`/`head.modified` with the
 * current time on write, so both are zeroed afterwards. Same glyph set ⇒
 * byte-identical subset.
 */

import type { Font, Glyph } from "opentype.js";
import opentype from "opentype.js";
import type { MergedDeck } from "../ir/types.js";

/** Every string the runtime can render, across all slides. */
export function glyphText(merged: MergedDeck): string {
  const out: string[] = [];
  for (const s of merged.slides) {
    out.push(s.title);
    if (s.subtitle) out.push(s.subtitle);
    out.push(...s.bullets);
    out.push(...diagramText(s));
  }
  return out.join("");
}

function diagramText(slide: MergedDeck["slides"][number]): string[] {
  const d = slide.diagram;
  const out: string[] = [];
  for (const n of d.nodes ?? []) out.push(n.label);
  for (const e of d.edges ?? []) if (e.label) out.push(e.label);
  for (const a of d.actors ?? []) out.push(a.label);
  for (const m of d.messages ?? []) out.push(m.text);
  for (const g of d.groups ?? []) out.push(g.title);
  return out;
}

/** Build a TTF containing only `text`'s code points (plus `.notdef`/space). */
export function subsetFont(font: Font, text: string): ArrayBuffer {
  const wanted = new Set<number>([32]);
  for (const ch of text) wanted.add(ch.codePointAt(0) ?? 0);
  const glyphs: Glyph[] = [];
  const seen = new Set<number>();
  const notdef = font.glyphs.get(0);
  glyphs.push(new opentype.Glyph({ name: notdef.name ?? ".notdef", unicode: 0, advanceWidth: notdef.advanceWidth, path: notdef.path }));
  seen.add(0);
  for (const code of wanted) {
    const g = font.charToGlyph(String.fromCodePoint(code));
    if (!g || g.index === 0 || seen.has(g.index)) continue;
    seen.add(g.index);
    glyphs.push(new opentype.Glyph({ name: g.name ?? undefined, unicode: code, advanceWidth: g.advanceWidth, path: g.path }));
  }
  const subset = new opentype.Font({
    familyName: font.names.fontFamily?.en ?? "Poppins",
    styleName: font.names.fontSubfamily?.en ?? "Bold",
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    glyphs,
  });
  return freezeHeadDates(subset.toArrayBuffer());
}

/** Zero `head.created`/`head.modified` so the bytes do not depend on the clock. */
export function freezeHeadDates(buffer: ArrayBuffer): ArrayBuffer {
  const view = new DataView(buffer);
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));
    if (tag !== "head") continue;
    const headOffset = view.getUint32(rec + 8);
    // head: version(4) fontRevision(4) checkSumAdjustment(4) magicNumber(4) flags(2)
    // unitsPerEm(2) → created at +20 (8 B) and modified at +28 (8 B).
    for (let b = 0; b < 16; b++) view.setUint8(headOffset + 20 + b, 0);
    break;
  }
  return buffer;
}
