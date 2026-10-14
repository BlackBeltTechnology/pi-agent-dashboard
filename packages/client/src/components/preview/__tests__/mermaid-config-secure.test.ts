import mermaid from "mermaid";
import { describe, expect, it } from "vitest";
import { mermaidConfig } from "../mermaid-config.js";

// Real mermaid (no mock): pins that a diagram's `%%{init}%%` directive cannot set
// the values mermaid writes into the SVG's document-wide <style>, at any depth
// (mermaid's `sanitize` recurses, so `themeVariables.fontFamily` is covered by the
// `fontFamily` secure key), while harmless theme customization still works.
// See change: sanitize-untrusted-rendered-content (design D5).
describe("mermaidConfig secure keys", () => {
  it("ignores themeCSS/fontFamily directives but keeps other themeVariables", async () => {
    mermaid.initialize(mermaidConfig("dark"));
    const directive = {
      themeCSS: "@import url(//evil.example/x.css)",
      fontFamily: "x;*{display:none}",
      themeVariables: { fontFamily: "EVIL;*{display:none}", primaryColor: "#123456" },
    };
    await mermaid.parse(`%%{init: ${JSON.stringify(directive)}}%%\ngraph TD\nA-->B`);
    const cfg = mermaid.mermaidAPI.getConfig();
    const own = mermaidConfig("dark");
    expect(cfg.themeCSS).toBeUndefined();
    expect(cfg.fontFamily).toBe(own.fontFamily);
    expect(cfg.themeVariables?.fontFamily).toBe(own.themeVariables.fontFamily);
    expect(cfg.themeVariables?.primaryColor).toBe("#123456");
  });
});
