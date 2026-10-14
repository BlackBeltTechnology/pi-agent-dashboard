/**
 * Static wiring guard: ship-it documents the CodeQL ratchet (test-plan #E30).
 *
 * Step 4.4 invokes the static baseline-diff check; step 4.4b — between 4.4 and
 * 4.5 — runs the analysis, prune, per-alert questions, accept and the closing
 * gate, and never spends a model call. Whether a live agent obeys the text is
 * manual QA (test-plan M1–M3).
 *
 * See change: add-local-codeql-ratchet.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const skill = fs.readFileSync(path.join(repoRoot, ".pi", "skills", "ship-it", "SKILL.md"), "utf-8");
const flat = (s: string) => s.replace(/\s+/g, " ");

/** Body of the `### <id>.` section up to the next `### ` / `## ` heading. */
function section(id: string): string {
  const start = skill.search(new RegExp(`^### ${id}\\. `, "m"));
  expect(start, `step ${id} heading`).toBeGreaterThanOrEqual(0);
  const rest = skill.slice(skill.indexOf("\n", start) + 1);
  const end = rest.search(/^##+ /m);
  return end === -1 ? rest : rest.slice(0, end);
}
const at = (re: RegExp) => skill.search(re);

describe("ship-it CodeQL wiring (#E30)", () => {
  it("step 4.4 lists the static baseline-diff check", () => {
    expect(section("4.4")).toContain("node scripts/codeql-local.mjs --check-baseline-diff origin/develop");
  });

  it("step 4.4b sits between 4.4 and 4.5", () => {
    const a = at(/^### 4\.4\. /m);
    const b = at(/^### 4\.4b\. /m);
    const c = at(/^### 4\.5\. /m);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("step 4.4b names the modes, the gates and the stop conditions", () => {
    const s = flat(section("4.4b"));
    for (const needle of [
      "--prune",
      "--accept",
      "ask_user",
      "--no-growth",
      "SHIP_IT_BLOCKED.md",
      "retry / abort",
      "revert / abort",
      "Accepts before fixes",
      "No model call",
      "--check-baseline-diff origin/develop",
    ]) {
      expect(s, needle).toContain(needle);
    }
  });

  it("offers the operator-authz preset for exactly the three rules", () => {
    const s = flat(section("4.4b"));
    for (const rule of ["js/path-injection", "js/command-line-injection", "js/shell-command-constructed-from-input"]) {
      expect(s, rule).toContain(rule);
    }
    expect(s).not.toContain("js/request-forgery");
    expect(s).toContain("operator-authz");
  });

  it("only edits the baseline through --prune and --accept", () => {
    expect(flat(section("4.4b"))).toMatch(/only through `--prune` and `--accept`/);
  });

  it("step 4.5 runs only after 4.4b passes or skips", () => {
    expect(flat(section("4.5"))).toMatch(/only after step 4\.4b passes or skips/);
  });

  it("guardrails and the escape hatch cover 4.4b", () => {
    expect(flat(skill)).toMatch(/CodeQL \(4\.4b\) gates 4\.5/);
    expect(flat(section("5"))).toMatch(/headless\*\* step-4\.4b stop/);
  });
});
