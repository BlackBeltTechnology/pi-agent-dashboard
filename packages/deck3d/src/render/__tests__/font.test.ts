import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import { applyOverrides } from "../../ir/merge.js";
import { deriveDeckIR } from "../../parse/derive.js";
import { parseMarkdown } from "../../parse/markdown.js";
import { glyphText } from "../font.js";
import { subsetFontBase64 } from "../index.js";

function fontOf(base64: string) {
  return opentype.parse(new Uint8Array(Buffer.from(base64, "base64")).buffer);
}

describe("font subset", () => {
  it("is deterministic and size grows when a new glyph is needed (E36)", () => {
    const base = subsetFontBase64("Rendszer");
    const again = subsetFontBase64("Rendszer");
    expect(again).toBe(base);
    expect(fontOf(base).hasChar("R")).toBe(true);
    expect(fontOf(base).hasChar("ű")).toBe(false);

    const withU = subsetFontBase64("Rendszerű");
    expect(withU).not.toBe(base);
    expect(fontOf(withU).hasChar("ű")).toBe(true);
    expect(withU.length).toBeGreaterThan(base.length);
  });

  it("derives the glyph set from the merged IR, including override-added labels", async () => {
    const md = "# Réteg\n\n```mermaid\nflowchart LR\n  A[X] --> B[Y]\n```\n";
    const { ir } = await deriveDeckIR(parseMarkdown(md), {
      harvest: async () => ({
        diagram: {
          kind: "flowchart",
          dir: "LR",
          nodes: [
            { id: "A", label: "X", shape: "rect", x: 0, y: 0, w: 10, h: 10 },
            { id: "B", label: "Y", shape: "rect", x: 20, y: 0, w: 10, h: 10 },
          ],
          edges: [],
          groups: [],
        },
      }),
    });
    expect(glyphText(applyOverrides(ir))).not.toContain("Ügyfél");
    ir.overrides.nodes = { "reteg/A": { label: "Ügyfél" } };
    expect(glyphText(applyOverrides(ir))).toContain("Ügyfél");
  });
});
