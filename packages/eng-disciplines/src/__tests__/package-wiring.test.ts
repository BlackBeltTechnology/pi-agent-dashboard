/**
 * eng-disciplines repo wiring (test-plan E11-E13, E18, E19, E25): skill registration,
 * NOTICE attribution, publish file list, biome/vitest root config.
 * See change: add-reverse-spec-for-rebuild.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PKG, REPO, read } from "./files";

const pkg = JSON.parse(read(join(PKG, "package.json")));
const EVAL_EXCLUDE = "!.pi/skills/reverse-spec-for-rebuild/eval/**";

describe("eng-disciplines wiring", () => {
  it("E11: registers reverse-spec-for-rebuild beside scenario-design", () => {
    expect(pkg.pi.skills).toContain(".pi/skills/reverse-spec-for-rebuild");
    expect(pkg.pi.skills).toContain(".pi/skills/scenario-design");
  });

  it.each(pkg.pi.skills as string[])("E11: %s has a SKILL.md", (dir) => {
    expect(existsSync(join(PKG, dir, "SKILL.md"))).toBe(true);
  });

  it("E12: files ships NOTICE and excludes the eval fixture after .pi/skills/", () => {
    const files = pkg.files as string[];
    expect(files).toContain("NOTICE");
    expect(files.indexOf(EVAL_EXCLUDE)).toBeGreaterThan(files.indexOf(".pi/skills/"));
    expect(files.indexOf(".pi/skills/")).toBeGreaterThanOrEqual(0);
  });

  it("ships rsfr-* agents whose frontmatter model matches the SKILL routing table", () => {
    expect(pkg.files).toContain("agents/");
    const skill = read(join(PKG, ".pi/skills/reverse-spec-for-rebuild/SKILL.md"));
    const rows = [...skill.matchAll(/^\| [^|]+? \| `(rsfr-[\w-]+)` \| `[^`]+` \| `(@\w+)` \|/gm)];
    expect(rows.map((r) => r[1]).sort()).toEqual([
      "rsfr-auditor", "rsfr-completeness", "rsfr-crud-classifier", "rsfr-discovery", "rsfr-generator",
      "rsfr-sequence-generator", "rsfr-state-machine-generator", "rsfr-uc-linker", "rsfr-ui-screen-generator", "rsfr-variability-classifier",
    ]);
    for (const [, type, model] of rows) {
      expect(read(join(PKG, "agents", `${type}.md`))).toMatch(new RegExp(`^model: "${model}"$`, "m"));
    }
  });

  it("E12: NOTICE credits greenfield (Apache-2.0) and keeps prior credits", () => {
    const notice = read(join(PKG, "NOTICE"));
    for (const s of ["greenfield", "Apache-2.0", "agent-skills", "hermes-agent"]) expect(notice).toContain(s);
  });

  it("E13: packed file list has the skill but no eval fixture or tests", () => {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: PKG, encoding: "utf8" });
    // npm <= 11 prints an array of pack results; npm 12 an object keyed by package name.
    const json = JSON.parse(out);
    const entry = Array.isArray(json) ? json[0] : Object.values(json)[0];
    const paths = ((entry as { files: { path: string }[] }).files).map((f) => f.path);
    expect(paths).toContain("NOTICE");
    expect(paths).toContain(".pi/skills/reverse-spec-for-rebuild/SKILL.md");
    expect(paths.filter((p) => p.includes("/eval/") || p.includes("src/__tests__"))).toEqual([]);
  });

  it("E18: root biome.json excludes the eval fixture", () => {
    const biome = JSON.parse(read(join(REPO, "biome.json")));
    expect(biome.files.includes).toContain("!packages/eng-disciplines/.pi/skills/reverse-spec-for-rebuild/eval/**");
  });

  it("E19: root vitest.config.ts collects the package", () => {
    expect(read(join(REPO, "vitest.config.ts"))).toContain('"packages/eng-disciplines"');
  });

  it("E25: scenario-design holds only SKILL.md + references/*.md", () => {
    const dir = join(PKG, ".pi", "skills", "scenario-design");
    const entries = readdirSync(dir).sort();
    expect(entries).toEqual(["SKILL.md", "references"]);
    for (const f of readdirSync(join(dir, "references"))) {
      expect(statSync(join(dir, "references", f)).isFile()).toBe(true);
      expect(f).toMatch(/\.md$/);
      expect(f).not.toMatch(/\.AGENTS\.md$/);
    }
  });
});
