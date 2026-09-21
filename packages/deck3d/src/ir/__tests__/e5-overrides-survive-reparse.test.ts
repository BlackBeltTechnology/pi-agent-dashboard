/**
 * E5 (task 10.5) — ir: Overrides survive re-parse.
 *
 * A target carries `overrides.nodes["arch/A"].shape="hexagon"`; the markdown is
 * then edited so slide `arch` gains one bullet. Re-parse regenerates the derived
 * bullets (+1) and reapplies the override unchanged, exit 0.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

interface DeckJson {
  slides: Array<{ id: string; bullets: string[] }>;
  overrides: { nodes?: Record<string, { shape?: string }> };
}

describe("E5 overrides survive re-parse", () => {
  it("regenerates the derived bullets and reapplies the node override", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e5-"));
    writeFileSync(join(dir, "arch.md"), "# Arch\n\n- one\n");

    const first = runCli(["parse", "arch.md", "-o", "target.json"], dir);
    expect(first.status, first.stderr).toBe(0);
    const targetPath = join(dir, "target.json");
    const before = JSON.parse(readFileSync(targetPath, "utf8")) as DeckJson;
    expect(before.slides[0].bullets).toHaveLength(1);

    // Author a node override into the target.
    before.overrides.nodes = { "arch/A": { shape: "hexagon" } };
    writeFileSync(targetPath, JSON.stringify(before, null, 2));

    // Edit the markdown: slide `arch` gains one bullet.
    writeFileSync(join(dir, "arch.md"), "# Arch\n\n- one\n- two\n");
    const second = runCli(["parse", "arch.md", "-o", "target.json"], dir);
    expect(second.status, second.stderr).toBe(0);

    const after = JSON.parse(readFileSync(targetPath, "utf8")) as DeckJson;
    const slide = after.slides.find((s) => s.id === "arch");
    expect(slide?.bullets).toEqual(["one", "two"]);
    expect(after.overrides.nodes?.["arch/A"].shape).toBe("hexagon");
  });
});
