import { describe, expect, it } from "vitest";
import { fitBlocks } from "../fit-worker.js";

describe("fitBlocks is total", () => {
  it("a non-array blocks field resolves instead of throwing", async () => {
    // The in-process fallback awaits this directly; a throw there skips
    // `finish()` and strands the caller's promise forever.
    const out = await fitBlocks({ jobId: 1, blocks: undefined as never });
    expect(out.jobId).toBe(1);
    expect(out.results).toEqual([]);
  });

  it("a null block resolves failed rather than throwing", async () => {
    const out = await fitBlocks({ jobId: 2, blocks: [null as never] });
    expect(out.results).toHaveLength(1);
    expect(out.results[0].failed).toBe(true);
  });

  it("a block with missing fields resolves failed and keeps its ordinal", async () => {
    const out = await fitBlocks({
      jobId: 3,
      blocks: [{ blockIndex: 7 } as never, { blockIndex: 8, data: 5, mimeType: "image/png" } as never],
    });
    expect(out.results.map((r) => r.blockIndex)).toEqual([7, 8]);
    for (const r of out.results) expect(r.failed).toBe(true);
  });
});
