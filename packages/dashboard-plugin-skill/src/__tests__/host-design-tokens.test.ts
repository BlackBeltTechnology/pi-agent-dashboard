/**
 * Contract test for `references/host-design.md` — the plugin-author subset of
 * root `ui-contract.md` shipped with the scaffold skill.
 *
 * Guards: the reference ships, both next-steps blocks point at it, and every
 * concrete CSS custom property it names is declared in the dashboard client
 * token layer (`packages/client/src/index.css`).
 *
 * See change: anti-slop-taste-v2 (test-plan E16, E17, E18).
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO = path.resolve(PKG, "../..");
const SKILL_DIR = path.join(PKG, ".pi/skills/dashboard-plugin-scaffold");
const HOST_DESIGN = path.join(SKILL_DIR, "references/host-design.md");
const INDEX_CSS = path.join(REPO, "packages/client/src/index.css");

/** Concrete `--token` code spans; placeholders like `--accent-<hue>` are skipped. */
function namedTokens(md: string): string[] {
  const spans = [...md.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());
  return [...new Set(spans.filter((s) => /^--[a-z0-9-]+$/.test(s)))];
}

function declaredTokens(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

function undeclared(md: string, declared: Set<string>): string[] {
  return namedTokens(md).filter((t) => !declared.has(t));
}

/** Body of a `### <id>` block up to the next heading. */
function block(text: string, id: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`### ${id}`));
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && /^#{2,3}\s/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

describe("host-design reference (E16)", () => {
  it("ships under the skill dir, covered by package files, derived from ui-contract.md", () => {
    expect(fs.existsSync(HOST_DESIGN)).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
    expect(pkg.files).toContain(".pi/skills/");
    expect(fs.readFileSync(HOST_DESIGN, "utf8")).toMatch(/Derived from root `ui-contract\.md`/);
  });
});

describe("next-steps point at host-design (E17)", () => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
  it.each(["3a.4", "3b.6"])("block %s names host-design.md", (id) => {
    const b = block(skill, id);
    expect(b).not.toBe("");
    expect(b).toContain("host-design.md");
  });
});

describe("host-design token drift (E18)", () => {
  const declared = declaredTokens(fs.readFileSync(INDEX_CSS, "utf8"));

  it("names at least one concrete token, all declared in index.css", () => {
    const md = fs.readFileSync(HOST_DESIGN, "utf8");
    expect(namedTokens(md).length).toBeGreaterThan(0);
    expect(undeclared(md, declared)).toEqual([]);
  });

  it("flags an undeclared token and skips placeholders", () => {
    const md = "use `--bg-primary`, `--accent-<hue>-text`, and `--not-a-real-token`";
    expect(undeclared(md, declared)).toEqual(["--not-a-real-token"]);
  });
});
