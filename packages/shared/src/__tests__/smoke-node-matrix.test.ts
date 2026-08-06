/**
 * Repo-lint — the CI install-smoke matrix covers every SUPPORTED Node major.
 *
 * `_smoke.yml`'s `standalone-install-smoke-linux` is the only Node-major matrix
 * the `server-startup-node-version-guard` spec enforces (`ci.yml` carries a
 * single `node-version: 22` setup-node step and no matrix). Raising the engines
 * cap without adding the matching leg would ship an *asserted* but unvalidated
 * major — exactly the failure mode issue #357 exposed.
 *
 * SUPPORTED ≠ admitted. The range `>=22.19.0 <27` also admits 23, which is EOL
 * and deliberately unlisted; the invariant is against the declared supported
 * set below, not against every major the range permits.
 *
 * A NEW file rather than an extension of `publish-workflow-contract.test.ts` —
 * that file covers `publish.yml` + `_electron-build.yml` and asserts nothing
 * about `_smoke.yml`.
 *
 * Parsed with the repo's established job-body line-slicing helper, NOT a YAML
 * library: `packages/shared` declares no `yaml` dependency, so an import would
 * resolve only by hoisting from `packages/client` — the exact fragile implicit
 * resolution this change removes for `tsx`. `publish-workflow-contract.test.ts`
 * documents the same deliberate convention for these stable 2-space-indent
 * workflow files.
 *
 * See change: fix-pi-install-node26-and-omit-dev-build (test-plan #E8).
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const SMOKE_WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "_smoke.yml");

const JOB = "standalone-install-smoke-linux";

/**
 * Node majors this repo commits to validating in the install smoke. Update
 * together with root `package.json#engines.node` and the `_smoke.yml` matrix.
 */
const SUPPORTED_NODE_MAJORS = [22, 24, 25, 26];

/** Job-body slice — same helper shape as `publish-workflow-contract.test.ts`. */
function extractJobBlock(yaml: string, jobName: string): string {
  const lines = yaml.split("\n");
  const headerRe = new RegExp(`^  ${jobName}:\\s*$`);
  const start = lines.findIndex((l) => headerRe.test(l));
  if (start === -1) {
    throw new Error(`job '${jobName}' not found in _smoke.yml`);
  }
  const siblingRe = /^  [a-z][a-z0-9-]*:\s*$/;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (siblingRe.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("_smoke.yml install matrix covers every supported Node major", () => {
  const yaml = fs.readFileSync(SMOKE_WORKFLOW_PATH, "utf8");
  const jobBlock = extractJobBlock(yaml, JOB);

  const majors = [...jobBlock.matchAll(/^\s*node-version:\s*(\d+)\s*$/gm)].map((m) =>
    Number(m[1]),
  );

  it("declares at least one leg per supported major", () => {
    expect(
      majors.length,
      `No \`node-version:\` scalars found in the ${JOB} matrix. Did the matrix ` +
        "shape change? Update this lint together with the workflow.",
    ).toBeGreaterThan(0);

    expect(
      [...new Set(majors)].sort((a, b) => a - b),
      `The ${JOB} matrix must cover exactly the supported Node majors ` +
        `${SUPPORTED_NODE_MAJORS.join(", ")}. Raising ` +
        "`package.json#engines.node` requires adding the matching smoke legs " +
        "(and this list) in the same change.",
    ).toEqual(SUPPORTED_NODE_MAJORS);
  });

  it("keeps the supported set inside the declared engines range", () => {
    const range = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"),
    ).engines.node;
    const m = String(range).match(/>=(\d+)\.\d+\.\d+\s+<(\d+)/);

    expect(m, `Unexpected engines.node shape: "${range}"`).not.toBeNull();
    const [floorMajor, capMajor] = [Number(m?.[1]), Number(m?.[2])];

    const outside = SUPPORTED_NODE_MAJORS.filter(
      (major) => major < floorMajor || major >= capMajor,
    );

    expect(
      outside,
      `SUPPORTED_NODE_MAJORS lists majors outside package.json#engines.node ` +
        `("${range}"): ${outside.join(", ")}. The smoke matrix must not claim ` +
        "to validate a Node the manifest refuses.",
    ).toEqual([]);
  });
});
