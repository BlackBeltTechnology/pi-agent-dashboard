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

  it("E10: workflow_dispatch is the sole trigger and owns inputs.correlation", () => {
    const wf = parseYaml(readWf(FILE)) as { on?: Record<string, unknown> };
    expect(Object.keys(wf.on ?? {}), `${FILE}: workflow_dispatch must be the only trigger`).toEqual([
      "workflow_dispatch",
    ]);
    const dispatch = wf.on?.workflow_dispatch as { inputs?: Record<string, unknown> } | undefined;
    expect(dispatch?.inputs, `${FILE}: the correlation input publish.yml binds to must stay`).toHaveProperty(
      "correlation",
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

// ─────────────────────────────────────────────────────────────────────────────
// #579 — the deploy stops depending on ONE trigger (change: add-missing-ci-legs,
// design D6). deploy-site.yml writes a source-SHA marker and publishes from
// develop only; site-drift-check.yml (daily) dispatches a deploy when the live
// site is behind. The pure check takes the two workflow texts so every variant
// is exercised on a mutated copy.
// ─────────────────────────────────────────────────────────────────────────────

type WfJob = { if?: string; needs?: unknown; permissions?: unknown; concurrency?: unknown; steps?: Array<Record<string, any>> };
type Wf = { on?: any; permissions?: unknown; concurrency?: unknown; jobs?: Record<string, WfJob> };

const driftCheck = readWf("site-drift-check.yml");
const driftScript = read("scripts/site-drift-decision.mjs");

export function siteDriftViolations(deployYaml: string, driftYaml: string, script: string): string[] {
  const out: string[] = [];
  const deploy = parseYaml(deployYaml) as Wf;
  const drift = parseYaml(driftYaml) as Wf;

  // ── deploy-site.yml ──
  const build = deploy.jobs?.build;
  const steps = build?.steps ?? [];
  const markerAt = steps.findIndex((s) => /deploy-sha\.txt/.test(String(s.run ?? "")));
  const uploadAt = steps.findIndex((s) => /upload-pages-artifact/.test(String(s.uses ?? "")));
  if (markerAt === -1) out.push("deploy-site.yml build: no marker step writing deploy-sha.txt");
  else {
    if (uploadAt !== -1 && markerAt > uploadAt) out.push("deploy-site.yml build: marker step runs after upload-pages-artifact (would not ship)");
    if (!String(steps[markerAt].run).includes("${{ github.sha }}")) out.push("deploy-site.yml build: marker must be `${{ github.sha }}`, not a literal");
  }
  if (String(build?.if ?? "").trim() !== "github.ref == 'refs/heads/develop'") out.push("deploy-site.yml build: `if:` must be exactly `github.ref == 'refs/heads/develop'`");
  const needs = ([] as unknown[]).concat(deploy.jobs?.deploy?.needs ?? []);
  if (!needs.includes("build")) out.push("deploy-site.yml deploy: must `needs: build` so a non-develop dispatch skips it too");
  const paths: string[] = deploy.on?.push?.paths ?? [];
  for (const p of ["site/**", "!site/design-scratch/**", "packages/shell/**", ".github/workflows/deploy-site.yml"]) {
    if (!paths.includes(p)) out.push(`deploy-site.yml on.push.paths: missing \`${p}\``);
  }

  // ── site-drift-check.yml ──
  const schedule: Array<{ cron?: string }> = drift.on?.schedule ?? [];
  if (schedule.length !== 1) out.push(`site-drift-check.yml on.schedule: exactly one entry required (got ${schedule.length})`);
  else if (!/^\d{1,2} \d{1,2} \* \* \*$/.test(String(schedule[0].cron))) out.push(`site-drift-check.yml on.schedule: cron \`${schedule[0].cron}\` is not a single daily entry (M H * * *)`);
  if (!drift.on || !("workflow_dispatch" in drift.on)) out.push("site-drift-check.yml on: workflow_dispatch missing");
  if (JSON.stringify(drift.permissions) !== JSON.stringify({ contents: "read" })) out.push("site-drift-check.yml top-level permissions must be exactly {contents: read}");
  const jobs = Object.entries(drift.jobs ?? {});
  if (jobs.length !== 1) out.push("site-drift-check.yml: expected exactly one job");
  for (const [id, job] of jobs) {
    const perms = job.permissions as Record<string, string> | undefined;
    const keys = Object.keys(perms ?? {}).sort().join(",");
    if (keys !== "actions,contents" || perms?.contents !== "read" || perms?.actions !== "write") {
      out.push(`site-drift-check.yml job ${id}: permissions must be exactly {contents: read, actions: write} (got ${JSON.stringify(perms)})`);
    }
    if (job.concurrency !== undefined) out.push(`site-drift-check.yml job ${id}: must not join a concurrency group (pages-deploy cancels)`);
    for (const s of job.steps ?? []) {
      if (/actions\/setup-node/.test(String(s.uses ?? "")) && s.with?.cache) out.push(`site-drift-check.yml job ${id}: setup-node cache in a release-privileged job`);
      if (/actions\/cache/.test(String(s.uses ?? ""))) out.push(`site-drift-check.yml job ${id}: actions/cache in a release-privileged job`);
    }
    if (!(job.steps ?? []).some((s) => /node scripts\/site-drift-decision\.mjs/.test(String(s.run ?? "")))) {
      out.push(`site-drift-check.yml job ${id}: does not run scripts/site-drift-decision.mjs`);
    }
  }
  if (drift.concurrency !== undefined) out.push("site-drift-check.yml: top-level concurrency forbidden (must stay outside `pages-deploy`)");
  if (!/arg\("workflow", "deploy-site\.yml"\)/.test(script) || !/arg\("dispatch-ref", "develop"\)/.test(script) || !/"workflow", "run", workflow, "--ref", dispatchRef/.test(script)) {
    out.push("scripts/site-drift-decision.mjs: must dispatch `gh workflow run deploy-site.yml --ref develop`");
  }
  return out;
}

describe("#579 — deploy marker, develop-only publish, daily drift check", () => {
  const check = (d = deploySite, c = driftCheck, s = driftScript) => siteDriftViolations(d, c, s);
  const mutate = (text: string, from: string | RegExp, to: string): string => {
    const next = text.replace(from, to);
    expect(next, "fixture mutation did not change the workflow").not.toBe(text);
    return next;
  };

  it("the real workflows satisfy the whole contract", () => {
    expect(check()).toEqual([]);
  });

  it("(E17) the marker is written before the upload and from github.sha", () => {
    const step = deploySite.match(/ {6}# Source-commit marker[\s\S]*?deploy-sha\.txt\n\n/)![0];
    const moved = mutate(deploySite, step, "").replace(/(\n {2}deploy:)/, "$1").replace(/( {6}- name: Upload artifact\n[\s\S]*?path: site\/dist\n)/, `$1\n${step.trimEnd()}\n`);
    expect(check(moved).join("\n")).toContain("marker step runs after upload-pages-artifact");
    expect(check(mutate(deploySite, 'echo "${{ github.sha }}" >', 'echo "latest" >')).join("\n")).toContain("not a literal");
    expect(check(mutate(deploySite, /\n {6}- name: Write deploy SHA marker\n.*\n.*\n/, "\n")).join("\n")).toContain("no marker step");
  });

  it("(E18) publish only from develop; deploy needs build", () => {
    for (const bad of ["", "if: github.ref == 'refs/heads/main'\n    ", "if: github.ref == 'refs/heads/feature'\n    "]) {
      const v = check(mutate(deploySite, "if: github.ref == 'refs/heads/develop'\n    ", bad)).join("\n");
      expect(v, JSON.stringify(bad)).toContain("`if:` must be exactly");
    }
    expect(check(mutate(deploySite, "    needs: build\n", "")).join("\n")).toContain("deploy: must `needs: build`");
  });

  it("(E19) the push filter keeps the design-scratch exclusion and packages/shell", () => {
    expect(check(mutate(deploySite, '      - "!site/design-scratch/**"\n', "")).join("\n")).toContain("`!site/design-scratch/**`");
    expect(check(mutate(deploySite, '      - "packages/shell/**"\n', "")).join("\n")).toContain("`packages/shell/**`");
  });

  it("(E23b) exactly one daily cron entry", () => {
    expect(check(deploySite, mutate(driftCheck, "'23 5 * * *'", "'23 5 * * 0'")).join("\n")).toContain("not a single daily entry");
    expect(check(deploySite, mutate(driftCheck, "    - cron: '23 5 * * *'\n", "    - cron: '23 5 * * *'\n    - cron: '23 17 * * *'\n")).join("\n")).toContain("exactly one entry");
    expect(check(deploySite, mutate(driftCheck, /  schedule:\n.*\n/, "")).join("\n")).toContain("exactly one entry");
    expect(check(deploySite, mutate(driftCheck, "  workflow_dispatch:\n", "")).join("\n")).toContain("workflow_dispatch missing");
  });

  it("(E20) privilege and isolation of the drift workflow", () => {
    const v = (c: string) => check(deploySite, c).join("\n");
    expect(v(mutate(driftCheck, "      actions: write # `gh workflow run deploy-site.yml`\n", "      actions: write\n      pages: write\n"))).toContain("permissions must be exactly {contents: read, actions: write}");
    expect(v(mutate(driftCheck, "      actions: write # `gh workflow run deploy-site.yml`\n", "      actions: write\n      id-token: write\n"))).toContain("permissions must be exactly");
    expect(v(mutate(driftCheck, "permissions:\n  contents: read\n\njobs:", "permissions:\n  contents: read\n  actions: write\n\njobs:"))).toContain("top-level permissions must be exactly {contents: read}");
    expect(v(mutate(driftCheck, "    timeout-minutes: 10\n", "    timeout-minutes: 10\n    concurrency:\n      group: pages-deploy\n"))).toContain("must not join a concurrency group");
    expect(v(mutate(driftCheck, "    steps:\n", "    steps:\n      - uses: actions/setup-node@v4\n        with:\n          cache: pnpm\n"))).toContain("setup-node cache");
    expect(v(mutate(driftCheck, "node scripts/site-drift-decision.mjs", "echo skipped"))).toContain("does not run scripts/site-drift-decision.mjs");
    expect(check(deploySite, driftCheck, driftScript.replace('arg("dispatch-ref", "develop")', 'arg("dispatch-ref", "main")')).join("\n")).toContain("must dispatch `gh workflow run deploy-site.yml --ref develop`");
  });
});
