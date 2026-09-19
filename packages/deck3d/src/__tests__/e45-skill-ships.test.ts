/**
 * E45 (task 10.45) — skill: Skill and CLI ship together (triple).
 *
 * The published package must register the `deck3d` skill path, resolve the
 * `deck3d` binary to an executable file, and carry frontmatter named `deck3d`
 * so pi discovers it on install.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  pi?: { skills?: string[] };
  bin?: Record<string, string>;
};
const skill = readFileSync(new URL("../../.pi/skills/deck3d/SKILL.md", import.meta.url), "utf8");

describe("E45 skill and CLI ship together", () => {
  it("package.json registers .pi/skills/deck3d", () => {
    expect(pkg.pi?.skills).toContain(".pi/skills/deck3d");
  });

  it("bin.deck3d resolves to an executable file", () => {
    const rel = pkg.bin?.deck3d;
    expect(rel).toBeTruthy();
    const bin = new URL(`../../${rel}`, import.meta.url);
    expect(existsSync(bin)).toBe(true);
    expect(statSync(bin).mode & 0o111).not.toBe(0);
  });

  it("SKILL.md frontmatter is named deck3d", () => {
    const frontMatter = /^---\n([\s\S]*?)\n---/.exec(skill);
    expect(frontMatter, "SKILL.md must open with YAML frontmatter").toBeTruthy();
    expect(frontMatter?.[1]).toMatch(/^name:\s*deck3d\s*$/m);
  });
});
