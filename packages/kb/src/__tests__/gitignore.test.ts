// gitignore.ts unit tests: matcher decision table (test-plan E16), loader
// seeding / negation / deeper-override (E13/E14/E15 unit level), robustness (X2).
// See change: fix-dox-lint-blind-rows.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGitignoreMatcher, patternMatches } from "../gitignore.js";

describe("gitignore pattern forms (E16 decision table)", () => {
  it.each([
    ["bare name", "README.md", "docs/README.md", true],
    ["bare name no match", "README.md", "docs/notes.md", false],
    ["dir/ ignores contents", "out/", "out/x.md", true],
    ["dir/ ignores deeper contents", "out/", "out/sub/x.md", true],
    ["dir/ does not match same-prefix file", "out/", "outfile.md", false],
    ["*.ext glob", "*.db", "data.db", true],
    ["*.ext under dir", "*.db", "a/b/data.db", true],
    ["mid-name glob", "rows*.jsonl", "logs/rows-2026.jsonl", true],
    ["mid-name glob exact", "rows*.jsonl", "rows.jsonl", true],
    ["leading **/", "**/node_modules", "a/b/node_modules", true],
    ["leading **/ contents", "**/node_modules", "a/node_modules/x.js", true],
    ["mid ** zero dirs", "a/**/b", "a/b", true],
    ["mid ** deep", "a/**/b", "a/x/y/b", true],
    ["chained mid **", "packages/*/src/**/*.js", "packages/client/src/generated/x.js", true],
    ["chained mid ** zero", "packages/*/src/**/*.js", "packages/client/src/x.js", true],
    ["chained mid ** no match", "packages/*/src/**/*.js", "packages/client/lib/x.js", false],
    ["leading-slash anchor file", "/package-lock.json", "package-lock.json", true],
    ["leading-slash anchor rejects deep", "/package-lock.json", "a/package-lock.json", false],
    ["case-sensitive dir match", "Out/", "Out/x.md", true],
    ["case-sensitive dir no match", "Out/", "out/x.md", false],
    ["case-sensitive name no match", "Readme.md", "README.md", false],
    ["bare * matches file", "*", "anything.md", true],
    ["bare * matches contents", "*", "a/b/c.md", true],
    ["trailing /** everything inside", "site/design-scratch/**", "site/design-scratch/out/x.md", true],
    ["trailing /** not the dir itself", "site/design-scratch/**", "site/design-scratch", false],
  ])("%s", (_label, pattern, rel, expected) => {
    expect(patternMatches(pattern, rel)).toBe(expected);
  });

  it("negation is a match with flipped verdict (last-match-wins lives in the loader)", () => {
    expect(patternMatches("!keep.md", "keep.md")).toBe(true); // pattern engages
    expect(patternMatches("!keep.md", "other.md")).toBe(false);
  });

  it("skips a malformed pattern line without throwing (X2)", () => {
    expect(() => patternMatches("[abc", "abc.md")).not.toThrow();
    expect(patternMatches("[abc", "abc.md")).toBe(false);
  });
});

describe("gitignore loader", () => {
  const tmps: string[] = [];
  const tree = (files: Record<string, string>): string => {
    const d = mkdtempSync(join(tmpdir(), "kb-gi-"));
    tmps.push(d);
    for (const [p, body] of Object.entries(files)) {
      const abs = join(d, p);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, body);
    }
    return d;
  };
  afterEach(() => {
    for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("no .gitignore anywhere → predicate ignores nothing, no throw (X1)", () => {
    const d = tree({ "a.md": "x\n", "sub/b.md": "x\n" });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnored("a.md")).toBe(false);
    expect(m.isIgnored("sub/b.md")).toBe(false);
    expect(m.isIgnoredDir("sub")).toBe(false);
  });

  it("root patterns apply from the walk root", () => {
    const d = tree({ ".gitignore": "ignored/\n", "kept.md": "x\n", "ignored/x.md": "x\n" });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnored("ignored/x.md")).toBe(true);
    expect(m.isIgnored("kept.md")).toBe(false);
  });

  it("up-walk seeding: a root-anchored pattern applies from a NESTED walk root (E14 unit)", () => {
    const d = tree({ ".gitignore": "src/generated/\n", "src/generated/x.md": "x\n", "src/keep.md": "x\n" });
    const m = loadGitignoreMatcher(join(d, "src"), { cwd: d });
    expect(m.isIgnored("generated/x.md")).toBe(true); // rel to walk root src/
    expect(m.isIgnored("keep.md")).toBe(false);
  });

  it("negation: both dir and content forms keep tracked coverage (E13 unit)", () => {
    const d = tree({
      ".gitignore": "skills/openspec-*/**\n!skills/openspec-shared/\n!skills/openspec-shared/**\n",
      "skills/openspec-alpha/SKILL.md": "x\n",
      "skills/openspec-shared/SKILL.md": "x\n",
    });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnored("skills/openspec-alpha/SKILL.md")).toBe(true);
    expect(m.isIgnored("skills/openspec-shared/SKILL.md")).toBe(false);
    expect(m.isIgnoredDir("skills/openspec-shared")).toBe(false); // negated → do not prune
    expect(m.isIgnoredDir("skills/openspec-alpha")).toBe(false); // content pattern never matched the dir
  });

  it("deeper .gitignore overrides shallower dir-ignore (E15 unit)", () => {
    const d = tree({
      ".gitignore": "vendored/\n",
      "vendored/.gitignore": "!keep.md\n",
      "vendored/keep.md": "x\n",
      "vendored/other.md": "x\n",
    });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnored("vendored/keep.md")).toBe(false);
    expect(m.isIgnored("vendored/other.md")).toBe(true);
    // dir-level: vendored itself matches, but descent still happens (deeper negation)
    expect(m.isIgnoredDir("vendored")).toBe(true);
    expect(m.hasDeeperGitignore("vendored")).toBe(true);
    expect(m.hasDeeperGitignore("vendored/keep.md")).toBe(false);
  });

  it("malformed line skipped, valid line still applies (X2)", () => {
    const d = tree({ ".gitignore": "[abc\nquiet.md\n", "quiet.md": "x\n", "loud.md": "x\n" });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnored("quiet.md")).toBe(true);
    expect(m.isIgnored("loud.md")).toBe(false);
  });
});
