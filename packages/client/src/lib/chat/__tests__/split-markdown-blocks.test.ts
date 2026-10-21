/**
 * Parser-based block split (design D4 step 2): boundaries come from the markdown
 * parser, so constructs a blank-line regex would mis-split stay whole, and a
 * completed block's string is stable as the tail grows (its memo holds).
 * See change: add-fluid-chat-motion.
 */
import { describe, expect, it } from "vitest";
import { splitTopLevelBlocks } from "../split-markdown-blocks.js";

const join = (blocks: string[]) => blocks.join("");

describe("splitTopLevelBlocks", () => {
  it("is lossless: the blocks re-join to the exact input", () => {
    const text = "# Title\n\nIntro paragraph.\n\n- a\n- b\n\n```ts\nconst x = 1;\n\nconst y = 2;\n```\n\nTail";
    expect(join(splitTopLevelBlocks(text))).toBe(text);
  });

  it("splits paragraphs, headings, lists and fences at top level", () => {
    const blocks = splitTopLevelBlocks("# H\n\npara one\n\n- a\n- b\n\n```js\nx\n```\n\nlast");
    expect(blocks).toHaveLength(5);
    expect(blocks[0]).toContain("# H");
    expect(blocks[3]).toContain("```js");
  });

  it("never splits inside a fenced code block that contains blank lines", () => {
    const blocks = splitTopLevelBlocks("```ts\na\n\n\nb\n```\n\nafter");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("a\n\n\nb");
  });

  it("keeps a loose list, a table and a blockquote each as ONE block", () => {
    const loose = "- one\n\n- two\n\n- three\n\nafter";
    expect(splitTopLevelBlocks(loose)).toHaveLength(2);
    const table = "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nafter";
    expect(splitTopLevelBlocks(table)).toHaveLength(2);
    const quote = "> line one\n>\n> line two\n\nafter";
    expect(splitTopLevelBlocks(quote)).toHaveLength(2);
  });

  it("keeps indented code and an HTML block whole", () => {
    expect(splitTopLevelBlocks("intro\n\n    code line 1\n\n    code line 2\n\nafter")).toHaveLength(3);
    expect(splitTopLevelBlocks("<div>\n\n<b>x</b>\n\n</div>\n\nafter").join("")).toContain("<b>x</b>");
  });

  it("completed blocks are byte-stable while the last block grows (memo holds)", () => {
    const steps = ["First paragraph.\n\nSecond", "First paragraph.\n\nSecond para", "First paragraph.\n\nSecond paragraph.\n\nThird"];
    const firsts = steps.map((s) => splitTopLevelBlocks(s)[0]);
    expect(new Set(firsts).size).toBe(1);
    const second = steps.slice(1).map((s) => splitTopLevelBlocks(s)[1]);
    expect(second[1]).toBe("Second paragraph.\n\n");
  });

  it("returns [] for empty text and a single element for one block", () => {
    expect(splitTopLevelBlocks("")).toEqual([]);
    expect(splitTopLevelBlocks("just one paragraph")).toEqual(["just one paragraph"]);
  });
});
