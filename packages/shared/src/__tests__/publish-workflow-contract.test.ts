/**
 * Repo-level invariant: `.github/workflows/publish.yml`'s `electron` job
 * MUST `needs: [prepare, publish]` AND MUST delegate to the reusable
 * workflow `.github/workflows/_electron-build.yml`, which MUST itself set
 * `strategy.fail-fast: false`.
 *
 * Why: the bundled-server step in the electron matrix runs `npm install`
 * against the live npm registry, which depends on `@blackbelt-technology/*`
 * sub-packages being uploaded by the `publish` job FIRST. Without this gate
 * the electron job races publish and ETARGETs on the just-bumped version
 * (release run #34 — macOS hit ETARGET 1m 45s before publish finished).
 *
 * Without `fail-fast: false`, a single OS failure cascades and cancels the
 * other four matrix variants — losing diagnostic output and wasting runner
 * minutes.
 *
 * If this test fails, restore the contract in `publish.yml` + `_electron-build.yml`:
 *   publish.yml:
 *     electron:
 *       needs: [prepare, publish]
 *       uses: ./.github/workflows/_electron-build.yml
 *   _electron-build.yml:
 *     jobs:
 *       build:
 *         strategy:
 *           fail-fast: false
 *
 * See changes: publish-fix-macos, add-ci-electron-on-demand-build.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "publish.yml");
const REUSABLE_WORKFLOW_PATH = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "_electron-build.yml",
);
const CI_ELECTRON_WORKFLOW_PATH = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "ci-electron.yml",
);

/**
 * Extract the YAML body of a top-level job by name. Returns the lines
 * between `  <jobName>:` and the next sibling-indent (`  `) job, or EOF.
 *
 * We avoid pulling in a YAML library — the test only needs to inspect two
 * specific scalar/list keys on a known job, and the file format is stable
 * (2-space indent, no tabs, no anchors). Same pattern as
 * `no-direct-process-kill.test.ts` and `no-raw-node-import.test.ts`.
 */
