/**
 * Repo-level invariant: OpenSpec workflow skills (.pi/skills/openspec-*)
 * MUST invoke `.pi/skills/openspec-shared/scripts/effective-status.sh`
 * instead of calling `openspec status --json` directly. The wrapper
 * applies the dashboard's local-design-evidence override (R1/R2/R3) so
 * skill-driven prompts and dashboard session-card buttons cannot
 * disagree about a change's next-ready artifact.
 *
 * If this test fails: replace the offending `openspec status ... --json`
 * line with:
 *
 *   .pi/skills/openspec-shared/scripts/effective-status.sh "<name>"
 *
 * See change: fix-openspec-design-detection.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

/**
 * Regex catches `openspec status ... --json` invocations. We deliberately
 * accept whitespace flexibility but reject only the `--json` flavor (the
 * human-readable `openspec status --change "<name>"` form is allowed
 * because it doesn't drive logic).
 */
const RAW_STATUS_RE = /\bopenspec\s+status\b[^\n]*--json\b/;

/** Per-line opt-out marker. */
const OPT_OUT_MARKER = "ban:openspec-status-ok";

/** Skills the wrapper exists to serve — these MUST go through it. */
const GOVERNED_SKILLS = [
  "openspec-continue-change",
  "openspec-ff-change",
  "openspec-apply-change",
  "openspec-verify-change",
];

describe("OpenSpec workflow skills must use effective-status.sh", () => {
  // SKIPPED: the .pi/skills/openspec-*/SKILL.md files this lint targets are
  // vendored from upstream and gitignored (see .pi/.gitignore) — they get
  // overwritten on every install, so we can't enforce dashboard-local
  // semantics on them from here. Re-enable if/when those skills are
  // forked into the repo, or move the wrapper-enforcement upstream.
  it.skip("no raw `openspec status --json` outside the wrapper script", async () => {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, "..", "..", "..", "..");
    const skillsRoot = path.resolve(repoRoot, ".pi", "skills");

    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const skill of GOVERNED_SKILLS) {
      const skillFile = path.join(skillsRoot, skill, "SKILL.md");
      let content: string;
      try {
        content = await fs.readFile(skillFile, "utf-8");
      } catch {
        // Skill not present in this checkout — fine, skip.
        continue;
      }
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (!RAW_STATUS_RE.test(line)) return;
        if (line.includes(OPT_OUT_MARKER)) return;
        violations.push({
          file: path.relative(repoRoot, skillFile),
          line: idx + 1,
          text: line.trim(),
        });
      });
    }

    if (violations.length > 0) {
      const msg =
        `Raw \`openspec status --json\` invocations found in OpenSpec skills.\n` +
        `Replace each with the wrapper that applies the dashboard's design override:\n` +
        `  .pi/skills/openspec-shared/scripts/effective-status.sh "<name>"\n\n` +
        `Offenders (${violations.length}):\n` +
        violations
          .map((v) => `  ${v.file}:${v.line}  ${v.text}`)
          .join("\n");
      expect(violations, msg).toEqual([]);
    }
  });
});
