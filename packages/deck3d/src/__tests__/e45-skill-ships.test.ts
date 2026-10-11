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

// ── change deck3d-pptx-import: the second skill ──────────────────────────────

const tutorial = readFileSync(new URL("../../.pi/skills/deck3d-from-pptx/SKILL.md", import.meta.url), "utf8");
const steps = readFileSync(new URL("../../.pi/skills/deck3d-from-pptx/reference/steps.md", import.meta.url), "utf8");

describe("E59 both skills ship (deck3d-pptx-import)", () => {
  it("package.json registers deck3d and deck3d-from-pptx, each with matching frontmatter", () => {
    expect(pkg.pi?.skills).toEqual(expect.arrayContaining([".pi/skills/deck3d", ".pi/skills/deck3d-from-pptx"]));
    for (const [path, name] of [[".pi/skills/deck3d/SKILL.md", "deck3d"], [".pi/skills/deck3d-from-pptx/SKILL.md", "deck3d-from-pptx"]] as const) {
      const text = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
      expect(/^---\n([\s\S]*?)\n---/.exec(text)?.[1], path).toMatch(new RegExp(`^name:\\s*${name}\\s*$`, "m"));
    }
  });

  it("the deck3d skill references deck3d-from-pptx", () => {
    expect(skill).toContain("deck3d-from-pptx");
  });
});

describe("E60 the tutorial's procedure is complete (deck3d-pptx-import)", () => {
  const all = `${tutorial}\n${steps}`;

  it("lists the nine step ids in order", () => {
    const ids = ["fidelity", "placement", "frame", "brand-art", "icons", "hero", "worlds", "media", "transitions"];
    const rows = ids.map((id) => tutorial.indexOf(`| \`${id}\` |`));
    for (const [i, at] of rows.entries()) expect(at, ids[i]).toBeGreaterThan(-1);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  it("states the native skip, embed-video, reference-render request and the explicit headless rule", () => {
    expect(tutorial).toMatch(/skip steps 2, 3 and 5/i);
    expect(tutorial).toContain("--embed-video");
    expect(tutorial).toMatch(/file:\/\/.*without embedding/s);
    expect(tutorial).toMatch(/ask the user.*PNG export.*--ref/is);
    expect(tutorial).toMatch(/snapshot review.*instead of/is);
    expect(tutorial).toMatch(/only when the run prompt says so explicitly/i);
    expect(tutorial).toContain('--note auto');
    expect(tutorial).toMatch(/do not pick for the user/i);
  });

  it("carries every pitfall and the tune-loop rules", () => {
    for (const phrase of ["lifted above it", "normal blending", "frame-chrome", "widen", "rebuild manually", "compare --transition", "actual viewport"]) {
      expect(all, phrase).toContain(phrase);
    }
    for (const phrase of ["never edit `deck.html`", "derived IR fields", "randomness, timers or network", "check deck.html --style"]) {
      expect(tutorial, phrase).toContain(phrase);
    }
  });
});
