/**
 * E6 (task 10.6) — ir: Override target vanished (orphan = warn).
 *
 * A target carries `overrides.nodes["arch/Z"]`; the markdown no longer supplies
 * node `Z` (its diagram is gone), so parse keeps the override and warns. A
 * subsequent `validate` reports the same orphan as a warning (exit 0), and the
 * key is still present in the file.
 *
 * Interpretation: the plan says "node Z removed from mermaid". Exercising the
 * real harvest needs chromium, but E6 is an L1 row, so the derived diagram is
 * removed at the markdown level (`# Arch` with no mermaid block) — the override
 * target is just as absent, which is the observable that matters.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const PARSE_WARNING = 'warn orphan override overrides.nodes["arch/Z"]';
const ORPHAN_PATH = 'overrides.nodes["arch/Z"]';

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

interface DeckJson {
  overrides: { nodes?: Record<string, { shape?: string }> };
}

describe("E6 orphan override is a warning", () => {
  it("keeps the orphan node override through parse and validate, warning with exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e6-"));
    writeFileSync(join(dir, "arch.md"), "# Arch\n\n- a\n");

    const first = runCli(["parse", "arch.md", "-o", "target.json"], dir);
    expect(first.status, first.stderr).toBe(0);
    const targetPath = join(dir, "target.json");
    const deck = JSON.parse(readFileSync(targetPath, "utf8")) as DeckJson;
    deck.overrides.nodes = { "arch/Z": { shape: "hexagon" } };
    writeFileSync(targetPath, JSON.stringify(deck, null, 2));

    const reparsed = runCli(["parse", "arch.md", "-o", "target.json"], dir);
    expect(reparsed.status, reparsed.stderr).toBe(0);
    expect(reparsed.stderr).toContain(PARSE_WARNING);

    // `validate` reports the same orphan through its `warn <path>: <reason>`
    // formatter (the row's "same warning" means the same orphan, not the same
    // sentence as `parse`).
    const validated = runCli(["validate", "target.json"], dir);
    expect(validated.status, validated.stderr).toBe(0);
    expect(validated.stderr).toContain(ORPHAN_PATH);
    expect(validated.stderr).toContain("orphan override");

    // The override is kept, inert.
    const after = JSON.parse(readFileSync(targetPath, "utf8")) as DeckJson;
    expect(after.overrides.nodes?.["arch/Z"]).toEqual({ shape: "hexagon" });
  });
});
