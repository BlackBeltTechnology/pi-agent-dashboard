/**
 * reverse-spec-for-rebuild skill text (test-plan E14, E15): self-contained references
 * and discoverable frontmatter. See change: add-reverse-spec-for-rebuild.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { read, SKILL } from "./files";

const DOCS = [
  "SKILL.md",
  ...readdirSync(join(SKILL, "prompts")).map((f) => `prompts/${f}`),
  ...readdirSync(join(SKILL, "references")).map((f) => `references/${f}`),
];

const REF = /(?:^|[\s`(["'])((?:\.\.\/|prompts\/|references\/|scripts\/)[A-Za-z0-9_./-]*)/g;

function refs(doc: string): string[] {
  return [...read(join(SKILL, doc)).matchAll(REF)].map((m) => m[1].replace(/[.,:;]+$/, ""));
}

describe("reverse-spec-for-rebuild skill text", () => {
  it.each(DOCS)("E14: every relative path in %s resolves inside the skill dir", (doc) => {
    const found = refs(doc);
    expect(found.filter((r) => r.startsWith("../"))).toEqual([]);
    for (const r of found) {
      const abs = resolve(SKILL, r);
      expect(relative(SKILL, abs).startsWith(".."), `${doc}: ${r}`).toBe(false);
      expect(existsSync(abs), `${doc}: ${r}`).toBe(true);
    }
  });

  it("E14: SKILL.md references every prompt and the guard script", () => {
    const found = new Set(refs("SKILL.md"));
    for (const f of readdirSync(join(SKILL, "prompts"))) expect(found.has(`prompts/${f}`), f).toBe(true);
    expect(found.has("scripts/guard.mjs")).toBe(true);
  });

  it("E15: frontmatter names the skill and its rebuild trigger", () => {
    const fm = read(join(SKILL, "SKILL.md")).match(/^---\n([\s\S]*?)\n---/);
    expect(fm).not.toBeNull();
    expect(fm?.[1]).toMatch(/^name: reverse-spec-for-rebuild$/m);
    const desc = fm?.[1].match(/^description: (.*)$/m)?.[1] ?? "";
    expect(desc).toContain("rebuild");
  });
});
