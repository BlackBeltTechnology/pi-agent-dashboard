/**
 * Repo-lint: every vitest job in `ci.yml` uploads its JSON report on EVERY run
 * (changes: isolate-real-process-tests D3; speed-up-ci-affected-tests D5).
 *
 * The real-process phase retries once under CI. A retry that is not
 * attributable is a silent pass, so the report must reach the run page —
 * including (especially) on a red run, hence `if: always()`. A retried pass
 * shows there as `status: "passed"` with a retained `failureMessages` entry
 * (vitest 4 has no `retryCount` field).
 *
 * With the suite split across parallel jobs, each job and each unit shard
 * uploads under its OWN name — one shared name would make the uploads collide.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
type Step = { uses?: string; if?: string; with?: Record<string, unknown> };
const CI = parseYaml(fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8")) as {
  jobs: Record<string, { steps?: Step[] }>;
};

function reportUpload(job: string): Step {
  const step = (CI.jobs[job]?.steps ?? []).find(
    (s) => s.uses?.startsWith("actions/upload-artifact@") && String(s.with?.name).startsWith("vitest-report"),
  );
  expect(step, `${job} must upload its vitest JSON report`).toBeDefined();
  return step as Step;
}

describe("ci.yml — vitest JSON report artifact per job and shard", () => {
  const cases = [
    ["unit", /^vitest-report-unit-\$\{\{\s*matrix\.shard\s*\}\}$/, /test-results\/vitest\.json/],
    ["real-process", /^vitest-report-real-process$/, /test-results\/vitest-real-process\.json/],
    ["ci-scenarios", /^vitest-report-ci-scenarios$/, /test-results\/vitest\.json/],
  ] as const;

  for (const [job, name, file] of cases) {
    it(`${job} uploads under its own name`, () => {
      expect(String(reportUpload(job).with?.name)).toMatch(name);
    });

    it(`${job} uploads on failure too (\`if: always()\`)`, () => {
      expect(reportUpload(job).if, "the artifact must be attached on a RED run").toMatch(/always\(\)/);
    });

    it(`${job} uploads the vitest JSON report path`, () => {
      expect(String(reportUpload(job).with?.path)).toMatch(file);
    });
  }
});
