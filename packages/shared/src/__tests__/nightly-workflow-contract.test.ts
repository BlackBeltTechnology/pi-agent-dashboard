/**
 * Repo-level contract for the nightly Verdaccio build / scheduled release
 * rehearsal (changes: add-nightly-verdaccio-build, schedule-release-rehearsal).
 *
 * Scanned files: `nightly.yml` plus every local reusable workflow it calls
 * through `uses: ./.github/workflows/<file>` (today `_electron-build.yml` and
 * `_smoke.yml`; the set is derived from `nightly.yml`, never listed here).
 *
 * Safety (the nightly's hard requirement: ZERO public npm writes, NO release
 * side effects), checked on every scanned file:
 *   - no `softprops/action-gh-release`, no `actions/create-release`;
 *   - no `git push` (without `--dry-run`), no `git commit`;
 *   - callees contain no `npm publish` at all; `nightly.yml`'s `npm publish`
 *     lines are `--dry-run` or carry `--registry http://localhost`;
 *   - every `REGISTRY` / `npm_config_registry` / `registry_url` value in
 *     `nightly.yml` is loopback (anchored: `localhost.evil.com` fails).
 *
 * Rehearsal shape (`nightly.yml` jobs: resolve, verify-publish, knip,
 * install-load, electron, smoke, report):
 *   - one active daily cron; no `concurrency` key (design D6);
 *   - top-level `permissions` are `contents: read`; only `report` writes issues;
 *   - `report.needs` is every other job, `report.if` is `always()`, and its
 *     step runs `nightly-report.mjs` with exactly `--jobs-only
 *     --no-close-on-rerun --label nightly --name "Nightly Verdaccio build"`;
 *     no `actions/github-script`;
 *   - `verify-publish` gates no job, publishes no bulk `npm publish
 *     --workspaces`, and upgrades npm before `pnpm install`, `npm pkg set` and
 *     the publish script; `smoke` is `_smoke.yml` at `github.sha` and the
 *     smoke matrix is defined once.
 *
 * If this test fails, the nightly is at risk of polluting public npm, cutting
 * an unintended Release, or going dark without anyone noticing: revert the
 * offending line.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

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

// ── Release-rehearsal contract (change: schedule-release-rehearsal, D1-D8; test-plan E29-E60) ──
// `nightly.yml` is now a scheduled rehearsal: an active daily cron, a report that
// can never be cancelled or skipped, one loopback registry per publish, and the
// same publication-free rules for every local reusable workflow it calls.
// Each rule is a function over the workflow TEXT so the cases below can mutate
// the real file (and a fixture callee) and assert the rule fires.

const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/;
const ENTRY_FLAGS: ReadonlyArray<[string, string | true]> = [
  ["--jobs-only", true],
  ["--no-close-on-rerun", true],
  ["--label", "nightly"],
  ["--name", "Nightly Verdaccio build"],
];

type Job = {
  needs?: string | string[];
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  permissions?: Record<string, string>;
  steps?: Array<{ uses?: string; run?: string }>;
};

/** Local reusable workflows a workflow calls through `uses: ./.github/workflows/<file>` (outside comments). */
function localCallees(yaml: string): string[] {
  return [...codeLines(yaml).join("\n").matchAll(/^\s*uses:\s*\.\/\.github\/workflows\/(\S+?)\s*$/gm)].map((m) => m[1]);
}

