/**
 * Structural repair of corrupted OpenSpec main specs (test-plan §2).
 *
 * Style mirrors `scripts/__tests__/check-conventions.test.mjs` — drive the
 * exported pure fns directly rather than shelling out, so each rule is pinned
 * independently of the real spec tree.
 *
 * The traps carry the weight here, and every one of them fails SILENTLY in
 * production if the rule regresses:
 *   - a second delta header RENAMED instead of deleted yields a second
 *     `## Requirements` the parser never reads: validate goes green, the
 *     requirements stay invisible.
 *   - a `## REMOVED Requirements` block PROMOTED resurrects retired behaviour
 *     as current specification; no structural check would catch it.
 *   - a cohort-E delta header (after an already-valid `## Requirements`)
 *     promoted rather than deleted produces the same duplicate-section bug.
 *
 * See change: repair-corrupted-main-specs.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifySpec, repairSpecText } from "../repair-main-specs.mjs";

const SCRIPT = fileURLToPath(new URL("../repair-main-specs.mjs", import.meta.url));

const REQ = (name) =>
  [
    `### Requirement: ${name}`,
    "",
    `The system SHALL ${name}.`,
    "",
    `#### Scenario: ${name} happens`,
    "",
    "- **WHEN** a thing occurs",
    "- **THEN** another thing SHALL follow",
    "",
  ].join("\n");

const PURPOSE = ["## Purpose", "", "Some existing authored purpose text.", ""].join("\n");

/** Fixture set (task 2.1). */
const FIXTURES = {
  singleDelta: ["## ADDED Requirements", "", REQ("alpha")].join("\n"),
  twoDelta: ["## ADDED Requirements", "", REQ("alpha"), "## ADDED Requirements", "", REQ("beta")].join(
    "\n",
  ),
  suffixedDelta: [
    "## ADDED Requirements",
    "",
    REQ("alpha"),
    "## ADDED Requirements — Tool Modules",
    "",
    REQ("beta"),
  ].join("\n"),
  // Cohort B: bare `### Requirement:` blocks with NO enclosing h2 at all.
  orphanRequirements: ["### Requirement: alpha", "", "The system SHALL alpha.", "", "#### Scenario: s", "", "- **WHEN** a", "- **THEN** b", ""].join("\n"),
  noDeltaNoPurpose: ["# thing Specification", "", "## Requirements", "", REQ("alpha")].join("\n"),
  removed: ["## REMOVED Requirements", "", REQ("alpha")].join("\n"),
  cohortE: [
    "# thing Specification",
    "",
    PURPOSE,
    "## Requirements",
    "",
    REQ("alpha"),
    "## ADDED Requirements",
    "",
    REQ("beta"),
  ].join("\n"),
  conforming: ["# thing Specification", "", PURPOSE, "## Requirements", "", REQ("alpha")].join("\n"),
};

