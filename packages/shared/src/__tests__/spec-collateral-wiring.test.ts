/**
 * Repo-level wiring guard for the spec-collateral scan
 * (change: add-spec-collateral-scan, test-plan X6, W1–W5).
 *
 * Static wiring only: the scan is advisory (never invoked by a gate), and the
 * plan-proposal / doubt-driven-review skill text carries the scan, the
 * cross-model wording, cited code claims and the reviewer hygiene rules.
 * Whether a live model obeys the text is manual QA (test-plan M1, M2).
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf-8");

const PLAN_PROPOSAL = ".pi/skills/plan-proposal/SKILL.md";
const DOUBT = "packages/eng-disciplines/.pi/skills/doubt-driven-review/SKILL.md";
const DOUBT_AGENT = "packages/eng-disciplines/.pi/skills/doubt-driven-review/SKILL.agent.md";

/** Body of a `### <n>.` step section, up to the next `### ` / `## ` heading. */
function step(text: string, n: string): string {
  const start = text.search(new RegExp(`^### ${n}\\. `, "m"));
  expect(start, `step ${n} heading`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(text.indexOf("\n", start) + 1);
  const end = rest.search(/^##+ /m);
  return end === -1 ? rest : rest.slice(0, end);
}
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("spec-collateral wiring", () => {
  it("X6 no gate invokes spec-collateral.mjs", () => {
    const workflows = fs
      .readdirSync(path.join(repoRoot, ".github", "workflows"))
      .filter((f) => f.endsWith(".yml"))
      .map((f) => `.github/workflows/${f}`);
    for (const rel of ["scripts/check-conventions.mjs", ".pi/skills/ship-it/SKILL.md", ...workflows]) {
      expect(read(rel), rel).not.toContain("spec-collateral.mjs");
    }
  });

  it("W1 plan-proposal step 2 runs the scan into the CONTRACT before each cycle, report-and-proceed on failure", () => {
    const s = flat(step(read(PLAN_PROPOSAL), "2"));
    expect(s).toContain("node scripts/spec-collateral.mjs --change");
    expect(s).toMatch(/before each doubt-review cycle/i);
    expect(s).toContain("Candidate conflicting requirements (advisory scan)");
    expect(s).toMatch(/cannot run or exits non-zero, report the failure and proceed/i);
  });

  it("W2 cross-model wording: automatic when a role resolves, offered otherwise", () => {
    const text = read(PLAN_PROPOSAL);
    expect(text).not.toContain("always offer, never silently skip");
    const start = text.indexOf("## Hard constraint — main session only");
    expect(start).toBeGreaterThanOrEqual(0);
    const para = flat(text.slice(start, text.indexOf("**Guard:**", start)));
    expect(para).toMatch(/automatically when a `@propose-review-N` role resolves/);
    expect(para).toMatch(/offered interactively only when none does/);
  });

  it("W3 plan-proposal step 1 asks for cited code claims in design.md", () => {
    const s = flat(step(read(PLAN_PROPOSAL), "1"));
    expect(s).toMatch(/cite the path \(and `:line` when the statement is line-specific\)/);
    expect(s).toMatch(/`design\.md` about existing code behaviour/);
  });

  it("W4 plan-proposal step 3 re-scans after the fold", () => {
    const s = flat(step(read(PLAN_PROPOSAL), "3"));
    expect(s).toMatch(/run `node scripts\/spec-collateral\.mjs --change <change>` once more after the fold/);
    expect(s).toMatch(/report every candidate not seen in the doubt-review cycles/);
    expect(s).toMatch(/real conflict among them returns planning to Step 2/);
    expect(s).toMatch(/"unaffected" only for a verified false positive/);
  });

  it("W5 doubt-driven-review templates carry verify / unverified / check-every-candidate", () => {
    for (const rel of [DOUBT, DOUBT_AGENT]) {
      const t = flat(read(rel));
      expect(t, rel).toMatch(/verify (each claim|claims) against the repository/i);
      expect(t, rel).toMatch(/write `unverified`/);
      expect(t, rel).toMatch(/check every candidate/i);
    }
  });
});