function extractJobBlock(yaml: string, jobName: string): string {
  const lines = yaml.split("\n");
  const headerRe = new RegExp(`^  ${jobName}:\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    throw new Error(`job '${jobName}' not found in publish.yml`);
  }
  // Walk forward until next line at the same 2-space indent that is a
  // job header (`^  [a-z][a-z0-9-]*:\s*$`) or EOF.
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

describe("publish.yml — electron job dependency-graph contract", () => {
  const yaml = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const electronBlock = extractJobBlock(yaml, "electron");

  it("electron job's `needs:` includes both `prepare` and `publish`", () => {
    // Accept either flow-list (`needs: [prepare, publish]`) or
    // block-list:
    //   needs:
    //     - prepare
    //     - publish
    // (Currently flow-list — but the test should not lock the surface
    // syntax, only the dependency contract.)
    const flowMatch = electronBlock.match(/^\s{4}needs:\s*\[([^\]]*)\]/m);
    const blockMatch = electronBlock.match(
      /^\s{4}needs:\s*\n((?:\s{6}-\s+\S+\s*\n)+)/m,
    );

    let names: string[] = [];
    if (flowMatch) {
      names = flowMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (blockMatch) {
      names = blockMatch[1]
        .split("\n")
        .map((l) => l.replace(/^\s*-\s+/, "").trim())
        .filter(Boolean);
    } else {
      throw new Error(
        "electron job has no `needs:` key — must declare `needs: [prepare, publish]`. " +
          "See change: publish-fix-macos. Job block was:\n" +
          electronBlock,
      );
    }

    expect(names).toContain("prepare");
    expect(names).toContain("publish");
  });

  it("electron job delegates to the reusable workflow via `uses:`", () => {
    // After change add-ci-electron-on-demand-build, the electron job is a
    // thin consumer of the shared workflow. The same definition serves
    // both publish.yml and ci-electron.yml.
    const m = electronBlock.match(
      /^\s{4}uses:\s*\.\/\.github\/workflows\/_electron-build\.yml\s*$/m,
    );
    if (!m) {
      throw new Error(
        "electron job MUST be `uses: ./.github/workflows/_electron-build.yml`. " +
          "The reusable workflow is the sole definition of the build matrix. " +
          "See change: add-ci-electron-on-demand-build.\n" +
          "Job block was:\n" +
          electronBlock,
      );
    }
  });
});

describe("_electron-build.yml — reusable workflow contract", () => {
  const reusableYaml = fs.readFileSync(REUSABLE_WORKFLOW_PATH, "utf8");

  it("sets `fail-fast: false` on the build job", () => {
    // Without `fail-fast: false`, a single OS failure cascades and cancels the
    // other matrix variants — losing diagnostic output and wasting runner
    // minutes. Locked here because the assertion moved out of publish.yml
    // in change add-ci-electron-on-demand-build (electron job is now a thin
    // `uses:` shim). See change: publish-fix-macos.
    const m = reusableYaml.match(/^\s+fail-fast:\s*(\S+)\s*$/m);
    if (!m) {
      throw new Error(
        "_electron-build.yml `strategy.fail-fast` is absent — the GitHub Actions " +
          "default of `true` would re-introduce the run-#34 cascade. " +
          "Set `fail-fast: false` on jobs.build.strategy. See change: publish-fix-macos.",
      );
    }
    expect(m[1]).toBe("false");
  });

  it("declares the input contract documented in design.md", () => {
    // Inputs locked: version, ref, legs, source_only_bundle,
    // artifact_retention_days, artifact_name_suffix. Adding inputs is
    // safe; removing or renaming requires updating both callers
    // (publish.yml + ci-electron.yml) plus the spec.
    for (const key of [
      "version",
      "ref",
      "legs",
      "source_only_bundle",
      "artifact_retention_days",
    ]) {
      const re = new RegExp(`^\\s+${key}:\\s*$`, "m");
      if (!re.test(reusableYaml)) {
        throw new Error(
          `_electron-build.yml is missing required input '${key}'. ` +
            "See change: add-ci-electron-on-demand-build (design.md Decision 2).",
        );
      }
    }
  });

  it("contains a runnable-bundle assertion step (fix-ci-electron-runnable-bundles)", () => {
    // Defence-in-depth gate: when `inputs.source_only_bundle == false`, the
    // reusable workflow MUST verify that bundle-server.mjs produced a
    // complete `resources/server/node_modules/@blackbelt-technology/
    // pi-dashboard-server/src/cli.ts`. Without this, a regression in
    // sync-versions.js or the bundle layout could silently ship a
    // non-runnable artefact — the exact failure mode that motivated
    // change fix-ci-electron-runnable-bundles. Match a permissive name
    // regex so the step can be renamed without breaking the contract, as
    // long as intent is preserved.
    const stepNameRe = /^\s+-\s+name:\s*.*(runnable[-\s]bundle|cli\.ts.*exists).*/im;
    if (!stepNameRe.test(reusableYaml)) {
      throw new Error(
        "_electron-build.yml is missing the runnable-bundle assertion step. " +
          "Expected a step whose `name:` matches /runnable[- ]bundle|cli\\.ts.*exists/i. " +
          "See change: fix-ci-electron-runnable-bundles.",
      );
    }
  });

  it("contains no forbidden side-effect actions (npm publish, gh-release, tag push)", () => {
    // The reusable workflow MUST be a pure artifact producer. Publishing
    // remains the sole responsibility of publish.yml's `publish` +
    // `github-release` jobs. See change: add-ci-electron-on-demand-build
    // (proposal.md "Safety lints" + spec ci-electron-on-demand-build).
    const forbidden = [
      /softprops\/action-gh-release/,
      /actions\/create-release/,
      /npm\s+publish/,
      /git\s+push\s+origin\s+v/,
    ];
    for (const re of forbidden) {
      if (re.test(reusableYaml)) {
        throw new Error(
          `_electron-build.yml contains forbidden action matching ${re}. ` +
            "The reusable workflow MUST NOT publish or release. See change: " +
            "add-ci-electron-on-demand-build.",
        );
      }
    }
  });
});

// ── Prerelease safety contract ───────────────────────────────────────────────────────
// Prerelease versions (e.g. `0.4.5-rc.1`) MUST publish to npm under the
// `next` dist-tag and surface as GitHub `prerelease: true` Releases. The
// single source of truth is the `prepare` job's computed `is_prerelease`
// output. See change: eliminate-bash-on-windows-runners (D6).

// ── Lockfile-regen contract ──────────────────────────────────────────────
// The `prepare` job MUST regenerate package-lock.json with the bumped
// versions (between sync-versions.js and the git commit) so consumers'
// `npm ci` doesn't fall back to stale registry tarballs via strict
// prerelease semver. See change: fix-release-lockfile-drift.

/**
 * Parse the `steps:` block of a single job into an array of `{ run }`
 * entries. We only care about the `run:` field for this contract; the
 * step delimiter is any `      - ` line (6-space indent + dash + space).
 * Multi-line `run: |` blocks fold into a single `run` string.
 */
