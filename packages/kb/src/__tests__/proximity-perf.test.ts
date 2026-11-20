// Tests for change: bound-kb-proximity-search — pathological proximity inputs
// finish fast and never block the event loop (design D1, D5). Folded from
// openspec/changes/bound-kb-proximity-search/test-plan.md (#P1, #P2, #P3, #F1).
// The timed work runs in a child killed after a hard cap: before the fix the
// exponential DFS never finishes, and the cap turns that into a failure, not a
// hung runner. Exemplar: helpers/lease-worker.mts + git-scope-lease.test.ts.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CHILD = join(import.meta.dirname, "helpers", "proximity-perf-child.mts");
const CAP_MS = 45_000;

function runChild(mode: "delta" | "search" | "pool"): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", CHILD, mode], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const cap = setTimeout(() => child.kill("SIGKILL"), CAP_MS);
    child.on("close", (code, signal) => { // after stdio drained, unlike "exit"
      clearTimeout(cap);
      const line = out.split("\n").find((l) => l.startsWith("{"));
      if (signal === "SIGKILL") return reject(new Error(`child killed by the ${CAP_MS} ms cap (proximity search did not finish)`));
      if (code !== 0 || !line) return reject(new Error(`child exited ${code}: ${err}`));
      resolve(JSON.parse(line));
    });
  });
}
const closedForm = (k: number) => -Math.max(0, 2 - (k - 1) / 20);

describe("proximity performance (child-capped)", () => {
  it("P1: proximityDelta on ≥10 terms × 100 interleaved repeats is < 100 ms and exact", async () => {
    const r = await runChild("delta");
    for (const [key, k] of [["10x100", 10], ["6x50", 6], ["8x100", 8]] as const) {
      expect(r[key].ms).toBeLessThan(100);
      expect(r[key].value).toBeCloseTo(closedForm(k), 10);
    }
  }, CAP_MS + 5_000);

  it("P2/F1: end-to-end store.search over the pathological chunk (and a ≈450 KB one) is < 100 ms, boosted, no warn, no event-loop block", async () => {
    const r = await runChild("search");
    const s = r.search;
    expect(s.bigChars).toBeGreaterThan(440_000);
    expect(s.paths).toEqual(expect.arrayContaining(["small.md", "big.md"]));
    expect(s.ms).toBeLessThan(100);
    expect(s.boost["small.md"]).toBeCloseTo(closedForm(10), 10);
    expect(s.boost["big.md"]).toBeCloseTo(closedForm(10), 10);
    expect(r.warns).toBe(0); // the budget guard did not fire
    expect(s.maxDelayMs).toBeLessThan(100);
    expect(s.elapsedMs).toBeLessThan(100);
  }, CAP_MS + 5_000);

  it("P3: a 600-doc pool (≈5 KB each, 6 interleaved terms × 20) searches in < 100 ms without the guard firing", async () => {
    const r = await runChild("pool");
    expect(r.pool.hits).toBe(10);
    expect(r.pool.ms).toBeLessThan(100);
    expect(r.warns).toBe(0);
  }, CAP_MS + 5_000);
});
