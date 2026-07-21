import { describe, it, expect } from "vitest";
import { wrapAsciiTables } from "../preview/wrap-ascii-tables.js";

describe("wrapAsciiTables", () => {
  it("should return content unchanged when no ASCII tables", () => {
    const content = "Hello world\n\nSome **markdown** text.";
    expect(wrapAsciiTables(content)).toBe(content);
  });

  it("should wrap box-drawing table in code fences", () => {
    const content = [
      "Here is a table:",
      "┌──────┬──────┐",
      "│ Name │ Type │",
      "├──────┼──────┤",
      "│ foo  │ str  │",
      "└──────┴──────┘",
      "End of table.",
    ].join("\n");

    const result = wrapAsciiTables(content);
    expect(result).toContain("```");
    expect(result).toContain("┌──────┬──────┐");
    expect(result).toContain("└──────┴──────┘");
    // Normal text should not be inside fences
    expect(result.indexOf("Here is a table:")).toBeLessThan(result.indexOf("```"));
  });

  it("should wrap plain ASCII table with +---+ pattern", () => {
    const content = [
      "+------+------+",
      "| Name | Type |",
      "+------+------+",
      "| foo  | str  |",
      "+------+------+",
    ].join("\n");

    const result = wrapAsciiTables(content);
    expect(result).toContain("```");
    expect(result).toContain("+------+------+");
  });

  it("should not wrap a single box-drawing line", () => {
    const content = "Some text\n────────────\nMore text";
    expect(wrapAsciiTables(content)).toBe(content);
  });

  it("should not wrap standard markdown pipe tables", () => {
    const content = [
      "| Name | Type |",
      "| --- | --- |",
      "| foo | str |",
    ].join("\n");

    // These should NOT be wrapped — remarkGfm handles them
    expect(wrapAsciiTables(content)).toBe(content);
  });

  it("should not double-wrap content already inside code fences", () => {
    const content = [
      "```",
      "┌──────┬──────┐",
      "│ Name │ Type │",
      "└──────┴──────┘",
      "```",
    ].join("\n");

    const result = wrapAsciiTables(content);
    // Should have exactly one pair of fences (the original)
    const fenceCount = (result.match(/```/g) || []).length;
    expect(fenceCount).toBe(2);
  });

  it("should not double-wrap content inside tilde fences", () => {
    const content = [
      "~~~",
      "┌──────┬──────┐",
      "│ Name │ Type │",
      "└──────┴──────┘",
      "~~~",
    ].join("\n");

    const result = wrapAsciiTables(content);
    const fenceCount = (result.match(/~~~/g) || []).length;
    expect(fenceCount).toBe(2);
  });

  it("should handle multiple ASCII table blocks", () => {
    const content = [
      "Table 1:",
      "┌───┬───┐",
      "│ A │ B │",
      "└───┴───┘",
      "Some text between.",
      "Table 2:",
      "┌───┬───┐",
      "│ C │ D │",
      "└───┴───┘",
    ].join("\n");

    const result = wrapAsciiTables(content);
    const fenceCount = (result.match(/```/g) || []).length;
    expect(fenceCount).toBe(4); // 2 pairs for 2 tables
  });

  it("should handle heavy box-drawing characters", () => {
    const content = [
      "┏━━━━━┳━━━━━┓",
      "┃ Key ┃ Val ┃",
      "┗━━━━━┻━━━━━┛",
    ].join("\n");

    const result = wrapAsciiTables(content);
    expect(result).toContain("```");
  });

  it("should handle double-line box-drawing characters", () => {
    const content = [
      "╔═════╦═════╗",
      "║ Key ║ Val ║",
      "╚═════╩═════╝",
    ].join("\n");

    const result = wrapAsciiTables(content);
    expect(result).toContain("```");
  });

  it("should include labels above side-by-side horizontal tables", () => {
    const content = [
      "Current:              Proposed:",
      "┌───┬───┐             ┌───┬───┐",
      "│ A │ B │     →       │ X │ Y │",
      "└───┴───┘             └───┴───┘",
    ].join("\n");

    const result = wrapAsciiTables(content);
    expect(result).toContain("```");
    // Label line should be inside the code fence
    expect(result).toBe(
      ["```", ...content.split("\n"), "```"].join("\n")
    );
  });

  it("should include annotations below table", () => {
    const content = [
      "┌──────┬──────┐",
      "│ Key  │ Val  │",
      "└──────┴──────┘",
      "   ↑ primary key",
    ].join("\n");

    const result = wrapAsciiTables(content);
    // Annotation with 3+ spaces should be inside the fence
    expect(result).toBe(
      ["```", ...content.split("\n"), "```"].join("\n")
    );
  });

  it("should include header above table", () => {
    const content = [
      "  Column A    Column B",
      "┌──────────┬──────────┐",
      "│ value 1  │ value 2  │",
      "└──────────┴──────────┘",
    ].join("\n");

    const result = wrapAsciiTables(content);
    expect(result).toBe(
      ["```", ...content.split("\n"), "```"].join("\n")
    );
  });

  it("should handle three horizontal tables with labels", () => {
    const content = [
      "Table 1:          Table 2:          Table 3:",
      "┌───┬───┐         ┌───┬───┐         ┌───┬───┐",
      "│ A │ B │         │ C │ D │         │ E │ F │",
      "└───┴───┘         └───┴───┘         └───┴───┘",
    ].join("\n");

    const result = wrapAsciiTables(content);
    expect(result).toBe(
      ["```", ...content.split("\n"), "```"].join("\n")
    );
  });

  it("should include annotation line sandwiched between table lines", () => {
    const content = [
      "┌───┬───┐             ┌───┬───┐",
      "│ A │ B │     →       │ X │ Y │",
      "└───┴───┘             └───┴───┘",
    ].join("\n");

    const result = wrapAsciiTables(content);
    expect(result).toContain("```");
    expect(result).toContain("→");
  });

  it("should preserve surrounding content exactly", () => {
    const content = [
      "Before text.",
      "",
      "┌───┬───┐",
      "│ A │ B │",
      "└───┴───┘",
      "",
      "After text.",
    ].join("\n");

    const result = wrapAsciiTables(content);
    expect(result).toMatch(/^Before text\./);
    expect(result).toMatch(/After text\.$/);
  });
});
