import { describe, expect, it } from "vitest";
import { repairAsciiDoc } from "../markup-repair/asciidoc.js";

describe("repairAsciiDoc — A1 bare mermaid style", () => {
  it.each([
    ["[mermaid]\n----\ngraph TD\n----\n", "[source,mermaid]\n----\ngraph TD\n----\n"],
    ["[mermaid]\n....\ngraph TD\n....\n", "[source,mermaid]\n....\ngraph TD\n....\n"],
    [
      "[mermaid,format=svg]\n----\ngraph TD\n----\n",
      "[source,mermaid,format=svg]\n----\ngraph TD\n----\n",
    ],
    [".Title\n[mermaid]\n----\ng\n----\n", ".Title\n[source,mermaid]\n----\ng\n----\n"],
    ["[mermaid]\n.Title\n----\ng\n----\n", "[source,mermaid]\n.Title\n----\ng\n----\n"],
  ])("E13 rewrites %j", (input, expected) => {
    const r = repairAsciiDoc(input);
    expect(r.source).toBe(expected);
    const line = input.split("\n").findIndex((l) => l.startsWith("[mermaid")) + 1;
    expect(r.repairs).toEqual([{ rule: "A1", line }]);
  });

  it("E14 leaves a paragraph style and an existing source block alone", () => {
    for (const src of [
      "[mermaid]\nsome paragraph\n",
      "[source,mermaid]\n----\ng\n----\n",
      "[mermaid]\n\n----\ng\n----\n",
    ]) {
      const r = repairAsciiDoc(src);
      expect(r.repairs).toEqual([]);
      expect(r.source).toBe(src);
    }
  });

  it("does not rewrite a [mermaid] line inside a verbatim block", () => {
    const src = "----\n[mermaid]\n----\nfoo\n----\n";
    // first block closes at line 3; `[mermaid]` is inside it
    expect(repairAsciiDoc(src).repairs).toEqual([]);
  });
});

describe("repairAsciiDoc — A2 unterminated listing/literal", () => {
  it("E15 replaces a different-length delimiter with the exact opener", () => {
    const r = repairAsciiDoc("----\ncode\n-----\nafter\n");
    expect(r.source).toBe("----\ncode\n----\nafter\n");
    expect(r.repairs).toEqual([{ rule: "A2", line: 1 }]);
  });

  it("E15 also handles literal blocks", () => {
    const r = repairAsciiDoc("....\ncode\n.....\nafter\n");
    expect(r.source).toBe("....\ncode\n....\nafter\n");
    expect(r.repairs).toEqual([{ rule: "A2", line: 1 }]);
  });

  it("E27 only replaces a different-length delimiter before the next section; a later closed sibling is not hijacked", () => {
    const r = repairAsciiDoc("----\ncode\n\n== Next\n\n------\nb\n------\n");
    expect(r.source).toBe("----\ncode\n----\n\n== Next\n\n------\nb\n------\n");
    expect(r.repairs).toEqual([{ rule: "A2", line: 1 }]);
    expect(repairAsciiDoc(r.source).repairs).toEqual([]);
  });

  it("E16 inserts a closer before the blank line preceding a section title", () => {
    const r = repairAsciiDoc("----\ncode\n\n== Next\n");
    expect(r.source).toBe("----\ncode\n----\n\n== Next\n");
    expect(r.repairs).toEqual([{ rule: "A2", line: 1 }]);
  });

  it("E17 applies no repair where it must not", () => {
    const cases = [
      "----\ncode\n",
      "====\n----\ncode\n\n== Next\n====\n",
      "--\n----\ncode\n\n== Next\n--\n",
      "* item\n+\n----\ncode\n\n== Next\n",
      "----\na\n----\n\n------\nb\n------\n",
      "----\nfoo\n----\n\n== Next\n",
    ];
    for (const src of cases) {
      const r = repairAsciiDoc(src);
      expect(r.repairs).toEqual([]);
      expect(r.source).toBe(src);
    }
  });

  it("repairs two blocks and reports original line numbers", () => {
    const src = "----\na\n\n== One\n\n....\nb\n\n== Two\n";
    const r = repairAsciiDoc(src);
    expect(r.source).toBe("----\na\n----\n\n== One\n\n....\nb\n....\n\n== Two\n");
    expect(r.repairs).toEqual([
      { rule: "A2", line: 1 },
      { rule: "A2", line: 6 },
    ]);
  });

  it("keeps CRLF terminators per line", () => {
    const r = repairAsciiDoc("----\r\ncode\r\n\r\n== Next\r\n");
    expect(r.source).toBe("----\r\ncode\r\n----\r\n\r\n== Next\r\n");
    const r2 = repairAsciiDoc("----\r\ncode\n-----\nafter\n");
    expect(r2.source).toBe("----\r\ncode\n----\nafter\n");
  });

  it("is idempotent", () => {
    const first = repairAsciiDoc("[mermaid]\n----\ng\n\n== Next\n");
    expect(first.repairs.map((x) => x.rule)).toEqual(["A1", "A2"]);
    const second = repairAsciiDoc(first.source);
    expect(second.repairs).toEqual([]);
    expect(second.source).toBe(first.source);
  });
});

describe("repairAsciiDoc — security", () => {
  it("E18 never introduces passthrough, pass:, include:: or attribute lines", () => {
    const fixtures = [
      "[mermaid]\n----\ng\n----\n",
      "----\ncode\n-----\nafter\n",
      "----\ncode\n\n== Next\n",
      "[mermaid]\n----\ng\ninclude::/etc/passwd[]\n\n== Next\n",
    ];
    for (const src of fixtures) {
      const out = repairAsciiDoc(src).source;
      const inLines = new Set(src.split("\n"));
      for (const line of out.split("\n")) {
        if (inLines.has(line)) continue;
        expect(line).not.toMatch(/^\+{3,}$/);
        expect(line).not.toMatch(/pass:/);
        expect(line).not.toMatch(/include::/);
        expect(line).not.toMatch(/^:[\w-]+:/);
      }
    }
  });
});
