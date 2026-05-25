/**
 * Repo-level invariant: the on-demand Electron CI workflow and its reusable
 * build workflow MUST NOT publish to npm, create a GitHub Release, push
 * tags, or otherwise affect the public update channel of installed users.
 *
 * The CI dev build's version slug (`<base>-ci.<stamp>.<branch>.<sha7>`) is
 * a SemVer prerelease ranked strictly below the base stable version, so
 * `electron-updater` with default `allowPrerelease: false` would not offer
 * it as an update. Defense-in-depth: this lint enforces that the workflows
 * themselves contain no publishing or release-creating actions, even by
 * accident in a future PR.
 *
 * If this test fails, remove the offending action from the workflow. If
 * you genuinely need to publish from CI, do it in publish.yml (which is
 * gated on a tag push or explicit dispatch with a version input).
 *
 * See change: add-ci-electron-on-demand-build (proposal.md Safety section,
 * design.md Decision 4).
 */
import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const CI_ELECTRON_PATH = path.join(REPO_ROOT, ".github", "workflows", "ci-electron.yml");
const REUSABLE_PATH = path.join(REPO_ROOT, ".github", "workflows", "_electron-build.yml");

// Patterns whose presence indicates a side-effect we forbid in these
// workflows. The reusable workflow is the SHARED build definition, so a
// publishing action there would silently leak into the release flow too —
// but we want it kept clean for clarity and to keep the no-side-effects
// invariant easy to reason about.
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /softprops\/action-gh-release/,
    reason: "creates GitHub Releases — must only happen in publish.yml",
  },
  {
    pattern: /actions\/create-release/,
    reason: "creates GitHub Releases — must only happen in publish.yml",
  },
  {
    pattern: /\bnpm\s+publish\b/,
    reason: "publishes to npm — must only happen in publish.yml's publish job",
  },
  {
    pattern: /\bgit\s+push\s+origin\s+v\d/,
    reason: "pushes a version tag — must only happen in publish.yml's prepare job",
  },
  {
    pattern: /\bgit\s+tag\s+["']?v\d/,
    reason: "creates a version tag — must only happen in publish.yml's prepare job",
  },
];

/**
 * Strip YAML full-line comments before scanning. Comments are legitimately
 * allowed to discuss what's forbidden ("No `npm publish`") without being
 * the forbidden thing itself. We strip lines whose first non-whitespace
 * char is `#`. Inline trailing comments are preserved (rare in this codebase
 * and risky to strip because of `run: |` shell blocks where `#` is a real
 * shell comment leader).
 */
function stripYamlComments(content: string): string {
  return content
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

function assertNoForbidden(filePath: string, content: string): void {
  const stripped = stripYamlComments(content);
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    const m = stripped.match(pattern);
    if (m) {
      throw new Error(
        `${path.basename(filePath)} contains forbidden pattern ${pattern} ` +
          `(${reason}). Matched: ${JSON.stringify(m[0])}. ` +
          `See change: add-ci-electron-on-demand-build (design.md Decision 4).`,
      );
    }
  }
}

describe("ci-electron.yml — no side effects on registries or update channels", () => {
  it("ci-electron.yml contains no forbidden publishing/release actions", () => {
    const content = fs.readFileSync(CI_ELECTRON_PATH, "utf8");
    assertNoForbidden(CI_ELECTRON_PATH, content);
  });

  it("_electron-build.yml (shared) contains no forbidden publishing/release actions", () => {
    // The reusable workflow is consumed by BOTH publish.yml (release flow)
    // AND ci-electron.yml (on-demand). Keeping it free of publishing actions
    // means publishing stays cleanly in publish.yml's own jobs, never
    // accidentally inherited by the on-demand path.
    const content = fs.readFileSync(REUSABLE_PATH, "utf8");
    assertNoForbidden(REUSABLE_PATH, content);
  });

  it("ci-electron.yml only fires on workflow_dispatch (no push/pr/schedule)", () => {
    const content = fs.readFileSync(CI_ELECTRON_PATH, "utf8");
    // Match the top-level `on:` block — must contain `workflow_dispatch:`
    // and MUST NOT contain `push:`, `pull_request:`, or `schedule:`.
    const onMatch = content.match(/^on:\s*\n((?:\s+\S.*\n)+?)(?=^\S|\n^[a-z])/m);
    if (!onMatch) {
      throw new Error("ci-electron.yml has no top-level `on:` block");
    }
    const onBlock = onMatch[1];
    if (!/workflow_dispatch:/.test(onBlock)) {
      throw new Error(
        "ci-electron.yml MUST trigger on workflow_dispatch only. Found `on:` block:\n" +
          onBlock,
      );
    }
    for (const trigger of ["push:", "pull_request:", "schedule:", "release:"]) {
      if (new RegExp(`^\\s+${trigger}`, "m").test(onBlock)) {
        throw new Error(
          `ci-electron.yml MUST NOT trigger on '${trigger}'. v1 is dispatch-only ` +
            "to keep the no-side-effects invariant easy to reason about. " +
            "If a different trigger is genuinely needed, update the spec first. " +
            "See change: add-ci-electron-on-demand-build.\nFound `on:` block:\n" +
            onBlock,
        );
      }
    }
  });
});