const h2s = (text) =>
  text
    .split("\n")
    .filter((l) => /^##\s+/.test(l))
    .map((l) => l.replace(/^##\s+/, "").trim());

const countReqs = (text) => text.split("\n").filter((l) => /^###\s+Requirement:/.test(l)).length;

describe("delta header promotion (§2.2)", () => {
  it("promotes the first delta header to a plain Requirements section", () => {
    const { text } = repairSpecText(FIXTURES.singleDelta, "thing");
    expect(h2s(text)).toContain("Requirements");
    expect(text).not.toMatch(/^## ADDED Requirements/m);
  });

  it("DELETES every subsequent delta header rather than renaming it", () => {
    const { text } = repairSpecText(FIXTURES.twoDelta, "thing");
    const reqSections = h2s(text).filter((h) => /^requirements$/i.test(h));
    expect(reqSections).toHaveLength(1);
    expect(text).not.toMatch(/ADDED Requirements/);
  });

  it("treats a suffixed delta header as a delta header and removes it (§2.1)", () => {
    const { text } = repairSpecText(FIXTURES.suffixedDelta, "thing");
    expect(text).not.toMatch(/Tool Modules/);
    expect(h2s(text).filter((h) => /^requirements$/i.test(h))).toHaveLength(1);
  });

  it("preserves every requirement across the deleted header (§2.3)", () => {
    const { text } = repairSpecText(FIXTURES.twoDelta, "thing");
    expect(countReqs(text)).toBe(countReqs(FIXTURES.twoDelta));
    expect(text).toMatch(/### Requirement: beta/);
  });
});

describe("cohort E — delta header after an existing Requirements section (§2.6)", () => {
  it("deletes the trailing delta header instead of promoting it", () => {
    const { text } = repairSpecText(FIXTURES.cohortE, "thing");
    expect(h2s(text).filter((h) => /^requirements$/i.test(h))).toHaveLength(1);
    expect(text).not.toMatch(/ADDED Requirements/);
  });

  it("keeps the orphaned requirements, re-parented into the surviving section", () => {
    const { text } = repairSpecText(FIXTURES.cohortE, "thing");
    expect(countReqs(text)).toBe(2);
    expect(text).toMatch(/### Requirement: beta/);
  });

  it("does not overwrite the authored Purpose", () => {
    const { text } = repairSpecText(FIXTURES.cohortE, "thing");
    expect(text).toMatch(/Some existing authored purpose text/);
    expect(text).not.toMatch(/TODO\(repair\)/);
  });
});

describe("REMOVED refusal (§2.4)", () => {
  it("refuses the repair and names the spec", () => {
    const res = repairSpecText(FIXTURES.removed, "event-persistence");
    expect(res.refused).toBe(true);
    expect(res.reason).toMatch(/REMOVED/);
  });

  it("leaves the file byte-identical", () => {
    const res = repairSpecText(FIXTURES.removed, "event-persistence");
    expect(res.text).toBe(FIXTURES.removed);
    expect(res.changed).toBe(false);
  });

  it("never promotes a REMOVED block to a live Requirements section", () => {
    const { text } = repairSpecText(FIXTURES.removed, "event-persistence");
    expect(h2s(text).filter((h) => /^requirements$/i.test(h))).toHaveLength(0);
  });
});

describe("Purpose and h1 insertion (§3.3)", () => {
  it("inserts a TODO(repair)-marked Purpose when absent", () => {
    const { text } = repairSpecText(FIXTURES.singleDelta, "thing");
    expect(h2s(text)).toContain("Purpose");
    expect(text).toMatch(/TODO\(repair\)/);
  });

  it("inserts the h1 when absent", () => {
    const { text } = repairSpecText(FIXTURES.singleDelta, "thing");
    expect(text.split("\n")[0]).toBe("# thing Specification");
  });

  it("orders Purpose before Requirements", () => {
    const { text } = repairSpecText(FIXTURES.singleDelta, "thing");
    expect(text.indexOf("## Purpose")).toBeLessThan(text.indexOf("## Requirements"));
  });

  it("repairs a no-delta spec by inserting only the missing Purpose", () => {
    const { text } = repairSpecText(FIXTURES.noDeltaNoPurpose, "thing");
    expect(h2s(text)).toEqual(["Purpose", "Requirements"]);
    expect(countReqs(text)).toBe(1);
  });
});

describe("orphaned requirements with no enclosing section (phase-two class)", () => {
  it("inserts a Requirements section before the first requirement", () => {
    const { text } = repairSpecText(FIXTURES.orphanRequirements, "thing");
    expect(h2s(text).filter((h) => /^requirements$/i.test(h))).toHaveLength(1);
    expect(text.indexOf("## Requirements")).toBeLessThan(text.indexOf("### Requirement: alpha"));
  });

  it("still inserts Purpose, ordered before Requirements", () => {
    const { text } = repairSpecText(FIXTURES.orphanRequirements, "thing");
    expect(text.indexOf("## Purpose")).toBeLessThan(text.indexOf("## Requirements"));
  });

  it("keeps every requirement", () => {
    const { text } = repairSpecText(FIXTURES.orphanRequirements, "thing");
    expect(countReqs(text)).toBe(1);
  });

  it("does NOT invent a Requirements section when there are no requirements", () => {
    const tombstoneShaped = [PURPOSE].join("\n");
    const { text } = repairSpecText(tombstoneShaped, "thing");
    expect(text).not.toMatch(/^## Requirements/m);
  });
});

describe("idempotence (§2.5)", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`is a no-op on the second run: ${name}`, () => {
      const first = repairSpecText(fixture, "thing");
      const second = repairSpecText(first.text, "thing");
      expect(second.text).toBe(first.text);
      if (!first.refused) expect(second.changed).toBe(false);
    });
  }

  it("never touches an already-conforming spec", () => {
    const res = repairSpecText(FIXTURES.conforming, "thing");
    expect(res.changed).toBe(false);
    expect(res.text).toBe(FIXTURES.conforming);
  });

  it("does not duplicate Purpose or h1 across runs", () => {
    const once = repairSpecText(FIXTURES.singleDelta, "thing").text;
    const twice = repairSpecText(once, "thing").text;
    expect(twice.split("\n").filter((l) => l === "## Purpose")).toHaveLength(1);
    expect(twice.split("\n").filter((l) => /^# /.test(l))).toHaveLength(1);
  });
});

describe("classification (§3.1)", () => {
  it("recognises a conforming spec", () => {
    expect(classifySpec(FIXTURES.conforming).conforming).toBe(true);
  });

  it("recognises every corrupt fixture as non-conforming", () => {
    for (const key of ["singleDelta", "twoDelta", "suffixedDelta", "noDeltaNoPurpose", "cohortE"]) {
      expect(classifySpec(FIXTURES[key]).conforming, key).toBe(false);
    }
  });

  it("flags a REMOVED block distinctly from an ordinary delta header", () => {
    expect(classifySpec(FIXTURES.removed).hasRemoved).toBe(true);
    expect(classifySpec(FIXTURES.singleDelta).hasRemoved).toBe(false);
  });

  it("counts requirements for the show-count equality assertion", () => {
    expect(classifySpec(FIXTURES.twoDelta).requirementCount).toBe(2);
  });
});

/**
 * Two-phase validation (§2.7) — driven end-to-end because the property under
 * test IS the second `openspec validate` pass, which does not exist at the
 * pure-fn layer. The fixture repairs into a spec that is structurally correct
 * and still invalid (zero requirements), which is exactly the class of defect
 * the missing-Purpose throw masks on the first pass.
 */
describe("two-phase validation (§2.7)", () => {
  const run = (dir) => {
    try {
      const stdout = execFileSync("node", [SCRIPT, "--specs-dir", path.join(dir, "openspec/specs")], {
        encoding: "utf8",
        stdio: "pipe",
      });
      return { code: 0, out: stdout };
    } catch (err) {
      return { code: err.status, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  };

  const scaffold = (name, body) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repair-specs-"));
    fs.mkdirSync(path.join(dir, "openspec/specs", name), { recursive: true });
    fs.writeFileSync(path.join(dir, "openspec/specs", name, "spec.md"), body);
    fs.writeFileSync(path.join(dir, "openspec/project.md"), "# Project\n");
    return dir;
  };

  it("surfaces a phase-two error revealed by its own repair, and exits non-zero", () => {
    // No `### Requirement:` at all: reports only `no-purpose` before repair,
    // then a different error once the Purpose exists.
    const dir = scaffold("empty-cap", "## ADDED Requirements\n");
    const res = run(dir);
    expect(res.code).not.toBe(0);
    expect(res.out).toMatch(/empty-cap/);
    expect(res.out).toMatch(/phase-two/i);
  });

  it("exits zero when every repaired spec validates after the write", () => {
    const dir = scaffold("good-cap", ["## ADDED Requirements", "", REQ("alpha")].join("\n"));
    const res = run(dir);
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/repaired {2}good-cap/);
  });

  it("is idempotent against the real filesystem", () => {
    const dir = scaffold("good-cap", ["## ADDED Requirements", "", REQ("alpha")].join("\n"));
    run(dir);
    const after = fs.readFileSync(path.join(dir, "openspec/specs/good-cap/spec.md"), "utf8");
    run(dir);
    expect(fs.readFileSync(path.join(dir, "openspec/specs/good-cap/spec.md"), "utf8")).toBe(after);
  });
});

describe("blank-line collapse never touches fenced content (review-code finding)", () => {
  it("preserves blank lines inside a code fence", () => {
    const withFence = [
      "## ADDED Requirements",
      "",
      "### Requirement: alpha",
      "",
      "The system SHALL alpha, e.g.:",
      "",
      "```js",
      "const a = 1;",
      "",
      "",
      "const b = 2;",
      "```",
      "",
      "#### Scenario: s",
      "",
      "- **WHEN** a",
      "- **THEN** b",
      "",
    ].join("\n");
    const { text } = repairSpecText(withFence, "thing");
    expect(text).toMatch(/const a = 1;\n\n\nconst b = 2;/);
  });

  it("still collapses blank runs outside fences", () => {
    const gappy = ["## ADDED Requirements", "", "", "", REQ("alpha")].join("\n");
    const { text } = repairSpecText(gappy, "thing");
    expect(text).not.toMatch(/\n\n\n/);
  });
});
