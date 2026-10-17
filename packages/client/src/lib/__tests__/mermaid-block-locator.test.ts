/**
 * Pure locate/verify/splice tests for "Apply fix to file".
 * See change: add-preview-apply-fix-to-file (test-plan E1–E10, E13–E16).
 */
import { describe, expect, it } from "vitest";
import { locateMermaidBlock, spliceMermaidBlock, verifyMermaidBlock } from "../preview/mermaid-block-locator.js";

const FIXED = "graph TD\n  A --> B";

describe("md — fence replaced in place (E1)", () => {
  const file = [
    "# T",
    "```mermaid",
    "graph TD",
    "  X-->Y",
    "```",
    "```js",
    "const a = 1;",
    "```",
    "text",
    "```mermaid",
    "OLD1",
    "```",
    "```mermaid",
    "OLD2",
    "```",
    "",
  ].join("\n");

  it("changes only the lines between fence #1's opener and closer", () => {
    const out = spliceMermaidBlock(file, "md", 1, FIXED);
    const expected = file.replace("OLD1", FIXED);
    expect(out).toBe(expected);
    expect(out).toContain("OLD2");
    expect(out).toContain("X-->Y");
  });

  it("counts only mermaid fences (not the js fence)", () => {
    const loc = locateMermaidBlock(file, "md", 2);
    expect(loc.ok && loc.count).toBe(3);
    expect(loc.ok && loc.value).toBe("OLD2");
  });

  it("reports not-found past the last ordinal", () => {
    expect(locateMermaidBlock(file, "md", 3)).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("md — indented fence in a list (E2)", () => {
  it("re-applies the indent to non-blank lines, keeps blanks empty", () => {
    const file = "1. item\n\n   ```mermaid\n   graph TD\n\n   A-->B\n   ```\n";
    const out = spliceMermaidBlock(file, "md", 0, "flowchart TD\n\n  A --> B");
    expect(out).toBe("1. item\n\n   ```mermaid\n   flowchart TD\n\n     A --> B\n   ```\n");
  });
});

describe("md — fence variants (E3)", () => {
  const file = "~~~mermaid\nOLD0\n~~~\n\n````mermaid\nline\n```\nmore\n````\n";
  it("locates a tilde fence and a 4-backtick fence containing a 3-backtick line", () => {
    const l0 = locateMermaidBlock(file, "md", 0);
    expect(l0.ok && l0.value).toBe("OLD0");
    const l1 = locateMermaidBlock(file, "md", 1);
    expect(l1.ok && l1.value).toBe("line\n```\nmore");
  });
  it("preserves the tilde closer and the 4-backtick closer on splice", () => {
    expect(spliceMermaidBlock(file, "md", 0, "NEW")).toBe(file.replace("OLD0", "NEW"));
    expect(spliceMermaidBlock(file, "md", 1, "NEW")).toBe(file.replace("line\n```\nmore", "NEW"));
  });
  it("refuses a fix whose line would close the fence early", () => {
    expect(spliceMermaidBlock(file, "md", 1, "a\n````\nb")).toBeNull();
  });
});

describe("md — CRLF (E4)", () => {
  it("writes the block with CRLF and no bare LF", () => {
    const file = "# T\r\n```mermaid\r\nOLD\r\n```\r\ntail\r\n";
    const out = spliceMermaidBlock(file, "md", 0, "a\nb\nc") as string;
    expect(out).toBe("# T\r\n```mermaid\r\na\r\nb\r\nc\r\n```\r\ntail\r\n");
    expect(/(?<!\r)\n/.test(out)).toBe(false);
  });
});

describe("round-trip invariant (E5)", () => {
  const md = "---\ntitle: x\n---\n\n```mermaid\ngraph TD\n```\n\n- a\n\n  ```mermaid\n  A-->B\n  ```\n";
  const adoc = "= T\n\n[source,mermaid]\n----\ngraph TD\n  A-->B\n----\n\nafter\n";
  const cases: Array<[string, "md" | "adoc" | "mmd", string, number]> = [
    ["md", "md", md, 0],
    ["md#1", "md", md, 1],
    ["md CRLF", "md", md.replace(/\n/g, "\r\n"), 0],
    ["md BOM", "md", `\uFEFF${md}`, 0],
    ["md no final newline", "md", "```mermaid\nA-->B\n```", 0],
    ["adoc", "adoc", adoc, 0],
    ["adoc CRLF", "adoc", adoc.replace(/\n/g, "\r\n"), 0],
    ["mmd", "mmd", "graph TD\n  A-->B\n", 0],
    ["mmd BOM", "mmd", "\uFEFFgraph TD\n", 0],
    ["mmd CRLF no final newline", "mmd", "graph TD\r\n  A-->B", 0],
  ];
  for (const [name, kind, file, n] of cases) {
    it(name, () => {
      const loc = locateMermaidBlock(file, kind, n);
      expect(loc.ok).toBe(true);
      if (!loc.ok) return;
      expect(spliceMermaidBlock(file, kind, n, loc.value)).toBe(file);
    });
  }
});

describe("md — duplicate diagrams (E6)", () => {
  it("replaces only the second of two identical blocks", () => {
    const file = "```mermaid\nBAD\n```\n\n```mermaid\nBAD\n```\n";
    expect(spliceMermaidBlock(file, "md", 1, "GOOD")).toBe("```mermaid\nBAD\n```\n\n```mermaid\nGOOD\n```\n");
  });
});

describe("md — not applicable (E7–E9)", () => {
  it("blockquote fence", () => {
    const file = "> ```mermaid\n> graph TD\n> ```\n";
    expect(locateMermaidBlock(file, "md", 0)).toEqual({ ok: false, reason: "not-applicable" });
  });
  it("fence on a list-marker line", () => {
    const file = "- ```mermaid\n  graph TD\n  ```\n";
    expect(locateMermaidBlock(file, "md", 0)).toEqual({ ok: false, reason: "not-applicable" });
  });
  it("unclosed fence", () => {
    const file = "text\n\n```mermaid\ngraph TD\n  A-->B\n";
    expect(locateMermaidBlock(file, "md", 0)).toEqual({ ok: false, reason: "not-applicable" });
  });
});

describe("md — frontmatter parity (E10)", () => {
  it("ignores a mermaid fence inside YAML frontmatter", () => {
    const file = "---\nnote: |\n  ```mermaid\n  fake\n  ```\n---\n\n```mermaid\nreal\n```\n";
    const loc = locateMermaidBlock(file, "md", 0);
    expect(loc.ok && loc.value).toBe("real");
    expect(loc.ok && loc.count).toBe(1);
  });
});

describe("adoc — source blocks (E13)", () => {
  const file = [
    "= T",
    "",
    "[source,mermaid]",
    "----",
    "OLD0",
    "----",
    "",
    "[source,mermaid,opts=x]",
    "......",
    "OLD1",
    "......",
    "",
  ].join("\n");
  it("changes only lines between each identical delimiter pair", () => {
    expect(spliceMermaidBlock(file, "adoc", 0, "NEW")).toBe(file.replace("OLD0", "NEW"));
    expect(spliceMermaidBlock(file, "adoc", 1, "NEW")).toBe(file.replace("OLD1", "NEW"));
  });
  it("refuses a fix containing the delimiter", () => {
    expect(spliceMermaidBlock(file, "adoc", 0, "a\n----\nb")).toBeNull();
  });
});

describe("adoc — count parity (E14)", () => {
  it("is not applicable when the preview rendered a different count", () => {
    const file = "[source,mermaid]\n----\na\n----\n\n[source,mermaid]\n----\nb\n----\n";
    expect(locateMermaidBlock(file, "adoc", 0, { expectedCount: 3 })).toEqual({ ok: false, reason: "not-applicable" });
    expect(locateMermaidBlock(file, "adoc", 0, { expectedCount: 2 }).ok).toBe(true);
  });
});

describe("adoc — substitution mismatch (E15)", () => {
  it("fails verify when the rendered source lacks the callout", () => {
    const file = "[source,mermaid]\n----\ngraph TD\n  A-->B <1>\n----\n";
    const loc = locateMermaidBlock(file, "adoc", 0);
    expect(loc.ok).toBe(true);
    if (!loc.ok) return;
    expect(verifyMermaidBlock(loc, "graph TD\n  A-->B")).toBe(false);
    expect(verifyMermaidBlock(loc, "graph TD\n  A-->B <1>")).toBe(true);
  });
});

describe("mmd — whole file (E16)", () => {
  it("keeps final newline presence, BOM and line endings", () => {
    expect(spliceMermaidBlock("graph TD\nOLD\n", "mmd", 0, "A\nB")).toBe("A\nB\n");
    expect(spliceMermaidBlock("graph TD\nOLD", "mmd", 0, "A\nB")).toBe("A\nB");
    expect(spliceMermaidBlock("\uFEFFgraph TD\n", "mmd", 0, "A\nB")).toBe("\uFEFFA\nB\n");
    expect(spliceMermaidBlock("graph TD\r\nOLD\r\n", "mmd", 0, "A\nB")).toBe("A\r\nB\r\n");
  });
  it("verify is identity and ordinal ≠ 0 is not found", () => {
    const loc = locateMermaidBlock("\uFEFFgraph TD\n", "mmd", 0);
    expect(loc.ok && verifyMermaidBlock(loc, "graph TD\n")).toBe(true);
    expect(loc.ok && verifyMermaidBlock(loc, "\uFEFFgraph TD\n")).toBe(true); // viewer text may keep the BOM
    expect(locateMermaidBlock("graph TD\n", "mmd", 1)).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("md — verify with entities (E12 locator side)", () => {
  it("located value is the literal fenced text", () => {
    const body = "A -->|a &gt; b &amp; c| B\nA --> B<br>C";
    const file = `\`\`\`mermaid\n${body}\n\`\`\`\n`;
    const loc = locateMermaidBlock(file, "md", 0);
    expect(loc.ok && verifyMermaidBlock(loc, body)).toBe(true);
  });
});
