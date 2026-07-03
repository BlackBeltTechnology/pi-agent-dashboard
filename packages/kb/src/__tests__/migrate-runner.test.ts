import { describe, expect, it } from "vitest";
import type { DirPlan } from "../migrate-file-index.js";
import { groundingCheck, makeBatches } from "../migrate-runner.js";

describe("migrate-runner: groundingCheck", () => {
  const src = `
export function renderSessionFlowActions(input) {}
export const stateStore = new StateStore();
class StateStore { __resetForTests() {} setFlows() {} }
`;
  it("passes when every backticked identifier appears in source", () => {
    const r = groundingCheck("Exports `renderSessionFlowActions`, `stateStore`, `__resetForTests`, `setFlows`.", src);
    expect(r.ok).toBe(true);
  });
  it("flags a hallucinated export", () => {
    const r = groundingCheck("Exports `renderSessionFlowActions` and `deleteEverything`.", src);
    expect(r.ok).toBe(false);
    expect(r.ungrounded).toContain("deleteEverything");
  });
  it("ignores acronyms and short/common words (no false positives)", () => {
    const r = groundingCheck("No React, no DOM — JSON intent only. Pure fn.", src);
    expect(r.ok).toBe(true);
  });
  it("suppresses cross-references to other source-file stems via known set", () => {
    const known = new Set(["MermaidBlock", "FlowGraph"]);
    const r = groundingCheck("Used by `MermaidBlock`, `FlowGraph`.", src, known);
    expect(r.ok).toBe(true); // consumers, not local symbols → not flagged
  });
});

describe("migrate-runner: makeBatches", () => {
  const mk = (dir: string, misses: number, hits = 0): DirPlan => ({
    dir,
    tier: misses > 0 ? 1 : 0,
    files: [
      ...Array.from({ length: hits }, (_, i) => ({ rel: `${dir}/h${i}.ts`, base: `h${i}.ts`, status: "hit" as const, purpose: "p" })),
      ...Array.from({ length: misses }, (_, i) => ({ rel: `${dir}/m${i}.ts`, base: `m${i}.ts`, status: "miss" as const })),
    ],
  });

  it("splits a dir with >maxMiss misses into sequential same-dir batches", () => {
    const batches = makeBatches([mk("a", 30)], { maxMiss: 20, maxDirs: 8 });
    expect(batches.length).toBe(2);
    expect(batches[0].miss.length).toBe(20);
    expect(batches[1].miss.length).toBe(10);
    expect(batches.every((b) => b.dirs.length === 1 && b.dirs[0] === "a")).toBe(true);
  });

  it("coalesces small sibling dirs up to caps and skips tier-0 dirs", () => {
    const batches = makeBatches([mk("a", 3), mk("b", 4), mk("c", 0, 5), mk("d", 2)], { maxMiss: 20, maxDirs: 8 });
    expect(batches.length).toBe(1); // a+b+d coalesced, c (tier-0) excluded
    expect(batches[0].dirs.sort()).toEqual(["a", "b", "d"]);
    expect(batches[0].miss.length).toBe(9);
  });

  it("flushes when maxDirs reached", () => {
    const plans = ["a", "b", "c"].map((d) => mk(d, 1));
    const batches = makeBatches(plans, { maxMiss: 20, maxDirs: 2 });
    expect(batches.length).toBe(2); // a,b then c
  });
});
