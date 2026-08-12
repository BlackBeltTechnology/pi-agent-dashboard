/**
 * Dead-code ratchet (test-plan #R1–#R6).
 *
 * The load-bearing case is #R2: a scalar total would let one deleted file pay
 * for two new dead exports, so the count falls while the codebase gets worse.
 * Per-class comparison is the whole point of the gate.
 *
 * See change: add-knip-dead-code-oracle.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { baselineIncreases, countIssues, GATED_CLASSES, ratchetDecision } from "../knip-ratchet.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const committed = JSON.parse(readFileSync(join(REPO_ROOT, "knip-baseline.json"), "utf8"));
const baseOf = (counts) => ({ counts });

describe("countIssues", () => {
  it("sums each class across the report", () => {
    const report = {
      issues: [
        { file: "a.ts", exports: [{ name: "x" }, { name: "y" }], types: [], files: [], duplicates: [] },
        { file: "b.ts", exports: [], types: [{ name: "T" }], files: ["b.ts"], duplicates: [] },
      ],
    };
    expect(countIssues(report)).toEqual({ files: 1, exports: 2, types: 1, duplicates: 0, enumMembers: 0 });
  });

  it("returns zeros for an empty report rather than throwing", () => {
    expect(countIssues({ issues: [] })).toEqual({ files: 0, exports: 0, types: 0, duplicates: 0, enumMembers: 0 });
  });
});

describe("ratchetDecision", () => {
  it("#R1 fails a class above its baseline and names class/baseline/current", () => {
    const d = ratchetDecision(baseOf({ exports: 227 }), { exports: 228 });
    expect(d.ok).toBe(false);
    expect(d.violations).toEqual([{ class: "exports", baseline: 227, current: 228, delta: 1 }]);
  });

  it("#R2 a drop in one class cannot mask a rise in another", () => {
    // total 237 -> 238 here, but the point is that it fails on `exports` even
    // when `files` improves; a scalar total gate is what this rules out.
    const d = ratchetDecision(baseOf({ files: 10, exports: 227 }), { files: 9, exports: 229 });
    expect(d.ok).toBe(false);
    expect(d.violations.map((v) => v.class)).toEqual(["exports"]);
  });

  it("#R2 a scalar total would have passed the same input", () => {
    const baseline = { files: 10, exports: 227 };
    const current = { files: 9, exports: 228 };
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(sum(current)).toBe(sum(baseline)); // a total gate: indistinguishable
    expect(ratchetDecision(baseOf(baseline), current).ok).toBe(false); // per-class: caught
  });

  it("#R3 passes when every class is exactly at baseline", () => {
    expect(ratchetDecision(committed, committed.counts).ok).toBe(true);
  });

  it("#R3 passes when a class is below baseline", () => {
    expect(ratchetDecision(baseOf({ exports: 227 }), { exports: 200 }).ok).toBe(true);
  });

  it("#R5 fails loudly with no baseline instead of adopting current counts", () => {
    for (const absent of [null, undefined, {}, { notCounts: 1 }]) {
      const d = ratchetDecision(absent, { exports: 999 });
      expect(d.ok).toBe(false);
      expect(d.missingBaseline).toBe(true);
    }
  });

  it("#R6 is deterministic on the same input", () => {
    const args = [baseOf({ exports: 227 }), { exports: 228 }];
    expect(ratchetDecision(...args)).toEqual(ratchetDecision(...args));
  });
});

describe("baselineIncreases", () => {
  it("#R4 rejects a raised ceiling", () => {
    const raised = baselineIncreases(baseOf({ exports: 227 }), baseOf({ exports: 230 }));
    expect(raised).toEqual([{ class: "exports", from: 227, to: 230 }]);
  });

  it("#R4 allows lowering, which is the point of the ratchet", () => {
    expect(baselineIncreases(baseOf({ exports: 227 }), baseOf({ exports: 100 }))).toEqual([]);
  });

  it("#R4 catches a raise hidden behind a lowering of another class", () => {
    const raised = baselineIncreases(baseOf({ files: 10, exports: 227 }), baseOf({ files: 2, exports: 300 }));
    expect(raised.map((r) => r.class)).toEqual(["exports"]);
  });
});

describe("the committed baseline", () => {
  it("records a number for every gated class", () => {
    for (const cls of GATED_CLASSES) expect(typeof committed.counts[cls]).toBe("number");
  });

  it("#R6 requires no network — the enforcer imports only node builtins", () => {
    const src = readFileSync(join(REPO_ROOT, "scripts/knip-ratchet.mjs"), "utf8");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(i).toMatch(/^node:/);
  });
});
