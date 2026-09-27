/**
 * CI placement contract for the post-build publish-imports run (test-plan #X3).
 *
 * The first `verify-published-imports.mjs` step runs on an UNBUILT tree, so the
 * root meta-package's shipped `packages/dist/` bundle output is never analysed
 * there. A second run after `Build (fail on regressed warnings)` covers it on
 * every PR. This locks that ordering as a repo-lint, so moving or dropping the
 * step fails here instead of silently shipping unchecked bundle bytes.
 *
 * See change: check-root-package-imports.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const CI = path.join(REPO_ROOT, ".github", "workflows", "ci.yml");

/** Non-comment lines of the `ci:` job only (up to the next top-level job key). */
function ciJobLines(yaml: string): string[] {
  const lines = yaml.split("\n").filter((l) => !/^\s*#/.test(l));
  const start = lines.findIndex((l) => /^ {2}ci:\s*$/.test(l));
  expect(start, "ci.yml has a `ci:` job").toBeGreaterThanOrEqual(0);
  const next = lines.findIndex((l, i) => i > start && /^ {2}[\w-]+:\s*$/.test(l));
  return lines.slice(start, next === -1 ? undefined : next);
}

describe("#X3 ci job re-runs verify-published-imports after the build", () => {
  const lines = ciJobLines(fs.readFileSync(CI, "utf8"));
  const build = lines.findIndex((l) => /- name: Build \(fail on regressed warnings\)/.test(l));
  const checks = lines.flatMap((l, i) => (/run: node scripts\/verify-published-imports\.mjs\s*$/.test(l) ? [i] : []));

  it("has the build step", () => {
    expect(build).toBeGreaterThanOrEqual(0);
  });

  it("runs the checker both before and after the build", () => {
    expect(checks.some((i) => i < build), "pre-build (unbuilt-tree) run").toBe(true);
    expect(checks.some((i) => i > build), "post-build (built-tree) run").toBe(true);
  });
});
