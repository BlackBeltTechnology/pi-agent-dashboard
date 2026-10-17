import { describe, expect, it } from "vitest";
import { repairMarkdown } from "../preview/markup-repair-md.js";

describe("repairMarkdown", () => {
  it("E1: replaces a mismatched-char closer (``` opened, ~~~ found)", () => {
    const r = repairMarkdown("```js\na\n~~~\ntext\n");
    expect(r.source).toBe("```js\na\n```\ntext\n");
    expect(r.repairs).toEqual([{ rule: "M2", line: 1 }]);
  });

  it("E2: replaces a shorter closer of the same char", () => {
    const r = repairMarkdown("````\na\n```\ntext\n");
    expect(r.source).toBe("````\na\n````\ntext\n");
    expect(r.repairs).toEqual([{ rule: "M2", line: 1 }]);
  });

  it("E3: a too-short fence line is not an M2 closer; M3 inserts before the blank line", () => {
    const r = repairMarkdown("```\na\n~~\n\n# H\n");
    expect(r.source).toBe("```\na\n~~\n```\n\n# H\n");
    expect(r.repairs).toEqual([{ rule: "M3", line: 1 }]);
  });

  it("E4: M3 inserts a closer before the blank line preceding a heading", () => {
    const r = repairMarkdown("```sh\necho\n\n# Heading\nbody\n");
    expect(r.source).toBe("```sh\necho\n```\n\n# Heading\nbody\n");
    expect(r.repairs).toEqual([{ rule: "M3", line: 1 }]);
  });

  it("E5: a heading-looking line not preceded by a blank line is left alone", () => {
    const src = "```sh\n# comment\necho\n";
    const r = repairMarkdown(src);
    expect(r.repairs).toEqual([]);
    expect(r.source).toBe(src);
  });

  it("E6: a properly closed fence documenting a fence is untouched", () => {
    const src = "````md\n```\n````\n";
    const r = repairMarkdown(src);
    expect(r.repairs).toEqual([]);
    expect(r.source).toBe(src);
  });

  it("E7: fence-like lines in YAML frontmatter are not fences", () => {
    const src = "---\nx: |\n  ```\n---\n# T\n";
    const r = repairMarkdown(src);
    expect(r.repairs).toEqual([]);
    expect(r.source).toBe(src);
  });

  it("E8: unterminated fences in a blockquote or list item are not repaired", () => {
    for (const src of ["> ```sh\n> echo\n\n# Heading\n", "- item\n\n  ```sh\n  echo\n\n# Heading\n"]) {
      const r = repairMarkdown(src);
      expect(r.repairs).toEqual([]);
      expect(r.source).toBe(src);
    }
  });

  it("E9: two unterminated fences repair with original line numbers; second run is a no-op", () => {
    // Fence 1 closes via M3 before "# One"; the text after is re-parsed, so fence 2 opens there.
    const src = "```a\nx\n\n# One\n\ntext\n```b\ny\n\n# Two\n";
    const r = repairMarkdown(src);
    expect(r.repairs).toEqual([
      { rule: "M3", line: 1 },
      { rule: "M3", line: 7 },
    ]);
    expect(r.source).toBe("```a\nx\n```\n\n# One\n\ntext\n```b\ny\n```\n\n# Two\n");
    const again = repairMarkdown(r.source);
    expect(again.repairs).toEqual([]);
    expect(again.source).toBe(r.source);
  });

  it("E10: CRLF — inserted closer takes the opener's terminator, other lines are byte-identical", () => {
    const crlf = repairMarkdown("```sh\r\necho\r\n\r\n# Heading\r\nbody\r\n");
    expect(crlf.source).toBe("```sh\r\necho\r\n```\r\n\r\n# Heading\r\nbody\r\n");
    const mixed = repairMarkdown("```sh\r\necho\n\n# Heading\nbody\n");
    expect(mixed.source).toBe("```sh\r\necho\n```\r\n\n# Heading\nbody\n");
    const replaced = repairMarkdown("```js\r\na\n~~~\ntext\n");
    expect(replaced.source).toBe("```js\r\na\n```\ntext\n");
  });

  it("E12: a fence opener on the last line without a trailing newline is not repaired", () => {
    const src = "text\n```mermaid";
    const r = repairMarkdown(src);
    expect(r.repairs).toEqual([]);
    expect(r.source).toBe(src);
  });

  it("no fences at all is a fast no-op", () => {
    const src = "# Title\n\nbody\n";
    expect(repairMarkdown(src)).toEqual({ source: src, repairs: [] });
  });

  it("preserves the opener's indentation (≤3) in the closer", () => {
    const r = repairMarkdown("  ```sh\n  echo\n\n# H\n");
    expect(r.source).toBe("  ```sh\n  echo\n  ```\n\n# H\n");
  });
});
