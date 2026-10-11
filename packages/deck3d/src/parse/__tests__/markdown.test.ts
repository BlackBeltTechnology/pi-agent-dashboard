import { describe, expect, it } from "vitest";
import { MarkdownParseError, parseMarkdown } from "../markdown.js";

const DECK = `---
mode: light
quality: medium
depthRelief: 0.9
---

# Ágensrajok

Az autonóm szoftverfejlesztés új korszaka

- Szakosodott ágensek
- Együttműködés

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

# Final {#pin}

<!-- deck3d: {"mode":"dark","scene":"orbits"} -->
`;

describe("parseMarkdown", () => {
  it("parses front-matter deck defaults", () => {
    const deck = parseMarkdown(DECK);
    expect(deck.defaults).toEqual({ mode: "light", quality: "medium", depthRelief: 0.9 });
  });

  it("splits slides, subtitle, bullets, mermaid and inline overrides", () => {
    const deck = parseMarkdown(DECK);
    expect(deck.slides).toHaveLength(2);
    const [first, second] = deck.slides;
    expect(first.id).toBe("agensrajok");
    expect(first.title).toBe("Ágensrajok");
    expect(first.subtitle).toBe("Az autonóm szoftverfejlesztés új korszaka");
    expect(first.bullets).toEqual(["Szakosodott ágensek", "Együttműködés"]);
    expect(first.mermaid).toContain("flowchart LR");
    expect(second.id).toBe("pin");
    expect(second.title).toBe("Final");
    expect(second.inlineOverrides).toEqual({ mode: "dark", scene: "orbits" });
  });

  it("yields one `slide` for a zero-heading document (E4)", () => {
    const deck = parseMarkdown("hello\n- a\n- b");
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].id).toBe("slide");
    expect(deck.slides[0].bullets).toEqual(["a", "b"]);
  });

  it("throws naming the slide on invalid inline JSON (E43)", () => {
    const bad = "# Intro\n\n<!-- deck3d: {mode: light} -->\n";
    expect(() => parseMarkdown(bad)).toThrowError(MarkdownParseError);
    try {
      parseMarkdown(bad);
    } catch (err) {
      expect((err as Error).message).toContain('slide "intro"');
      expect((err as Error).message).toContain("invalid inline JSON");
    }
  });
});

// deck3d-pptx-import D10: override comments never become subtitle/bullet text.
describe("inline override spans", () => {
  const noComment = (s: string | undefined) => expect(s ?? "").not.toContain("<!--");

  it("single-line override directly under the heading is not the subtitle (E1)", () => {
    const deck = parseMarkdown('# {#s02}\n<!-- deck3d: {"mode":"light"} -->\n');
    const s = deck.slides[0];
    expect(s.id).toBe("s02");
    expect(s.subtitle).toBeUndefined();
    expect(s.inlineOverrides).toEqual({ mode: "light" });
  });

  it("multi-line override is recorded; the next paragraph is the subtitle (E2)", () => {
    const deck = parseMarkdown('# Intro\n\n<!-- deck3d: {\n  "mode": "light"\n} -->\n\nHello\n');
    const s = deck.slides[0];
    expect(s.inlineOverrides).toEqual({ mode: "light" });
    expect(s.subtitle).toBe("Hello");
    noComment(s.subtitle);
    for (const b of s.bullets) noComment(b);
  });

  it("bullet-form override is dropped from bullets and recorded (E3)", () => {
    const deck = parseMarkdown('# Intro\n\n- a\n- <!-- deck3d: {"mode":"dark"} -->\n- b\n');
    const s = deck.slides[0];
    expect(s.bullets).toEqual(["a", "b"]);
    expect(s.inlineOverrides).toEqual({ mode: "dark" });
  });

  it("multi-line override with invalid JSON names the slide and the JSON error (E4)", () => {
    const bad = "# Intro\n\n<!-- deck3d: {\n  mode: light\n} -->\n";
    expect(() => parseMarkdown(bad)).toThrowError(MarkdownParseError);
    try {
      parseMarkdown(bad);
    } catch (err) {
      expect((err as Error).message).toContain('slide "intro"');
      expect((err as Error).message).toMatch(/invalid inline JSON.*JSON|Expected|Unexpected/);
    }
  });
});
