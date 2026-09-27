/**
 * #E36: repo wiring for the music-production package — every `pi.skills` dir has a
 * SKILL.md, every `scripts/*.py` a SKILL.md names exists, the root vitest config
 * collects the package, and the lockfile carries its importer.
 * See change: add-music-production-skills.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PKG, REPO, read } from "./files";

const pkg = JSON.parse(read(join(PKG, "package.json")));

describe("music-production wiring", () => {
  it("registers the three skills", () => {
    expect(pkg.pi.skills).toEqual([
      ".pi/skills/music-analysis",
      ".pi/skills/music-edit-to-length",
      ".pi/skills/beat-sync-video",
    ]);
  });

  it.each(pkg.pi.skills as string[])("%s has a SKILL.md", (dir) => {
    expect(existsSync(join(PKG, dir, "SKILL.md"))).toBe(true);
  });

  it.each(pkg.pi.skills as string[])("every scripts/*.py named in %s/SKILL.md exists", (dir) => {
    const text = read(join(PKG, dir, "SKILL.md"));
    const named = [...text.matchAll(/scripts\/([A-Za-z0-9_]+\.py)/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const script of named) {
      // a skill may call a sibling skill's script via its full .pi/skills/<skill>/scripts path
      const sibling = text.match(new RegExp(`\\.pi/skills/([a-z-]+)/scripts/${script.replace(".", "\\.")}`));
      const home = sibling ? join(PKG, ".pi", "skills", sibling[1]) : join(PKG, dir);
      expect(existsSync(join(home, "scripts", script)), `${dir}: ${script}`).toBe(true);
    }
  });

  it("ships lib/ and the requirements files but not the tests", () => {
    expect(pkg.files).toEqual(expect.arrayContaining([".pi/skills/", "lib/", "requirements-*.txt", "README.md", "!**/__pycache__"]));
    expect(pkg.files.some((f: string) => f.startsWith("tests") || f.startsWith("src"))).toBe(false);
  });

  it("root vitest.config.ts collects the package", () => {
    expect(read(join(REPO, "vitest.config.ts"))).toMatch(/"packages\/music-production"/);
  });

  it("pnpm-lock.yaml has the importer", () => {
    expect(read(join(REPO, "pnpm-lock.yaml"))).toMatch(/^ {2}packages\/music-production:$/m);
  });
});
