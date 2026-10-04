/**
 * site-deploy-workflow-contract.test.ts — static contracts for change
 * fix-deploy-site-ship-shell. Pins the Deploy Site workflow
 * (`deploy-site.yml`), the sync workflow it depends on, and the site's
 * dependency-free manifest against silent rot:
 *
 *   E9  push trigger: develop only; paths cover site/** + packages/shell/**
 *   E10 the dead release path is absent (release: trigger, redispatch
 *       job, `github.event_name != 'release'` guards)
 *   E11 sync-release-version.yml pushes HEAD:develop, never main
 *   sync-release-version.yml declares no `release:` trigger in any YAML
 *       form, and keeps workflow_dispatch.inputs.correlation
 *       (change: fix-ci-pipeline-followups, test-plan E7–E10)
 *   E12 shell composed into site/dist/app/ before the Pages artifact upload
 *   E13 site/public/CNAME is exactly pi-dashboard.dev
 *   E14 workflow_dispatch stays available for manual redeploys
 *   E15 site/package.json declares no dependencies (the manifest half of
 *       the dependency-free pin; the workflow half — no `npm ci` returns —
 *       is pinned by pnpm-migration-contract.test.ts X6)
 *
 * NOT covered here (live infrastructure — test-plan manual-only F1–F6):
 * whether a dispatch actually fires a run, whether Pages serves /app/, or
 * whether the next release redeploys the site. These assertions parse
 * workflow FILES; only the next real release closes that loop.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const WF = path.join(REPO_ROOT, ".github", "workflows");
const read = (p: string) => fs.readFileSync(path.join(REPO_ROOT, p), "utf8");
const readWf = (name: string) => fs.readFileSync(path.join(WF, name), "utf8");

const deploySite = readWf("deploy-site.yml");
// Negative assertions run against comment-free content: a stale comment must
// never satisfy (or mask) a contract. Same pattern as
// pnpm-migration-contract.test.ts X6.
const deploySiteCode = deploySite
  .split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");

/** Extract the top-level `on:` trigger block of a workflow file. */
function extractOnBlock(yaml: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (start === -1) throw new Error("workflow has no top-level `on:` block");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    // Next top-level key (no leading whitespace) ends the trigger block.
    if (/^[a-zA-Z-]/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("E9 — deploy-site.yml push trigger targets develop with site+shell paths", () => {
  const onBlock = extractOnBlock(deploySiteCode);

  it("push branches is exactly [develop], never main", () => {
    const m = onBlock.match(/branches:\s*\[([^\]]*)\]/);
    expect(m, "push trigger must declare `branches: [develop]`").not.toBeNull();
    const branches = m![1].split(",").map((s) => s.trim().replace(/['"]/g, ""));
    expect(branches).toEqual(["develop"]);
    expect(branches, "deploying from main is not the contract here").not.toContain("main");
  });

  it("push paths include site/**, packages/shell/**, and the workflow itself", () => {
    for (const p of ['"site/**"', '"packages/shell/**"', '".github/workflows/deploy-site.yml"']) {
      expect(onBlock, `push paths must include ${p}`).toContain(p);
    }
  });
});

describe("E10 — the dead release path is absent from deploy-site.yml", () => {
  // GitHub suppresses workflow runs from events raised by the default Actions
  // token, so a `release:` trigger can never start a run here. Its presence
  // (and the redispatch machinery hanging off it) misleads readers into
  // believing the redeploy is automatic. See change: fix-deploy-site-ship-shell
  // (design D8).
  it("no `release:` trigger", () => {
    expect(deploySiteCode, "`release:` trigger must not return").not.toMatch(/^\s*release:\s*$/m);
  });

  it("no `redispatch-on-release` job", () => {
    expect(deploySiteCode, "redispatch-on-release job must not return").not.toContain(
      "redispatch-on-release",
    );
  });

  it("no job gated on `github.event_name != 'release'`", () => {
    expect(deploySiteCode, "dead release guard must not return").not.toContain(
      "github.event_name != 'release'",
    );
  });

  it("the release path is the publish.yml dispatch (cross-reference)", () => {
    const publish = readWf("publish.yml");
    expect(publish, "publish.yml must own the release path (site-redeploy job)").toContain(
      "site-redeploy:",
    );
  });
});

describe("E11 — sync-release-version.yml pushes HEAD:develop, never main", () => {
  const syncCode = readWf("sync-release-version.yml")
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

  it("push step targets HEAD:develop", () => {
    expect(syncCode, "sync must commit the download block back to develop").toContain(
      "git push origin HEAD:develop",
    );
  });

  it("no push targets main", () => {
    expect(syncCode, "a HEAD:main push would fight the develop contract").not.toMatch(
      /git push[^\n]*main/,
    );
  });
});

/**
 * Throw (naming `file`) when `release` is a trigger under the top-level `on:`
 * key, in ANY YAML spelling — block / flow mapping key, block / flow sequence
 * item, bare scalar, quoted, commented. The workflow is PARSED (the `yaml`
 * dependency, YAML 1.2 so `on` stays a string key): a regex over the text
 * missed a new spelling every review round. E10's `/^\s*release:\s*$/m` on
 * deploy-site.yml is block-key-only.
 */
function assertNoReleaseTrigger(file: string, yaml: string): void {
  const doc = parseYaml(yaml) as Record<string, unknown> | null;
  if (!doc || !("on" in doc)) throw new Error(`${file}: no top-level \`on:\` key`);
  const on = doc.on;
  const events =
    typeof on === "string"
      ? [on]
      : Array.isArray(on)
        ? on.map(String)
        : on && typeof on === "object"
          ? Object.keys(on)
          : [];
  if (events.includes("release")) {
    throw new Error(
      `${file}: \`release:\` trigger must not return — a GITHUB_TOKEN commit from this run cannot start deploy-site.yml, so the run it starts is incomplete (dispatch sync-release-version, then deploy-site). See change: fix-ci-pipeline-followups.`,
    );
  }
}

describe("sync-release-version.yml has no release-event trigger (change: fix-ci-pipeline-followups)", () => {
  const FILE = "sync-release-version.yml";
  const tail = `  workflow_dispatch:\n    inputs:\n      correlation:\n        type: string\n\npermissions:\n  contents: write\n`;

  it("E7: block form is refused, naming the workflow", () => {
    const yaml = `name: x\non:\n  release:\n    types: [published, edited]\n${tail}`;
    expect(() => assertNoReleaseTrigger(FILE, yaml)).toThrow(FILE);
  });

  it("E8: inline-mapping form is refused", () => {
    expect(() =>
      assertNoReleaseTrigger(FILE, `name: x\non: {release: [published]}\njobs: {}\n`),
    ).toThrow(FILE);
    // The E10 block-form-only regex misses this shape.
    expect(`on: {release: [published]}`).not.toMatch(/^\s*release:\s*$/m);
  });

  it("E9: sequence form is refused", () => {
    expect(() => assertNoReleaseTrigger(FILE, `name: x\non: [release]\njobs: {}\n`)).toThrow(
      FILE,
    );
    expect(() =>
      assertNoReleaseTrigger(FILE, `name: x\non: [push, release]\njobs: {}\n`),
    ).toThrow(FILE);
  });

  it("quoted forms are refused too (block key, inline-mapping key, sequence item)", () => {
    for (const yaml of [
      `name: x\non:\n  'release':\n    types: [published]\n${tail}`,
      `name: x\non:\n  "release":\n${tail}`,
      `name: x\non: {'release': [published]}\njobs: {}\n`,
      `name: x\non: {"release": [published]}\njobs: {}\n`,
      `name: x\non: ['release']\njobs: {}\n`,
      `name: x\non: [push, "release"]\njobs: {}\n`,
      `name: x\non: release\njobs: {}\n`,
    ]) {
      expect(() => assertNoReleaseTrigger(FILE, yaml), yaml).toThrow(FILE);
    }
  });

  it("block-sequence form is refused (on:\n  - release)", () => {
    for (const yaml of [
      `name: x\non:\n  - workflow_dispatch\n  - release\njobs: {}\n`,
      `name: x\non:\n  - "release"\njobs: {}\n`,
      `name: x\non:\n- release\njobs: {}\n`,
    ]) {
      expect(() => assertNoReleaseTrigger(FILE, yaml), yaml).toThrow(FILE);
    }
    expect(() =>
      assertNoReleaseTrigger(FILE, `name: x\non:\n  - workflow_dispatch\njobs: {}\n`),
    ).not.toThrow();
  });

  it("trailing comments do not hide the trigger", () => {
    for (const yaml of [
      `name: x\non:\n  - workflow_dispatch\n  - release # published\njobs: {}\n`,
      `name: x\non:\n  release: # published only\n    types: [published]\n${tail}`,
      `name: x\non: [release] # legacy\njobs: {}\n`,
    ]) {
      expect(() => assertNoReleaseTrigger(FILE, yaml), yaml).toThrow(FILE);
    }
  });

  it("does not misfire on a release-named branch filter", () => {
    expect(() =>
      assertNoReleaseTrigger(
        FILE,
        `name: x\non:\n  push:\n    branches:\n      - release/**\n      - release-1\n${tail}`,
      ),
    ).not.toThrow();
    expect(() =>
      assertNoReleaseTrigger(FILE, `name: x\non: {push: {branches: [release-1, release/x]}}\n`),
    ).not.toThrow();
  });

  it("does not misfire on dispatch-only triggers", () => {
    expect(() => assertNoReleaseTrigger(FILE, `name: x\non:\n${tail}`)).not.toThrow();
    expect(() => assertNoReleaseTrigger(FILE, `name: x\non: [workflow_dispatch]\n`)).not.toThrow();
  });

  it("the shipped workflow declares no release trigger", () => {
    expect(() => assertNoReleaseTrigger(FILE, readWf(FILE))).not.toThrow();
  });

  it("E10: workflow_dispatch.inputs.correlation survives the removal", () => {
    const onBlock = extractOnBlock(readWf(FILE));
    expect(onBlock, `${FILE}: workflow_dispatch must stay`).toMatch(/^\s+workflow_dispatch:\s*$/m);
    expect(onBlock, `${FILE}: the correlation input publish.yml binds to must stay`).toMatch(
      /^\s+inputs:\s*\n\s+correlation:\s*$/m,
    );
  });
});

describe("E12 — shell is composed into site/dist/app/ before the artifact upload", () => {
  const buildMarker = "Build neutral shell";
  const copyMarker = "Copy shell into site artifact under /app";
  const uploadMarker = "actions/upload-pages-artifact";
  const idx = (needle: string) => deploySiteCode.indexOf(needle);

  it("steps exist and are ordered build → copy → upload", () => {
    const iBuild = idx(buildMarker);
    const iCopy = idx(copyMarker);
    const iUpload = idx(uploadMarker);
    expect(iBuild, `\`${buildMarker}\` step missing`).toBeGreaterThanOrEqual(0);
    expect(iCopy, `\`${copyMarker}\` step missing`).toBeGreaterThan(iBuild);
    expect(iUpload, `\`${uploadMarker}\` step missing`).toBeGreaterThan(iCopy);
  });

  it("the copy lands the shell under site/dist/app/", () => {
    expect(deploySiteCode).toMatch(/cp -r packages\/shell\/dist\/\* site\/dist\/app\//);
  });
});

describe("E13 — site/public/CNAME is exactly pi-dashboard.dev", () => {
  it("CNAME contents match the custom domain", () => {
    // Guards silent deletion: without this file the site reverts to a
    // github.io host with every build still green.
    const cname = read("site/public/CNAME").trim();
    expect(cname).toBe("pi-dashboard.dev");
  });
});

describe("E14 — manual redeploy stays available", () => {
  it("workflow_dispatch is present in the on: block", () => {
    const onBlock = extractOnBlock(deploySiteCode);
    expect(onBlock, "workflow_dispatch must not disappear — manual redeploys depend on it").toContain(
      "workflow_dispatch:",
    );
  });
});

describe("E15 — site/package.json stays dependency-free", () => {
  // The static page has a zero-dependency manifest; its build is a copy +
  // reference check. A dependency sneaking back in without an install
  // strategy + lockfile guard would resurrect the npm ci drift failure class
  // this repo already lived through. See change: fix-deploy-site-ship-shell
  // (spec ci-cd-pipeline "The marketing site stays dependency-free").
  const pkg = JSON.parse(read("site/package.json")) as Record<
    string,
    Record<string, string> | undefined
  >;

  for (const map of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    it(`${map} is absent or empty`, () => {
      const deps = pkg[map];
      if (deps === undefined) return; // absent is fine
      expect(
        Object.keys(deps),
        `${map} must stay empty — reintroducing site dependencies requires an install strategy and a lockfile-drift guard in the same change`,
      ).toEqual([]);
    });
  }

  it("no site lockfile exists to drift", () => {
    expect(
      fs.existsSync(path.join(REPO_ROOT, "site", "package-lock.json")),
      "site/package-lock.json must not return without the dependency-free pin being revisited",
    ).toBe(false);
  });
});
