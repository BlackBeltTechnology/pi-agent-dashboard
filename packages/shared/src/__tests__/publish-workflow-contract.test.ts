/**
 * Repo-level invariant: `.github/workflows/publish.yml`'s `electron` job
 * MUST `needs: [prepare, publish]` and MUST set `strategy.fail-fast: false`.
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
 * If this test fails, restore the two lines in `publish.yml`:
 *   electron:
 *     needs: [prepare, publish]
 *     strategy:
 *       fail-fast: false
 *       matrix: ...
 *
 * See change: publish-fix-macos.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "publish.yml");

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

  it("electron job's `strategy.fail-fast` is `false`", () => {
    // Match `fail-fast: false` (any whitespace after the colon, but the
    // value must be the literal `false` — not `False`, not absent).
    const m = electronBlock.match(/^\s{6}fail-fast:\s*(\S+)\s*$/m);
    if (!m) {
      throw new Error(
        "electron job's `strategy.fail-fast` is absent — the GitHub Actions " +
          "default of `true` would re-introduce the run-#34 cascade. " +
          "Set `fail-fast: false`. See change: publish-fix-macos.\n" +
          "Job block was:\n" +
          electronBlock,
      );
    }
    expect(m[1]).toBe("false");
  });
});

// ── Prerelease safety contract ───────────────────────────────────────────────────────
// Prerelease versions (e.g. `0.4.5-rc.1`) MUST publish to npm under the
// `next` dist-tag and surface as GitHub `prerelease: true` Releases. The
// single source of truth is the `prepare` job's computed `is_prerelease`
// output. See change: eliminate-bash-on-windows-runners (D6).

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
