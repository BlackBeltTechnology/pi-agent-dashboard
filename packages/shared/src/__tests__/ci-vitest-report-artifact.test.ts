/**
 * Repo-lint: `ci.yml` uploads the vitest JSON report on EVERY run (change:
 * isolate-real-process-tests, D3).
 *
 * The real-process phase retries once under CI. A retry that is not
 * attributable is a silent pass, so the report must reach the run page —
 * including (especially) on a red run, hence `if: always()`. A retried pass
 * shows there as `status: "passed"` with a retained `failureMessages` entry
 * (vitest 4 has no `retryCount` field).
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
const CI = fs.readFileSync(
  path.join(REPO_ROOT, ".github", "workflows", "ci.yml"),
  "utf8",
);

/** The step block that starts at the `- run: pnpm test` line, to EOF. */
function afterUnitTestStep(yaml: string): string {
  const idx = yaml.search(/^\s*-\s+run:\s*pnpm test\s*$/m);
  expect(idx, "ci.yml must run the unit suite via `pnpm test`").toBeGreaterThan(-1);
  return yaml.slice(idx);
}

/**
 * The whole upload-artifact STEP (from its leading `-` to the next one), so an
 * `if:` written above `uses:` is still inside the slice.
 */
function artifactStep(): string {
  const tail = afterUnitTestStep(CI);
  const at = tail.search(/uses:\s*actions\/upload-artifact@/);
  expect(at, "no upload-artifact step follows `pnpm test`").toBeGreaterThan(-1);
  const start = tail.lastIndexOf("\n      - ", at);
  const nextRel = tail.slice(at).search(/\n {6}- /);
  const end = nextRel === -1 ? tail.length : at + nextRel;
  return tail.slice(start, end);
}

describe("ci.yml — vitest JSON report artifact", () => {
  it("an upload-artifact step follows `pnpm test`", () => {
    expect(afterUnitTestStep(CI)).toMatch(/uses:\s*actions\/upload-artifact@/);
  });

  it("the upload runs on failure too (`if: always()`)", () => {
    expect(
      artifactStep(),
      "the artifact must be attached on a RED run — that is the run you need it for",
    ).toMatch(/if:\s*always\(\)/);
  });

  it("the uploaded path covers the vitest JSON report", () => {
    expect(artifactStep()).toMatch(/test-results\/vitest\*?\.json/);
  });
});
