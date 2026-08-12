/**
 * CI placement contract for the dead-code oracle (test-plan #X1, #X2, #X3).
 *
 * The whole-graph scan belongs in nightly, NOT in ci.yml: its verdict does not
 * depend on a PR's diff, and its runtime has no business sitting on the PR
 * path. This locks that placement as a repo-lint, so a later "let's just add it
 * to CI" edit fails here instead of silently taxing every pull request.
 *
 * The corollary the wording must respect: nightly runs after merge, so this job
 * DETECTS a regression. The job that PREVENTS one is the ship-it enforcer.
 *
 * See change: add-knip-dead-code-oracle.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const workflow = (name: string) => path.join(REPO_ROOT, ".github", "workflows", name);

/** Non-comment lines only (drops YAML full-line `#` comments). */
function codeLines(yaml: string): string[] {
  return yaml.split("\n").filter((l) => !/^\s*#/.test(l));
}

describe("#X1 ci.yml does not run the whole-graph scan", () => {
  const lines = codeLines(fs.readFileSync(workflow("ci.yml"), "utf8"));

  it("invokes no knip step", () => {
    const offenders = lines.filter((l) => /\bknip\b/.test(l));
    expect(offenders).toEqual([]);
  });
});

describe("#X2/#X3 nightly.yml runs the ratchet", () => {
  const yaml = fs.readFileSync(workflow("nightly.yml"), "utf8");
  const lines = codeLines(yaml);

  it("#X2 declares a knip job", () => {
    expect(yaml).toMatch(/^ {2}knip:$/m);
  });

  it("#X2 invokes the ratchet script", () => {
    expect(lines.some((l) => l.includes("node scripts/knip-ratchet.mjs"))).toBe(true);
  });

  it("#X3 verifies the config before trusting the verdict", () => {
    // An unrooted graph reports live files as dead; a ratchet over that number
    // gates noise. Measured: unrooted 723 findings / 90 unused files vs rooted
    // 437 / 10.
    expect(lines.some((l) => l.includes("node scripts/knip-config.mjs"))).toBe(true);
  });

  it("#X3 does not suppress the regression with continue-on-error", () => {
    const knipJob = yaml.slice(yaml.indexOf("\n  knip:"));
    const jobBody = knipJob.slice(0, knipJob.indexOf("\n  electron:"));
    expect(jobBody).not.toMatch(/continue-on-error:\s*true/);
  });
});
