/**
 * claude-plugin-publish-contract.test.mjs — static contract for how the
 * release pipeline treats the Claude plugin (`publish.yml`).
 *
 *  - E43: the `publish` job reads the TAGGED `plugin.json` version in a
 *    preflight step ordered before `sync-versions.js` (which rewrites the
 *    working copy and would mask a stale tag) and before any publish step.
 *  - E46: the `github-release` job builds the plugin zip before creating the
 *    release and attaches it.
 *
 * See change: add-claude-code-plugin (design D9, D10).
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const publishYml = fs.readFileSync(path.resolve(here, "../../.github/workflows/publish.yml"), "utf-8");

/** Text of one top-level job (from `  <name>:` to the next top-level job). */
function jobBlock(name) {
  const start = publishYml.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  expect(start, `job ${name}`).toBeGreaterThan(-1);
  const rest = publishYml.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][\w-]*:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("publish job: tagged plugin version preflight (E43)", () => {
  const job = jobBlock("publish");
  const preflight = job.indexOf('git show "$RELEASE_TAG:packages/claude-plugin/.claude-plugin/plugin.json"');

  it("reads the tagged plugin.json with git show", () => {
    expect(preflight).toBeGreaterThan(-1);
    expect(job).toContain("RELEASE_TAG: ${{ needs.resolve.outputs.tag }}");
  });

  it("runs before sync-versions.js and before any version stamp or publish step", () => {
    const sync = job.indexOf("node scripts/sync-versions.js");
    const stamp = job.indexOf("npm pkg set version=");
    const publishStep = job.indexOf("Publish to npm");
    expect(sync).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(sync);
    expect(preflight).toBeLessThan(stamp);
    expect(preflight).toBeLessThan(publishStep);
  });

  it("compares against the resolved release version", () => {
    expect(job).toContain("needs.resolve.outputs.version");
  });
});

describe("github-release job: plugin zip asset (E46)", () => {
  const job = jobBlock("github-release");

  it("builds the zip before creating the release", () => {
    const build = job.indexOf("node scripts/build-claude-plugin-zip.mjs");
    const create = job.indexOf("Create GitHub Release");
    expect(build).toBeGreaterThan(-1);
    expect(build).toBeLessThan(create);
  });

  it("attaches the zip through the release files", () => {
    const create = job.slice(job.indexOf("Create GitHub Release"));
    expect(create).toContain("claude-plugin-dist/*.zip");
    expect(create).toContain("electron-*/**/*");
  });
});
