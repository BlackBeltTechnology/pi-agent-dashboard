// Opt-in baseline / after measurement (change: throttle-kb-reindex, tasks 1.1/1.2/3.7;
// test-plan #S77/#S78). `KB_MEASURE=1 npx vitest run reindex-measure` prints one JSON
// line; non-gating by design (in-process lag is expected > 200 ms — the worker closes it).
// Corpus size: KB_MEASURE_FILES (default 3250 files (3000 selected; 1 in 13 gitignored) × 16 sections ≈ 51k chunks).
import { describe, expect, it } from "vitest";
import { measureReindex } from "./helpers/measure-reindex.js";

describe.skipIf(!process.env.KB_MEASURE)("KB_MEASURE: forced in-process reindex", () => {
  it("reports max/p99 event-loop delay, wall ms, commits, chunks, files", async () => {
    const files = Number(process.env.KB_MEASURE_FILES ?? 3250);
    const m = await measureReindex({ files });
    console.log(`KB_MEASURE ${JSON.stringify(m)}`);
    expect(m.chunks).toBeGreaterThan(0);
  }, 900_000);
});