function parseJobSteps(jobBlock: string): Array<{ run: string }> {
  const lines = jobBlock.split("\n");
  const steps: Array<{ run: string }> = [];
  let i = 0;
  // Find the `    steps:` line.
  while (i < lines.length && !/^    steps:\s*$/.test(lines[i])) i++;
  i++;
  let current: { run: string } | null = null;
  let inRunBlock = false;
  let runBlockIndent = 0;
  while (i < lines.length) {
    const line = lines[i];
    // New step delimiter: `      - ` at 6-space indent.
    if (/^      - /.test(line)) {
      if (current) steps.push(current);
      current = { run: "" };
      inRunBlock = false;
      // Inline `- run: foo` form.
      const inlineRun = line.match(/^      -\s+run:\s+(.*)$/);
      if (inlineRun) current.run = inlineRun[1];
      i++;
      continue;
    }
    if (current) {
      // Block scalar `        run: |`.
      const blockStart = line.match(/^        run:\s*\|?\s*$/);
      const inlineKey = line.match(/^        run:\s+(.+)$/);
      if (blockStart) {
        inRunBlock = true;
        runBlockIndent = 10; // body lines start at ≥ 10-space indent
        i++;
        continue;
      }
      if (inlineKey) {
        current.run += (current.run ? "\n" : "") + inlineKey[1];
        i++;
        continue;
      }
      if (inRunBlock) {
        // Body line of a `run: |` block. Stop when we hit a less-indented
        // line (next key at 8-space indent, or the next step at 6-space).
        if (line.length === 0) {
          current.run += "\n";
          i++;
          continue;
        }
        const indent = line.length - line.trimStart().length;
        if (indent < runBlockIndent) {
          inRunBlock = false;
          continue; // re-process this line as a key
        }
        current.run += (current.run ? "\n" : "") + line.slice(runBlockIndent);
        i++;
        continue;
      }
    }
    i++;
  }
  if (current) steps.push(current);
  return steps;
}

describe("ci-electron.yml — runnable-bundle contract", () => {
  // Pin the post-fix-ci-electron-runnable-bundles invariant: CI-dispatched
  // Electron artefacts MUST ship with a complete `resources/server/
  // node_modules/` tree so the unzipped installer is runnable on a user's
  // desktop. The earlier value (`true`, from add-ci-electron-on-demand-build
  // Decision 3) was invalidated by eliminate-electron-runtime-install's
  // removal of every runtime install path. See change:
  // fix-ci-electron-runnable-bundles.
  const ciYaml = fs.readFileSync(CI_ELECTRON_WORKFLOW_PATH, "utf8");

  it("build job passes `source_only_bundle: false` to the reusable workflow", () => {
    // Match the key in any whitespace alignment, but the value MUST be
    // the literal `false`. `true` would re-introduce the broken-on-unzip
    // failure mode (BundledServerMissingError on cli.ts).
    const m = ciYaml.match(/^\s+source_only_bundle:\s*(\S+)\s*$/m);
    if (!m) {
      throw new Error(
        "ci-electron.yml does not pass `source_only_bundle:` to the reusable " +
          "workflow. Expected `source_only_bundle: false`. See change: " +
          "fix-ci-electron-runnable-bundles.",
      );
    }
    if (m[1] !== "false") {
      throw new Error(
        `ci-electron.yml passes \`source_only_bundle: ${m[1]}\` — ` +
          "expected `false`. Source-only bundles ship without " +
          "`resources/server/node_modules/` and fail at launch with " +
          "BundledServerMissingError. See change: fix-ci-electron-runnable-bundles.",
      );
    }
    expect(m[1]).toBe("false");
  });
});

describe("publish.yml — prepare job lockfile-regen contract", () => {
  const yaml = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const prepareBlock = extractJobBlock(yaml, "prepare");
  const prepareSteps = parseJobSteps(prepareBlock);

  it("prepare job regenerates lockfile after version bump (fix-release-lockfile-drift)", () => {
    const syncIdx = prepareSteps.findIndex((s) => /sync-versions\.js/.test(s.run || ""));
    const regenIdx = prepareSteps.findIndex((s) =>
      /npm install --package-lock-only/.test(s.run || ""),
    );
    const commitIdx = prepareSteps.findIndex((s) =>
      /git commit -m "chore\(release\)/.test(s.run || ""),
    );
    expect(syncIdx, "sync-versions.js step missing").toBeGreaterThanOrEqual(0);
    expect(
      regenIdx,
      "lockfile regen step missing — see change fix-release-lockfile-drift",
    ).toBeGreaterThan(syncIdx);
    expect(commitIdx, "git commit step missing").toBeGreaterThan(regenIdx);
  });
});

