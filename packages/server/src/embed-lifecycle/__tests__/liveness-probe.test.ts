/**
 * Liveness probe (test-plan #E12 gear-1 child check, #E15 phantom CPU signal):
 * the pure tree-walk sums CPU across a session's pi tree and counts live
 * children, and the injectable `ps` runner lets the reaper drive both gates
 * deterministically.
 * See change: add-embed-session-lifecycle.
 */
import { describe, expect, it } from "vitest";
import {
  createLivenessProbe,
  type PsRow,
  parsePsOutput,
  summarizeProcessTree,
} from "../liveness-probe.js";

// pi(100) → keeper(200) → child(300); an unrelated tree at 900.
const TREE: PsRow[] = [
  { pid: 1, ppid: 0, cpu: 0 },
  { pid: 100, ppid: 1, cpu: 0.1 },
  { pid: 200, ppid: 100, cpu: 0.2 },
  { pid: 300, ppid: 200, cpu: 12.5 },
  { pid: 900, ppid: 1, cpu: 40 },
];

describe("summarizeProcessTree", () => {
  it("counts descendants and sums CPU across the root's tree", () => {
    const snap = summarizeProcessTree(TREE, 100);
    expect(snap.ok).toBe(true);
    expect(snap.childCount).toBe(2); // 200 + 300
    expect(snap.cpuPercent).toBeCloseTo(0.1 + 0.2 + 12.5);
  });

  it("reports a wedged (~0 CPU) leaf-less root as no children, ~0 CPU", () => {
    const snap = summarizeProcessTree([{ pid: 100, ppid: 1, cpu: 0 }], 100);
    expect(snap.childCount).toBe(0);
    expect(snap.cpuPercent).toBe(0);
  });

  it("excludes unrelated trees", () => {
    const snap = summarizeProcessTree(TREE, 900);
    expect(snap.childCount).toBe(0);
    expect(snap.cpuPercent).toBe(40);
  });

  it("returns an empty snapshot when the root pid is gone", () => {
    expect(summarizeProcessTree(TREE, 42)).toEqual({ ok: true, childCount: 0, cpuPercent: 0 });
  });
});

describe("parsePsOutput", () => {
  it("parses whitespace-columned ps rows and tolerates junk lines", () => {
    const rows = parsePsOutput("  100   1  0.1\n 200 100 12.5\n\ngarbage\n");
    expect(rows).toEqual([
      { pid: 100, ppid: 1, cpu: 0.1 },
      { pid: 200, ppid: 100, cpu: 12.5 },
    ]);
  });
});

describe("createLivenessProbe", () => {
  it("summarizes via the injected ps runner", async () => {
    const probe = createLivenessProbe({
      runPs: async () => "100 1 0.1\n200 100 5\n",
    });
    const snap = await probe(100);
    expect(snap).toEqual({ ok: true, childCount: 1, cpuPercent: 5.1 });
  });

  it("returns ok:false when ps throws (safe unknown)", async () => {
    const probe = createLivenessProbe({
      runPs: async () => {
        throw new Error("ps failed");
      },
    });
    expect(await probe(100)).toEqual({ ok: false, childCount: 0, cpuPercent: 0 });
  });
});
