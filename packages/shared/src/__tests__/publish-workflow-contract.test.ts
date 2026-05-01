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
