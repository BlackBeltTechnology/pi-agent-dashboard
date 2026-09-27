/**
 * Repo-lint (#E37): `ci.yml` runs the quick-tier Python suites of music-production
 * and video-production footage-redaction in a `music-pytest` job, and never
 * installs the multi-GB deep tier there. See change: add-music-production-skills.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
const CI = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");

/** The `music-pytest:` job block (to the next top-level job or EOF). */
function job(): string {
  const start = CI.search(/^ {2}music-pytest:\s*$/m);
  expect(start, "ci.yml must define a music-pytest job").toBeGreaterThan(-1);
  const rest = CI.slice(start + 1);
  const next = rest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
  return next === -1 ? CI.slice(start) : CI.slice(start, start + 1 + next);
}

describe("ci.yml — music-pytest job", () => {
  it("installs uv and the quick-tier requirements", () => {
    const j = job();
    expect(j).toMatch(/uses:\s*astral-sh\/setup-uv@/);
    expect(j).toMatch(/uv venv -p 3\.14/);
    expect(j).toMatch(/uv pip install -r packages\/music-production\/requirements-core\.txt pytest/);
  });

  it("runs pytest on both suites", () => {
    const j = job();
    expect(j).toMatch(/pytest[^\n]*packages\/music-production\/tests/);
    expect(j).toMatch(/pytest[^\n]*packages\/video-production\/tests\/redaction/);
  });

  it("never installs the deep tier", () => {
    expect(job()).not.toMatch(/requirements-mir/);
  });
});
