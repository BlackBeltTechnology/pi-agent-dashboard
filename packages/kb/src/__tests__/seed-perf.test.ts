// K1 timed: a seeded first index costs a fraction of an unseeded one. See change:
// add-kb-worktree-seed (test-plan P1).
import { rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { addWorktree, indexAt, mkMain, sh, useSeedTree, writeFile } from "./helpers/seed-fixture.js";

const t = useSeedTree();

const FILLER = Array.from({ length: 600 }, (_, w) => `word${w}`).join(" ");

/** A document with 8 headings. */
const big = (i: number, tag = ""): string =>
  [`# Doc ${i}`, "", ...Array.from({ length: 8 }, (_, h) => `## Heading ${h}\n\nSection ${h} of document ${i} ${tag} carries the unique token tok${tag}${i}x${h}. ${FILLER}\n`)].join("\n");

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Time one first index of a fresh worktree whose first 30 files (5 %) differ from main. */
async function timedFirstIndex(mode: "seeded" | "unseeded", run: number): Promise<number> {
  const wt = addWorktree(t, `${mode}${run}`);
  for (let i = 0; i < 30; i++) writeFile(wt, `docs/f${i}.md`, big(i, "edited"));
  const t0 = performance.now();
  const r = await indexAt(wt, { noSeed: mode === "unseeded" });
  const ms = performance.now() - t0;
  if (mode === "seeded") {
    expect(r.lines[0]).toMatch(/^\[kb\] seed=/);
    expect(r.stats.changed).toBe(30); // K1 structural: only the changed files re-chunked
  }
  rmSync(wt, { recursive: true, force: true }); // bound temp disk: each checkout is ~20 MB
  return ms;
}

describe("seeded vs unseeded first index time", () => {
  it("P1 median seeded ≤ 0.35 × median unseeded (600 files × 8 headings, 5 % changed)", async () => {
    mkMain(t, { docs: 0, pkgs: 0, config: { sources: [{ ref: "docs" }], include: ["**/*.md"] } });
    for (let i = 0; i < 600; i++) writeFile(t.main, `docs/f${i}.md`, big(i));
    sh(t.main, "add", "-A");
    sh(t.main, "commit", "-q", "-m", "docs");
    await indexAt(t.main);

    const seeded: number[] = [];
    const unseeded: number[] = [];
    for (let run = 0; run < 3; run++) {
      seeded.push(await timedFirstIndex("seeded", run));
      unseeded.push(await timedFirstIndex("unseeded", run));
    }
    expect(median(seeded)).toBeLessThanOrEqual(0.35 * median(unseeded));
  }, 300_000);
});
