/**
 * Repo-level safety contract for the nightly Verdaccio build (change:
 * add-nightly-verdaccio-build, task 5).
 *
 * The nightly's hard requirement is ZERO public npm writes and NO release
 * side effects. This test locks that as a repo-lint so a future edit cannot
 * silently turn the nightly into a real release:
 *
 *   nightly.yml:
 *     - every `npm publish` MUST be `--dry-run` OR carry
 *       `--registry http://localhost` (a dry-run writes nothing; the REAL
 *       publishes live in scripts/nightly-verdaccio-publish.mjs and target
 *       http://localhost:4873);
 *     - NO `softprops/action-gh-release` (no GitHub Release);
 *     - NO tag `git push`;
 *     - NO version-bump `git commit`.
 *
 *   _electron-build.yml:
 *     - the pre-existing "pure artifact producer" invariant is UNTOUCHED by
 *       the `registry_url` addition: still no `npm publish`, no Release,
 *       no tag push.
 *
 * If this test fails, the nightly is at risk of polluting public npm or
 * cutting an unintended Release — revert the offending line.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const NIGHTLY = path.join(REPO_ROOT, ".github", "workflows", "nightly.yml");
const ELECTRON_BUILD = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "_electron-build.yml",
);

/** Non-comment lines only (drops YAML full-line `#` comments). */
function codeLines(yaml: string): string[] {
  return yaml.split("\n").filter((l) => !/^\s*#/.test(l));
}

describe("nightly.yml — zero-public-write safety contract", () => {
  const yaml = fs.readFileSync(NIGHTLY, "utf8");
  const lines = codeLines(yaml);

  it("every `npm publish` is --dry-run or targets a loopback registry", () => {
    const offenders = lines.filter(
      (l) =>
        /npm\s+publish/.test(l) &&
        !/--dry-run/.test(l) &&
        !/--registry\s+http:\/\/localhost/.test(l),
    );
    expect(
      offenders,
      "nightly.yml has an `npm publish` that could reach public npm — it must " +
        "be `--dry-run` or carry `--registry http://localhost`. Offending line(s):\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("contains no GitHub Release action", () => {
    const offenders = lines.filter((l) => /softprops\/action-gh-release/.test(l));
    expect(offenders, "nightly.yml must not create a GitHub Release").toEqual([]);
  });

  it("contains no tag `git push`", () => {
    const offenders = lines.filter(
      (l) => /git\s+push/.test(l) && !/--dry-run/.test(l),
    );
    expect(
      offenders,
      "nightly.yml must not push a tag/branch. Offending line(s):\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("contains no version-bump `git commit`", () => {
    const offenders = lines.filter((l) => /git\s+commit/.test(l));
    expect(
      offenders,
      "nightly.yml must not commit a version bump. Offending line(s):\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the electron job drives Verdaccio via a loopback registry_url", () => {
    // Positive assertion: the round-trip mechanism is present and loopback.
    const m = yaml.match(/^\s+registry_url:\s*(\S+)\s*$/m);
    expect(m, "electron job must pass registry_url to _electron-build.yml").toBeTruthy();
    expect(m?.[1]).toMatch(/^http:\/\/localhost(:\d+)?$/);
  });
});

describe("_electron-build.yml — pure-artifact-producer invariant (untouched by registry_url)", () => {
  const yaml = fs.readFileSync(ELECTRON_BUILD, "utf8");
  const lines = codeLines(yaml);

  it("contains no `npm publish` (the reusable build never publishes)", () => {
    const offenders = lines.filter((l) => /npm\s+publish/.test(l));
    expect(
      offenders,
      "_electron-build.yml must not publish to any registry. The nightly " +
        "publishes via scripts/nightly-verdaccio-publish.mjs, not the reusable " +
        "workflow. Offending line(s):\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("contains no GitHub Release action", () => {
    const offenders = lines.filter(
      (l) =>
        /softprops\/action-gh-release/.test(l) || /actions\/create-release/.test(l),
    );
    expect(offenders, "_electron-build.yml must not create a Release").toEqual([]);
  });

  it("contains no tag `git push`", () => {
    const offenders = lines.filter((l) => /git\s+push\s+origin\s+v/.test(l));
    expect(offenders, "_electron-build.yml must not push a tag").toEqual([]);
  });
});