describe("publish.yml — prerelease safety contract", () => {
  const yaml = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const prepareBlock = extractJobBlock(yaml, "prepare");
  const publishBlock = extractJobBlock(yaml, "publish");
  const ghReleaseBlock = extractJobBlock(yaml, "github-release");

  it("prepare job's outputs block declares `is_prerelease`", () => {
    // Match the `outputs:` block under `prepare`. Accept any whitespace
    // alignment after the colon, but the key must be present and wired
    // to a step output.
    const m = prepareBlock.match(/^\s{4}outputs:\s*\n((?:\s{6}\S.*\n)+)/m);
    if (!m) {
      throw new Error(
        "prepare job has no `outputs:` block. Required to expose\n" +
          "`is_prerelease` to downstream jobs. See change:\n" +
          "eliminate-bash-on-windows-runners (D6).\n" +
          "prepare block:\n" +
          prepareBlock,
      );
    }
    const block = m[1];
    if (!/is_prerelease:\s*\$\{\{\s*steps\.[A-Za-z_]+\.outputs\.is_prerelease\s*\}\}/.test(block)) {
      throw new Error(
        "prepare job's outputs block must declare `is_prerelease` wired to a\n" +
          "step output (e.g. `is_prerelease: ${{ steps.resolve.outputs.is_prerelease }}`).\n" +
          "Without this, downstream `publish` and `github-release` jobs cannot\n" +
          "distinguish prereleases from stable versions. See change:\n" +
          "eliminate-bash-on-windows-runners (D6).\n" +
          "outputs block was:\n" +
          block,
      );
    }
    expect(block).toMatch(/is_prerelease:/);
  });

  it("publish job uses `--tag next` conditionally on is_prerelease", () => {
    // Two requirements:
    //   1. The literal string `--tag next` appears in the publish loop body.
    //   2. There's a guard checking `is_prerelease == "true"` (or the bash
    //      equivalent `[ "$PRERELEASE" = "true" ]`).
    if (!/--tag next/.test(publishBlock)) {
      throw new Error(
        "publish job is missing the `--tag next` literal. Prereleases must\n" +
          "publish under the `next` dist-tag so consumers running plain\n" +
          "`npm install <pkg>` keep getting the last stable release. See\n" +
          "change: eliminate-bash-on-windows-runners (D6).",
      );
    }
    const hasGuard =
      /is_prerelease\s*==\s*['"]true['"]/.test(publishBlock) ||
      /\[\s*"\$PRERELEASE"\s*=\s*"true"\s*\]/.test(publishBlock) ||
      /PRERELEASE.*=.*"true"/.test(publishBlock);
    if (!hasGuard) {
      throw new Error(
        "publish job uses `--tag next` but lacks the prerelease guard. The\n" +
          "`--tag next` argument MUST be conditional on the `is_prerelease`\n" +
          "output (e.g. `if [ \"$PRERELEASE\" = \"true\" ]; then ...`).\n" +
          "Otherwise stable releases would also publish to `next`. See\n" +
          "change: eliminate-bash-on-windows-runners (D6).",
      );
    }
    expect(publishBlock).toContain("--tag next");
  });

  it("github-release job sets prerelease from is_prerelease", () => {
    // softprops/action-gh-release accepts `prerelease: <bool>` in its
    // `with:` block. The value MUST be derived from the prepare job's
    // `is_prerelease` output (literal-string comparison required because
    // GitHub Actions stringifies job outputs).
    if (
      !/prerelease:\s*\$\{\{\s*needs\.prepare\.outputs\.is_prerelease\s*==\s*['"]true['"]\s*\}\}/
        .test(ghReleaseBlock)
    ) {
      throw new Error(
        "github-release job's `softprops/action-gh-release` step must set\n" +
          "`prerelease: ${{ needs.prepare.outputs.is_prerelease == 'true' }}`\n" +
          "in its `with:` block. Otherwise rc tags surface as stable Releases.\n" +
          "See change: eliminate-bash-on-windows-runners (D6).\n" +
          "github-release block was:\n" +
          ghReleaseBlock,
      );
    }
    expect(ghReleaseBlock).toMatch(/prerelease:.*is_prerelease.*true/);
  });
});
