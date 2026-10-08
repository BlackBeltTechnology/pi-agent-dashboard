import { describe, it, expect } from "vitest";
import { parseSkillBlock, buildSkillBlock, parseSkillCommand } from "../skill-block-parser.js";

describe("parseSkillBlock", () => {
  it("matches a well-formed wrapper with args", () => {
    const text =
      `<skill name="foo" location="/x/SKILL.md">\nReferences are relative to /x.\n\nbody\n</skill>\n\nargs here`;
    const block = parseSkillBlock(text);
    expect(block).not.toBeNull();
    expect(block!.name).toBe("foo");
    expect(block!.location).toBe("/x/SKILL.md");
    expect(block!.body).toBe("body");
    expect(block!.args).toBe("args here");
    expect(block!.condensed).toBe("/skill:foo args here");
  });

  it("strips the 'References are relative to <baseDir>.\\n\\n' preamble from body", () => {
    const text =
      `<skill name="foo" location="/x/SKILL.md">\nReferences are relative to /x.\n\nfirst body line\nsecond body line\n</skill>`;
    const block = parseSkillBlock(text);
    expect(block!.body).toBe("first body line\nsecond body line");
    expect(block!.body.startsWith("References are relative")).toBe(false);
  });

  it("falls back to verbatim content when preamble is absent", () => {
    // Hand-crafted wrapper without the standard preamble (defensive: pi may evolve).
    const text = `<skill name="foo" location="/x">\nbody only\n</skill>`;
    expect(parseSkillBlock(text)!.body).toBe("body only");
  });

  it("matches a wrapper without args (no preamble)", () => {
    const text = `<skill name="foo" location="/x">\nbody\n</skill>`;
    const block = parseSkillBlock(text);
    expect(block).not.toBeNull();
    expect(block!.args).toBeUndefined();
    expect(block!.condensed).toBe("/skill:foo");
    expect(block!.body).toBe("body");
  });

  it("preserves multi-line user args verbatim", () => {
    const text =
      `<skill name="foo" location="/x">\nbody\n</skill>\n\nline1\nline2\nline3`;
    const block = parseSkillBlock(text);
    expect(block!.args).toBe("line1\nline2\nline3");
    expect(block!.condensed).toBe("/skill:foo line1\nline2\nline3");
  });

  it("returns null for plain text", () => {
    expect(parseSkillBlock("Hello, this is just text.")).toBeNull();
    expect(parseSkillBlock("")).toBeNull();
    expect(parseSkillBlock("/skill:foo args (unexpanded)")).toBeNull();
  });

  it("returns null for mid-document <skill> (anchor enforcement)", () => {
    const text = `prefix\n<skill name="foo" location="/x">\nbody\n</skill>`;
    expect(parseSkillBlock(text)).toBeNull();
  });

  it("returns null for trailing whitespace after </skill>", () => {
    // Anchor end-of-string: a stray newline after </skill> with no args fails the optional-args group.
    const text = `<skill name="foo" location="/x">\nbody\n</skill>\n`;
    expect(parseSkillBlock(text)).toBeNull();
  });

  it("does not terminate prematurely on body containing literal <skill> text", () => {
    const text =
      `<skill name="real" location="/x">\nReferences are relative to /x.\n\nDocumented like: <skill name="example">…</skill>\nThat ended.\n</skill>`;
    const block = parseSkillBlock(text);
    expect(block).not.toBeNull();
    expect(block!.name).toBe("real");
    expect(block!.body).toContain('Documented like: <skill name="example">…</skill>');
    expect(block!.body).toContain("That ended.");
    // preamble was stripped — body starts with the user-visible content
    expect(block!.body.startsWith("Documented")).toBe(true);
  });

  it("handles an empty body (no preamble)", () => {
    const text = `<skill name="empty" location="/x">\n\n</skill>`;
    const block = parseSkillBlock(text);
    expect(block).not.toBeNull();
    expect(block!.body).toBe("");
  });

  it("condensed form has a single space between name and args", () => {
    const text = `<skill name="x" location="/p">\nb\n</skill>\n\nfoo`;
    expect(parseSkillBlock(text)!.condensed).toBe("/skill:x foo");
  });

  it("condensed form has no trailing space when args is absent", () => {
    const text = `<skill name="x" location="/p">\nb\n</skill>`;
    expect(parseSkillBlock(text)!.condensed).toBe("/skill:x");
  });
});

describe("buildSkillBlock", () => {
  it("emits pi's exact wrapper format with args", () => {
    const out = buildSkillBlock({
      name: "openspec-explore",
      filePath: "/x/openspec-explore/SKILL.md",
      baseDir: "/x/openspec-explore",
      body: "Enter explore mode.",
      userArgs: "continue with X",
    });
    expect(out).toBe(
      `<skill name="openspec-explore" location="/x/openspec-explore/SKILL.md">\n` +
        `References are relative to /x/openspec-explore.\n\n` +
        `Enter explore mode.\n` +
        `</skill>\n\n` +
        `continue with X`,
    );
  });

  it("emits wrapper without trailing args block when userArgs is absent", () => {
    const out = buildSkillBlock({
      name: "foo",
      filePath: "/x/foo/SKILL.md",
      baseDir: "/x/foo",
      body: "body line",
    });
    expect(out.endsWith("</skill>")).toBe(true);
    expect(out).not.toContain("</skill>\n\n");
  });
});

describe("buildSkillBlock + parseSkillBlock round-trip", () => {
  it("round-trips name / body / args (with args)", () => {
    const built = buildSkillBlock({
      name: "round",
      filePath: "/p/SKILL.md",
      baseDir: "/p",
      body: "Some body\nwith multiple lines",
      userArgs: "the args here",
    });
    const parsed = parseSkillBlock(built);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("round");
    expect(parsed!.location).toBe("/p/SKILL.md");
    expect(parsed!.body).toBe("Some body\nwith multiple lines");
    expect(parsed!.args).toBe("the args here");
  });

  it("round-trips with no args", () => {
    const built = buildSkillBlock({
      name: "noargs",
      filePath: "/p/SKILL.md",
      baseDir: "/p",
      body: "Body only",
    });
    const parsed = parseSkillBlock(built);
    expect(parsed!.args).toBeUndefined();
    expect(parsed!.condensed).toBe("/skill:noargs");
  });
});

describe("parseSkillCommand", () => {
  it.each([
    ["/skill:a", { name: "a", args: "" }],
    ["/skill:a b", { name: "a", args: "b" }],
    ["/skill:a\nb", { name: "a", args: "b" }],
    ["/skill:a\tb", { name: "a", args: "b" }],
    ["/skill:", null],
    ["/skill: a", null],
    [" /skill:a", null],
    ["/Skill:a", null],
  ])("parses %j", (text, expected) => {
    expect(parseSkillCommand(text)).toEqual(expected);
  });
});
