/**
 * Wiring test: the orchestrator skills carry the `ask_user` situation-brief rule
 * (task, why asking, per-option outcome; >= 240 chars) so questions answered from
 * the global question stack need no generated brief.
 * See change: add-pending-question-stack (test-plan task 8.2).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const skillsDir = path.resolve(__dirname, "../../..");

describe("situation-brief rule wiring", () => {
  for (const skill of ["plan-proposal", "ship-it", "ship-change"]) {
    it(`${skill} carries the situation-brief rule`, () => {
      const text = fs.readFileSync(path.join(skillsDir, skill, "SKILL.md"), "utf8");
      expect(text).toContain("## Situation brief for `ask_user`");
      expect(text).toMatch(/at least 240 characters/);
      expect(text).toMatch(/\*\*Task\*\*/);
      expect(text).toMatch(/\*\*Why asking\*\*/);
      expect(text).toMatch(/\*\*Per-option outcome\*\*/);
    });
  }
});