const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Every way `nightly.yml` (and the files it calls) breaks the rehearsal contract. */
function rehearsalViolations(nightly: string, callees: Record<string, string>): string[] {
  const out: string[] = [];
  const doc = parseYaml(nightly) as { on?: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, Job> };
  const on = (doc.on ?? (doc as unknown as Record<string, Record<string, unknown>>).true ?? {}) as Record<string, unknown>;
  const code = codeLines(nightly);

  // Cron: exactly one uncommented entry that fires once a day.
  const schedule = on.schedule as Array<{ cron?: string }> | undefined;
  if (!Array.isArray(schedule) || schedule.length !== 1 || !/^\d{1,2} \d{1,2} \* \* \*$/.test(schedule[0]?.cron ?? "")) {
    out.push("cron: `on.schedule` must hold exactly one uncommented entry that fires once a day (`M H * * *`)");
  }
  // No run group (D6).
  if (code.some((l) => /^\s*concurrency:/.test(l))) out.push("concurrency: nightly.yml must declare no `concurrency` key (D6)");
  // Top-level token is read-only; only `report` writes issues.
  if (JSON.stringify(doc.permissions) !== JSON.stringify({ contents: "read" })) out.push("permissions: top-level permissions must be exactly `contents: read`");
  for (const [id, job] of Object.entries(doc.jobs)) {
    if (id !== "report" && job.permissions?.issues === "write") out.push(`permissions: job ${id} must not declare issues: write`);
  }
  // Report: waits for every job, always runs, one shared-reporter call.
  const report = doc.jobs.report;
  const others = Object.keys(doc.jobs).filter((j) => j !== "report");
  const reportNeeds = asList(report?.needs);
  for (const j of others) if (!reportNeeds.includes(j)) out.push(`report: needs is missing job ${j}`);
  for (const j of reportNeeds) if (!others.includes(j)) out.push(`report: needs names unknown job ${j}`);
  if (String(report?.if ?? "").trim() !== "always()") out.push("report: `if:` must be `always()`");
  const step = report?.steps?.find((s) => /nightly-report\.mjs/.test(s.run ?? ""));
  if (!step) out.push("report: no step runs scripts/test-selection/nightly-report.mjs");
  else {
    const tokens = (step.run as string).split(/nightly-report\.mjs/)[1].match(/"[^"]*"|\S+/g) ?? [];
    const want = new Map(ENTRY_FLAGS);
    const seen = new Set<string>();
    for (let i = 0; i < tokens.length; i++) {
      const flag = tokens[i];
      const value = want.get(flag);
      if (value === undefined) out.push(`report: unexpected argument ${flag} (exactly --jobs-only --no-close-on-rerun --label nightly --name "Nightly Verdaccio build")`);
      else if (value !== true) {
        const given = (tokens[++i] ?? "").replace(/^"|"$/g, "");
        if (given !== value) out.push(`report: ${flag} must be "${value}" (got "${given}")`);
      }
      seen.add(flag);
    }
    for (const [flag] of ENTRY_FLAGS) if (!seen.has(flag)) out.push(`report: missing ${flag}`);
  }
  if (code.some((l) => /actions\/github-script/.test(l))) out.push("report: no actions/github-script step (the shared reporter writes the issue)");
  // verify-publish gates nothing and publishes only to loopback.
  for (const [id, job] of Object.entries(doc.jobs)) {
    if (id !== "report" && asList(job.needs).includes("verify-publish")) out.push(`needs: job ${id} must not wait for verify-publish`);
  }
  const vpStart = nightly.indexOf("\n  verify-publish:");
  const vpEnd = nightly.indexOf("\n  knip:");
  const vp = codeLines(nightly.slice(vpStart, vpEnd)).join("\n");
  if (/npm\s+publish\s+--workspaces/.test(vp)) out.push("verify-publish: no `npm publish --workspaces` (a --dry-run does not exempt it)");
  const vpRuns = (doc.jobs["verify-publish"]?.steps ?? []).map((s) => s.run ?? "");
  const at = (re: RegExp) => vpRuns.findIndex((r) => re.test(r));
  const upgrade = at(/npm\s+install\s+-g\s+npm@latest/);
  if (upgrade < 0) out.push("verify-publish: no `npm install -g npm@latest` step");
  else {
    for (const [name, re] of [["pnpm install", /pnpm\s+install/], ["npm pkg set", /npm\s+pkg\s+set/], ["nightly-verdaccio-publish.mjs", /nightly-verdaccio-publish\.mjs/]] as const) {
      const i = at(re);
      if (i >= 0 && upgrade > i) out.push(`verify-publish: \`npm install -g npm@latest\` must come before ${name}`);
    }
  }
  // Smoke: the shared workflow at the tested commit; the matrix is defined once.
  const smoke = doc.jobs.smoke;
  if (smoke?.uses !== "./.github/workflows/_smoke.yml") out.push("smoke: job must be `uses: ./.github/workflows/_smoke.yml`");
  else if (String(smoke.with?.ref ?? "").trim() !== "${{ github.sha }}") out.push("smoke: `ref` must be `${{ github.sha }}` (the commit the rest of the night tests)");
  for (const id of Object.keys(doc.jobs)) if (id.startsWith("standalone-install-smoke")) out.push(`smoke: nightly.yml must not define ${id} itself`);
  // Registry values are loopback, every one of them.
  for (const l of code) {
    const m = /\b(REGISTRY|npm_config_registry|registry_url)\s*:\s*(\S+)\s*$/.exec(l);
    const value = m?.[2].replace(/^["']|["']$/g, "");
    if (m && !LOOPBACK.test(value as string)) out.push(`registry: ${m[1]} value ${value} is not loopback`);
  }
  // Publication-free: nightly.yml plus every local reusable workflow it calls.
  const scanned: Record<string, string> = { "nightly.yml": nightly };
  for (const name of localCallees(nightly)) {
    if (callees[name] === undefined) out.push(`callee: ${name} is called by nightly.yml but was not provided`);
    else scanned[name] = callees[name];
  }
  for (const [name, text] of Object.entries(scanned)) {
    for (const l of codeLines(text)) {
      if (/softprops\/action-gh-release|actions\/create-release/.test(l)) out.push(`${name}: no GitHub Release action: ${l.trim()}`);
      if (/git\s+push/.test(l) && !/--dry-run/.test(l)) out.push(`${name}: no git push: ${l.trim()}`);
      if (/git\s+commit/.test(l)) out.push(`${name}: no git commit: ${l.trim()}`);
      if (name !== "nightly.yml" && /npm\s+publish/.test(l)) out.push(`${name}: no npm publish (no dry-run or loopback exception): ${l.trim()}`);
    }
  }
  return out;
}

describe("nightly.yml — release-rehearsal contract (schedule-release-rehearsal)", () => {
  const read = (name: string) => fs.readFileSync(path.join(WORKFLOWS_DIR, name), "utf8");
  const real = () => {
    const nightly = read("nightly.yml");
    return { nightly, callees: Object.fromEntries(localCallees(nightly).map((n) => [n, read(n)])) };
  };
  /** Replace `from` with `to`, failing loudly when the real file no longer contains `from`. */
  const mut = (text: string, from: string | RegExp, to: string): string => {
    const next = text.replace(from, to);
    expect(next, `mutation source not found: ${String(from)}`).not.toBe(text);
    return next;
  };
  const fires = (nightly: string, callees: Record<string, string>, re: RegExp) =>
    expect(rehearsalViolations(nightly, callees).join("\n")).toMatch(re);

  it("E60: the real nightly.yml and the files it calls satisfy every rule", () => {
    const { nightly, callees } = real();
    expect(Object.keys(callees).sort()).toEqual(["_electron-build.yml", "_smoke.yml"]);
    expect(rehearsalViolations(nightly, callees)).toEqual([]);
  });

  it("E29: a commented-out cron fails", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "  schedule:\n    - cron: '13 4 * * *'", "  # schedule:\n  #   - cron: '13 4 * * *'"), callees, /cron/);
  });

  it("E30: a weekly cron fails", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "'13 4 * * *'", "'13 4 * * 1'"), callees, /cron/);
  });

  it("E31: a twice-a-day cron, or two entries, fail", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "'13 4 * * *'", "'13 4,16 * * *'"), callees, /cron/);
    fires(mut(nightly, "    - cron: '13 4 * * *'", "    - cron: '13 4 * * *'\n    - cron: '13 16 * * *'"), callees, /cron/);
  });

  it("E32: another daily time passes (the time is a design choice, not a spec rule)", () => {
    const { nightly, callees } = real();
    expect(rehearsalViolations(mut(nightly, "'13 4 * * *'", "'0 7 * * *'"), callees)).toEqual([]);
  });

  it("E33: a job-level concurrency key fails", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "  electron:\n    needs: [resolve]\n", "  electron:\n    concurrency: { group: x }\n    needs: [resolve]\n"), callees, /concurrency/);
  });

  it("E34: a workflow-level concurrency group fails", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "permissions:\n  contents: read\n", "concurrency:\n  group: nightly\n  cancel-in-progress: true\n\npermissions:\n  contents: read\n"), callees, /concurrency/);
  });

  it("E35: a comment that names concurrency passes", () => {
    const { nightly, callees } = real();
    expect(rehearsalViolations(`${nightly}\n#   concurrency: none here\n`, callees)).toEqual([]);
  });

  it("E36: a callee's concurrency group is not checked", () => {
    const { nightly, callees } = real();
    const smoke = mut(callees["_smoke.yml"], "\njobs:\n", "\njobs:\n  x:\n    concurrency: { group: s }\n    runs-on: ubuntu-latest\n    steps: []\n");
    expect(rehearsalViolations(nightly, { ...callees, "_smoke.yml": smoke })).toEqual([]);
  });

  it("E37: report.needs without knip fails naming knip", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "needs: [resolve, verify-publish, knip, install-load, electron, smoke]", "needs: [resolve, verify-publish, install-load, electron, smoke]"), callees, /report: needs is missing job knip/);
  });

  it("E38: a new job that report does not wait for fails naming it", () => {
    const { nightly, callees } = real();
    fires(`${nightly}\n  foo:\n    runs-on: ubuntu-latest\n    steps: []\n`, callees, /report: needs is missing job foo/);
  });

  it("E39: report.if failure() fails", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "    if: always()", "    if: failure()"), callees, /report: `if:` must be `always\(\)`/);
  });

  it("E40: another job declaring issues: write fails naming it", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "    timeout-minutes: 35\n", "    timeout-minutes: 35\n    permissions: { contents: read, issues: write }\n"), callees, /job verify-publish must not declare issues: write/);
  });

  it("E41: a top-level issues: write fails", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "permissions:\n  contents: read\n\njobs:", "permissions:\n  contents: read\n  issues: write\n\njobs:"), callees, /top-level permissions/);
  });

  it("E42: a report run step without --no-close-on-rerun fails naming it", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, " --no-close-on-rerun", ""), callees, /missing --no-close-on-rerun/);
  });

  it("E43: an extra flag such as --watchdog fails", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, '--name "Nightly Verdaccio build"', '--name "Nightly Verdaccio build" --watchdog'), callees, /unexpected argument --watchdog/);
  });

  it("E44: --label nightly-tests instead of nightly fails", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "--label nightly ", "--label nightly-tests "), callees, /--label must be "nightly"/);
  });

  it("E45: an actions/github-script step anywhere fails", () => {
    const { nightly, callees } = real();
    fires(`${nightly}\n      - uses: actions/github-script@v7\n`, callees, /github-script/);
  });

  it("E46: a look-alike loopback host in a second registry value fails naming it", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "      - name: Start Verdaccio\n        env:\n          REGISTRY: http://localhost:4873", "      - name: Start Verdaccio\n        env:\n          REGISTRY: http://localhost.evil.com:4873"), callees, /localhost\.evil\.com/);
  });

  it("E47: a public registry through npm_config_registry fails", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "      - name: Start Verdaccio\n        env:\n", "      - name: Start Verdaccio\n        env:\n          npm_config_registry: https://registry.npmjs.org\n"), callees, /registry\.npmjs\.org/);
  });

  it("E48: 127.0.0.1 is a valid loopback form", () => {
    const { nightly, callees } = real();
    expect(rehearsalViolations(mut(nightly, "      - name: Start Verdaccio\n        env:\n          REGISTRY: http://localhost:4873", "      - name: Start Verdaccio\n        env:\n          REGISTRY: http://127.0.0.1:4873"), callees)).toEqual([]);
  });

  it("E49: re-adding the bulk dry-run publish to verify-publish fails", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "        run: node scripts/nightly-verdaccio-publish.mjs\n", "        run: node scripts/nightly-verdaccio-publish.mjs\n      - run: npm publish --workspaces --include-workspace-root --dry-run\n"), callees, /npm publish --workspaces/);
  });

  it("E50: electron waiting for verify-publish fails naming electron", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "  electron:\n    needs: [resolve]", "  electron:\n    needs: [resolve, verify-publish]"), callees, /job electron must not wait for verify-publish/);
  });

  it("E51: npm upgraded after npm pkg set fails", () => {
    const { nightly, callees } = real();
    const upgrade = /      - name: Upgrade npm like the release publish job \(publish\.yml\)\n        run: npm install -g npm@latest\n/;
    const moved = mut(mut(nightly, upgrade, ""), "      - name: Sync inter-package dep specifiers\n", "      - run: npm install -g npm@latest\n      - name: Sync inter-package dep specifiers\n");
    fires(moved, callees, /npm@latest` must come before (pnpm install|npm pkg set)/);
  });

  it("E52: no npm@latest upgrade step fails", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, /      - name: Upgrade npm like the release publish job \(publish\.yml\)\n        run: npm install -g npm@latest\n/, ""), callees, /no `npm install -g npm@latest` step/);
  });

  it("E53: smoke at github.ref instead of github.sha fails", () => {
    const { nightly, callees } = real();
    fires(mut(nightly, "      ref: ${{ github.sha }}\n\n  # ── report", "      ref: ${{ github.ref }}\n\n  # ── report"), callees, /smoke: `ref` must be/);
  });

  it("E54: an inline standalone-install-smoke job in nightly.yml fails", () => {
    const { nightly, callees } = real();
    fires(`${nightly}\n  standalone-install-smoke-linux:\n    runs-on: ubuntu-latest\n    steps: []\n`, callees, /must not define standalone-install-smoke-linux/);
  });

  it("E55: a non-comment npm publish --dry-run in _smoke.yml fails naming it", () => {
    const { nightly, callees } = real();
    fires(nightly, { ...callees, "_smoke.yml": `${callees["_smoke.yml"]}\n        run: npm publish --dry-run\n` }, /_smoke\.yml: no npm publish/);
  });

  it("E56: the real _smoke.yml header comment may name npm publish and nightly.yml", () => {
    const { nightly, callees } = real();
    expect(callees["_smoke.yml"]).toMatch(/^#.*npm publish/m);
    expect(callees["_smoke.yml"]).toMatch(/^#\s+- \.github\/workflows\/nightly\.yml/m);
    expect(rehearsalViolations(nightly, callees)).toEqual([]);
  });

  it("E57: git push and git commit in _smoke.yml each fail", () => {
    const { nightly, callees } = real();
    for (const line of ["git push origin HEAD", "git commit -am bump"]) {
      fires(nightly, { ...callees, "_smoke.yml": `${callees["_smoke.yml"]}\n        run: ${line}\n` }, /_smoke\.yml: no git (push|commit)/);
    }
  });

  it("E58: actions/create-release in nightly.yml fails", () => {
    const { nightly, callees } = real();
    fires(`${nightly}\n      - uses: actions/create-release@v1\n`, callees, /nightly\.yml: no GitHub Release action/);
  });

  it("E59: a new local callee is scanned, and fails naming itself", () => {
    const { nightly, callees } = real();
    const withExtra = `${nightly}\n  extra:\n    uses: ./.github/workflows/_extra.yml\n`;
    fires(withExtra, { ...callees, "_extra.yml": "jobs:\n  x:\n    steps:\n      - uses: softprops/action-gh-release@v2\n" }, /_extra\.yml: no GitHub Release action/);
  });
});
