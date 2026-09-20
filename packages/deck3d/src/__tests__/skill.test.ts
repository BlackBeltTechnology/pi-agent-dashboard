import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  pi: { skills: string[] };
  bin: Record<string, string>;
};
const skill = readFileSync(new URL("../../.pi/skills/deck3d/SKILL.md", import.meta.url), "utf8");

describe("skill ships with the CLI (E45)", () => {
  it("declares the skill path and a resolvable bin", () => {
    expect(pkg.pi.skills).toContain(".pi/skills/deck3d");
    expect(pkg.bin.deck3d).toBe("bin/deck3d");
    expect(existsSync(new URL("../../bin/deck3d", import.meta.url))).toBe(true);
  });

  it("has valid frontmatter named deck3d", () => {
    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toMatch(/^name:\s*deck3d\s*$/m);
  });

  it("documents the contribution procedure and the permissive allow-list (7d.8)", () => {
    for (const token of ["fx preview", "gen:effects", "corpus test", "inspiration only", "LYGIA", "Shadertoy"]) {
      expect(skill).toContain(token);
    }
    for (const licence of ["MIT", "Zlib", "BSD", "CC0-1.0", "Apache-2.0", "OFL-1.1"]) {
      expect(skill).toContain(licence);
    }
  });
});

/**
 * test-plan #E44 — the Style pass is what turns a `check: clean` deck into a
 * deck that was actually designed, so the skill must teach it as a numbered
 * step, not a footnote.
 */
describe("E44 SKILL.md teaches the Style pass", () => {
  it("has a numbered loop step titled Style", () => {
    expect(skill).toMatch(/^\d+\.\s+\*\*Style\*\*/m);
  });

  it.each([
    "check --style",
    "fx scaffold",
    "props search --role ambient",
    "overrides apply",
    "markdown inline overrides win",
    "Math.random",
  ])("mentions %s", (token) => {
    expect(skill).toContain(token);
  });
});
