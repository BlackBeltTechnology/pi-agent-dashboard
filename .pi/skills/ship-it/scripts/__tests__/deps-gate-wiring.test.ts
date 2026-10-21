/**
 * Skill-text wiring of the dependency gate: the ship-it prose runs the script
 * at entry with the stated timeout and failure semantics (#X12), and
 * plan-proposal commits `dependencies.yaml` (#X13). The skills ARE the
 * orchestration, so the prose is what is pinned.
 * See change: add-openspec-change-dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const skillsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (skill: string) => fs.readFileSync(path.join(skillsDir, skill, "SKILL.md"), "utf8").replace(/\s+/g, " ");

describe("#X12 ship-it dependency gate", () => {
  const skill = () => read("ship-it");
  const raw = () => fs.readFileSync(path.join(skillsDir, "ship-it", "SKILL.md"), "utf8");
  const section = () => {
    const s = raw();
    return s.slice(s.indexOf("### 1.5."), s.indexOf("### 2. Run apply")).replace(/\s+/g, " ");
  };

  it("runs after the entry gate and before any implementation step", () => {
    const s = raw();
    expect(s.indexOf("### 1. Orient")).toBeLessThan(s.indexOf("### 1.5."));
    expect(s.indexOf("### 1.5.")).toBeLessThan(s.indexOf("### 2. Run apply"));
    expect(section()).toMatch(/after\*\* the `SHIP_IT_BLOCKED\.md` entry gate/);
  });

  it("invokes the script with --change and a 60 s overall timeout", () => {
    expect(section()).toContain("openspec-deps-gate.ts --change <change>");
    expect(section()).toMatch(/60 s overall timeout/);
  });

  it("a crash, timeout or unparseable output is 'not checked', never a stop", () => {
    expect(section()).toMatch(/Crash, timeout or unparseable output.*dependencies not checked.*continue/);
  });

  it("an interactive decline writes SHIP_IT_BLOCKED.md; headless continues and reports", () => {
    expect(section()).toMatch(/Interactive\*\* → `ask_user`/);
    expect(section()).toMatch(/on \*stop\* write `SHIP_IT_BLOCKED\.md` naming them/);
    expect(section()).toMatch(/Headless\*\* → \*\*continue\*\* and carry the open blockers into the final report/);
  });

  it("error issues stop through the SHIP_IT_BLOCKED.md escape hatch; offline says cycles were not checked", () => {
    expect(section()).toMatch(/status: blocked.*write `SHIP_IT_BLOCKED\.md`/);
    expect(section()).toMatch(/cycles and inferred edges were \*\*not checked\*\*/);
  });

  it("is listed with the skill's scripts", () => {
    expect(skill()).toContain("scripts/openspec-deps-gate.ts");
  });
});

describe("#X13 plan-proposal commit list", () => {
  it("includes dependencies.yaml when present", () => {
    expect(read("plan-proposal")).toMatch(/Commit `proposal\.md`.*`test-plan\.md` to `develop` — plus `dependencies\.yaml` when the change has one/);
  });
});
