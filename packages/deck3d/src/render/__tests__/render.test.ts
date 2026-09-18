import { describe, expect, it } from "vitest";
import { deriveDeckIR } from "../../parse/derive.js";
import { parseMarkdown } from "../../parse/markdown.js";
import { ensureRuntime, renderDeck } from "../index.js";

const MD = `# Cím

Bemutató.

- egy
- kettő
`;

async function deck() {
  const { ir } = await deriveDeckIR(parseMarkdown(MD));
  return ir;
}

describe("renderDeck", () => {
  it("is byte-identical for the same IR (determinism)", async () => {
    const ir = await deck();
    const a = renderDeck(ir, { runtime: "/*runtime*/", font: "FONT" });
    const b = renderDeck(ir, { runtime: "/*runtime*/", font: "FONT" });
    expect(a).toBe(b);
  });

  it("inlines the canonical IR and escapes < so a label cannot break the script", async () => {
    const ir = await deck();
    ir.slides[0].title = "</script><b>x\u2028y";
    const html = renderDeck(ir, { runtime: "/*rt*/", font: "FONT" });
    expect(html).not.toContain("</script><b>");
    expect(html).toContain("\\u003c/script>");
    // The JSON payload is inside the first script tag and parses back.
    const payload = html.split("window.__DECK=")[1].split(";window.__DECK_FONT=")[0];
    expect(JSON.parse(payload).slides[0].title).toBe("</script><b>x\u2028y");
  });

  it("references no diagram engine and no external resource URLs", async () => {
    const html = renderDeck(await deck(), { runtime: "/*rt*/", font: "FONT" });
    expect(html).not.toMatch(/mermaid/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
  });

  it("embeds the real runtime flat-refresh as one inline script (no imports)", async () => {
    const runtime = await ensureRuntime();
    expect(runtime.length).toBeGreaterThan(1000);
    expect(runtime).not.toMatch(/^\s*import\s/m);
    const html = renderDeck(await deck(), { runtime, font: "FONT" });
    expect(html).toContain("window.__deck3d");
  });
});
