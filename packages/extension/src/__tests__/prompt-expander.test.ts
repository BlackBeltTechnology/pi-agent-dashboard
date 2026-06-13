import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { expandPromptTemplateFromDisk } from "../prompt-expander.js";
import { parseSkillBlock } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";

const tmpDir = join(import.meta.dirname ?? __dirname, "__tmp_prompt_test__");
const promptsDir = join(tmpDir, ".pi", "prompts");
const skillsDir = join(tmpDir, ".pi", "skills");

beforeEach(() => {
  mkdirSync(promptsDir, { recursive: true });
  writeFileSync(join(promptsDir, "opsx-continue.md"), "---\ndescription: continue\n---\nContinue the change");
  writeFileSync(join(promptsDir, "opsx-apply.md"), "Apply the change");
  writeFileSync(join(promptsDir, "hello.md"), "Hello world");
  // Skill fixture
  mkdirSync(join(skillsDir, "my-skill"), { recursive: true });
  writeFileSync(
    join(skillsDir, "my-skill", "SKILL.md"),
    "---\nname: my-skill\ndescription: A demo skill\n---\nFirst body line\nSecond body line",
  );
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("expandPromptTemplateFromDisk", () => {
  it("expands hyphen form /opsx-continue", () => {
    const result = expandPromptTemplateFromDisk("/opsx-continue my-change", tmpDir);
    expect(result).toContain("Continue the change");
    expect(result).toContain("my-change");
  });

  it("expands colon form /opsx:continue as alias for /opsx-continue", () => {
    const result = expandPromptTemplateFromDisk("/opsx:continue my-change", tmpDir);
    expect(result).toContain("Continue the change");
    expect(result).toContain("my-change");
  });

  it("expands colon form /opsx:apply without args", () => {
    const result = expandPromptTemplateFromDisk("/opsx:apply", tmpDir);
    expect(result).toBe("Apply the change");
  });

  it("does not affect non-opsx colon commands", () => {
    // /hello has no colon, should work as before
    const result = expandPromptTemplateFromDisk("/hello", tmpDir);
    expect(result).toBe("Hello world");
  });

  it("returns original text when no template found", () => {
    const result = expandPromptTemplateFromDisk("/nonexistent", tmpDir);
    expect(result).toBe("/nonexistent");
  });

  it("strips YAML frontmatter from colon form too", () => {
    const result = expandPromptTemplateFromDisk("/opsx:continue", tmpDir);
    expect(result).toBe("Continue the change");
    expect(result).not.toContain("---");
  });

  // See change: render-skill-invocations-collapsibly.

  it("wraps /skill:my-skill output in a <skill> envelope (with args)", () => {
    const result = expandPromptTemplateFromDisk("/skill:my-skill do the thing", tmpDir);
    expect(result.startsWith('<skill name="my-skill" location="')).toBe(true);
    expect(result).toContain("References are relative to ");
    expect(result).toContain("First body line\nSecond body line");
    expect(result.endsWith("\n\ndo the thing")).toBe(true);
    // round-trips through parseSkillBlock
    const parsed = parseSkillBlock(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("my-skill");
    expect(parsed!.args).toBe("do the thing");
    expect(parsed!.condensed).toBe("/skill:my-skill do the thing");
  });

  it("wraps /skill:my-skill output in a <skill> envelope (without args)", () => {
    const result = expandPromptTemplateFromDisk("/skill:my-skill", tmpDir);
    expect(result.startsWith('<skill name="my-skill" location="')).toBe(true);
    expect(result.endsWith("</skill>")).toBe(true);
    expect(result).not.toContain("</skill>\n\n");
    const parsed = parseSkillBlock(result);
    expect(parsed!.args).toBeUndefined();
    expect(parsed!.condensed).toBe("/skill:my-skill");
  });

  it("prompt template /opsx-continue stays unwrapped (no <skill> tag)", () => {
    const result = expandPromptTemplateFromDisk("/opsx-continue my-change", tmpDir);
    expect(result).not.toContain("<skill name=");
    expect(result).not.toContain("</skill>");
  });

  it("colon-alias prompt template /opsx:continue stays unwrapped", () => {
    const result = expandPromptTemplateFromDisk("/opsx:continue x", tmpDir);
    expect(result).not.toContain("<skill name=");
  });

  // Change: unify-opsx-colon-hyphen-aliases — symmetric : ↔ - resolution.

  function makeSkillFile(relPath: string, body = "skill body"): string {
    const abs = join(tmpDir, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `---\nname: ignored\n---\n${body}`);
    return abs;
  }

  it("expands hyphen-typed slash command resolving a colon-registered pi.getCommands skill", () => {
    const skillPath = makeSkillFile("registry/colon/SKILL.md");
    const pi = {
      getCommands: () => [{ name: "opsx:archive", source: "skill", path: skillPath }],
    };
    const result = expandPromptTemplateFromDisk("/opsx-archive my-change", tmpDir, pi);
    expect(result.startsWith('<skill name="opsx:archive" location="')).toBe(true);
    expect(result.endsWith("\n\nmy-change")).toBe(true);
    const parsed = parseSkillBlock(result);
    expect(parsed!.name).toBe("opsx:archive");
    expect(parsed!.args).toBe("my-change");
  });

  it("expands colon-typed slash command resolving a hyphen-registered pi.getCommands skill", () => {
    const skillPath = makeSkillFile("registry/hyphen/SKILL.md");
    const pi = {
      getCommands: () => [{ name: "opsx-archive", source: "skill", path: skillPath }],
    };
    const result = expandPromptTemplateFromDisk("/opsx:archive my-change", tmpDir, pi);
    expect(result.startsWith('<skill name="opsx-archive" location="')).toBe(true);
    expect(result.endsWith("\n\nmy-change")).toBe(true);
    const parsed = parseSkillBlock(result);
    expect(parsed!.name).toBe("opsx-archive");
  });

  it("expands colon-typed slash command resolving a hyphen-named local SKILL.md directory", () => {
    mkdirSync(join(skillsDir, "opsx-archive"), { recursive: true });
    writeFileSync(join(skillsDir, "opsx-archive", "SKILL.md"), "---\nname: x\n---\nbody");
    const result = expandPromptTemplateFromDisk("/opsx:archive arg", tmpDir);
    expect(result.startsWith('<skill name="opsx-archive" location="')).toBe(true);
    const parsed = parseSkillBlock(result);
    expect(parsed!.name).toBe("opsx-archive");
    expect(parsed!.args).toBe("arg");
  });

  it("expands hyphen-typed slash command resolving a colon-named local SKILL.md directory", () => {
    mkdirSync(join(skillsDir, "opsx:archive"), { recursive: true });
    writeFileSync(join(skillsDir, "opsx:archive", "SKILL.md"), "---\nname: x\n---\nbody");
    const result = expandPromptTemplateFromDisk("/opsx-archive arg", tmpDir);
    expect(result.startsWith('<skill name="opsx:archive" location="')).toBe(true);
    const parsed = parseSkillBlock(result);
    expect(parsed!.name).toBe("opsx:archive");
  });

  it("original-form precedence: colon-typed prefers colon-registered skill over hyphen-form prompt template", () => {
    // Local prompt opsx-foo.md exists; registry has skill opsx:foo.
    writeFileSync(join(promptsDir, "opsx-foo.md"), "prompt body");
    const skillPath = makeSkillFile("registry/precedence/SKILL.md", "skill body");
    const pi = {
      getCommands: () => [{ name: "opsx:foo", source: "skill", path: skillPath }],
    };
    // /opsx:foo → must wrap as skill (registry hit on original form).
    const colon = expandPromptTemplateFromDisk("/opsx:foo", tmpDir, pi);
    expect(colon.startsWith('<skill name="opsx:foo" location="')).toBe(true);
    // /opsx-foo → must NOT wrap (local prompt hit on original form).
    const hyphen = expandPromptTemplateFromDisk("/opsx-foo", tmpDir, pi);
    expect(hyphen).not.toContain("<skill name=");
    expect(hyphen).toContain("prompt body");
  });

  it("original-form-first across distinct pi.getCommands entries", () => {
    const aPath = makeSkillFile("registry/A/SKILL.md", "A body");
    const bPath = makeSkillFile("registry/B/SKILL.md", "B body");
    const pi = {
      getCommands: () => [
        { name: "opsx:foo", source: "skill", path: aPath },
        { name: "opsx-foo", source: "skill", path: bPath },
      ],
    };
    const colon = expandPromptTemplateFromDisk("/opsx:foo arg", tmpDir, pi);
    expect(colon).toContain(`location="${aPath}"`);
    expect(colon).toContain('name="opsx:foo"');
    expect(colon).not.toContain(`location="${bPath}"`);
    const hyphen = expandPromptTemplateFromDisk("/opsx-foo arg", tmpDir, pi);
    expect(hyphen).toContain(`location="${bPath}"`);
    expect(hyphen).toContain('name="opsx-foo"');
    expect(hyphen).not.toContain(`location="${aPath}"`);
  });

  it("original form in pi-registry beats remapped form in local-scan", () => {
    // Local prompt opsx-foo.md exists; registry has skill opsx:foo.
    writeFileSync(join(promptsDir, "opsx-foo.md"), "prompt body");
    const skillPath = makeSkillFile("registry/outer/SKILL.md", "skill body");
    const pi = {
      getCommands: () => [{ name: "opsx:foo", source: "skill", path: skillPath }],
    };
    // /opsx:foo: outer-loop probes original form across ALL stores first.
    // Step 3 hit on registry — must NOT fall through to remapped opsx-foo local prompt.
    const result = expandPromptTemplateFromDisk("/opsx:foo", tmpDir, pi);
    expect(result.startsWith('<skill name="opsx:foo" location="')).toBe(true);
    expect(result).not.toContain("prompt body");
  });

  // Change: resolve-global-prompt-templates-from-dashboard — source:"prompt" via pi.getCommands().

  it("expands a global prompt template resolved via pi.getCommands source:prompt (sourceInfo.path — real pi shape)", () => {
    const promptPath = join(tmpDir, "registry", "session-summary.md");
    mkdirSync(dirname(promptPath), { recursive: true });
    writeFileSync(promptPath, "---\ndescription: Summarize\n---\nSummarize this session");
    // Real pi getCommands() returns the path under sourceInfo, NOT top-level path.
    const pi = {
      getCommands: () => [
        { name: "session-summary", source: "prompt", sourceInfo: { path: promptPath, source: "local", scope: "user" } },
      ],
    };
    const result = expandPromptTemplateFromDisk("/session-summary extra args", tmpDir, pi);
    // Prompt templates are NOT wrapped in a <skill> envelope.
    expect(result).not.toContain("<skill name=");
    expect(result.startsWith("Summarize this session")).toBe(true);
    expect(result.endsWith("\n\nextra args")).toBe(true);
  });

  it("expands a global prompt template via top-level path (legacy / stub shape)", () => {
    const promptPath = join(tmpDir, "registry", "legacy-summary.md");
    mkdirSync(dirname(promptPath), { recursive: true });
    writeFileSync(promptPath, "Legacy body");
    const pi = {
      getCommands: () => [
        { name: "legacy-summary", source: "prompt", path: promptPath },
      ],
    };
    expect(expandPromptTemplateFromDisk("/legacy-summary", tmpDir, pi)).toBe("Legacy body");
  });

  it("ignores a malformed getCommands entry (non-string path) without throwing", () => {
    const pi = {
      getCommands: () => [
        { name: "session-summary", source: "prompt", sourceInfo: { path: 12345 } },
        { name: "session-summary", source: "prompt", path: null },
      ],
    };
    // Malformed paths => no resolution, raw text returned (no throw).
    expect(expandPromptTemplateFromDisk("/session-summary", tmpDir, pi)).toBe("/session-summary");
  });

  it("tolerates a non-array getCommands() return", () => {
    const pi = { getCommands: () => null };
    expect(expandPromptTemplateFromDisk("/session-summary", tmpDir, pi)).toBe("/session-summary");
  });

  it("expands a colon-aliased prompt template registered with hyphen via pi.getCommands", () => {
    const promptPath = join(tmpDir, "registry", "session-summary.md");
    mkdirSync(dirname(promptPath), { recursive: true });
    writeFileSync(promptPath, "Summarize this session");
    const pi = {
      getCommands: () => [
        { name: "session-summary", source: "prompt", sourceInfo: { path: promptPath } },
      ],
    };
    const result = expandPromptTemplateFromDisk("/session:summary", tmpDir, pi);
    expect(result).toBe("Summarize this session");
  });

  it("misspelled name with wrong separator returns input unchanged", () => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    const result = expandPromptTemplateFromDisk("/opsx:nonexistent foo", tmpDir);
    expect(result).toBe("/opsx:nonexistent foo");
  });
});
