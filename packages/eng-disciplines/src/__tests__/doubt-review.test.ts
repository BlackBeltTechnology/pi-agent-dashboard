/**
 * doubt-driven-review wiring: the reviewer is spawned from a shipped definition that
 * disables context inheritance (else the CLAIM leaks via the parent snapshot), the
 * skill text carries the retry / same-family / output-shape rules, and every
 * skill it cross-references actually exists in this repo.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PKG, read } from "./files";

const DIR = join(PKG, ".pi", "skills", "doubt-driven-review");
const DOCS = ["SKILL.md", "SKILL.agent.md"].map((f) => join(DIR, f));
const AGENT = join(PKG, "agents", "doubt-reviewer.md");
const flat = (s: string) => s.replace(/\s+/g, " ");

function frontmatter(path: string): string {
  return read(path).match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
}

describe("doubt-reviewer agent definition", () => {
  it("ships, disables inheritance, and pins no model (single-model pass = author's model)", () => {
    expect(existsSync(AGENT)).toBe(true);
    const fm = frontmatter(AGENT);
    expect(fm).toMatch(/^inherit_context: false$/m);
    expect(fm).not.toMatch(/^model:/m);
  });
});

describe.each(DOCS)("doubt-driven-review text: %s", (doc) => {
  const t = flat(read(doc));

  it("spawns the reviewer as doubt-reviewer, never a generic inheriting label", () => {
    expect(t).toMatch(/subagent_type:? "?doubt-reviewer/);
    expect(t).not.toMatch(/or any read-capable label/);
    expect(t).toMatch(/inherit_context: false/);
  });

  it("retries an empty reply once before advancing the role series", () => {
    expect(t).toMatch(/retry (it )?once/i);
  });

  it("allows a same-family reviewer only as an announced degraded last resort", () => {
    expect(t).toMatch(/same-family/i);
    expect(t).toMatch(/degraded/i);
  });

  it("asks for structured findings with severity, location, contract clause", () => {
    expect(t).toMatch(/severity/i);
    expect(t).toMatch(/contract clause/i);
  });
});

describe("doubt-driven-review cross-references resolve", () => {
  const skills = new Set(
    [join(PKG, ".pi", "skills"), join(PKG, "..", "..", ".pi", "skills")].flatMap((d) =>
      existsSync(d) ? readdirSync(d) : [],
    ),
  );
  // the CodeRabbit `code-review` skill ships from a sibling package
  skills.add("code-review");

  it.each(DOCS)("%s names no upstream-only skill or reference file", (doc) => {
    const t = read(doc);
    expect(t).not.toMatch(/references\/orchestration-patterns\.md/);
    for (const gone of [
      "code-review-and-quality",
      "source-driven-development",
      "test-driven-development",
      "debugging-and-error-recovery",
    ]) {
      expect(t, gone).not.toContain(gone);
    }
    const section = t.split(/^## Interaction with Other Skills$/m)[1]?.split(/^## /m)[0] ?? "";
    const named = [...section.matchAll(/^- \*\*`([a-z-]+)`/gm)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const s of named) expect(skills.has(s), s).toBe(true);
  });
});
