import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportRollup, groundingCheck, makeBatches, treeRows } from "../migrate-runner.js";
import type { DirPlan } from "../migrate-file-index.js";

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

describe("migrate-runner: exportRollup (add-only, preserve curated rows)", () => {
  it("adds new source rows, preserves non-source + divergent rows byte-for-byte, inserts one banner", () => {
    const cwd = mkdtempSync(join(tmpdir(), "kb-rollup-"));
    mkdirSync(join(cwd, "docs"), { recursive: true });
    mkdirSync(join(cwd, "packages", "kb", "src"), { recursive: true });
    // existing split: one source hit, one non-source row (package.json) that the tree never has
    writeFileSync(
      join(cwd, "docs", "file-index-kb.md"),
      "# File Index — KB\n\n> note\n\n| File | Purpose |\n|------|---------|\n| `packages/kb/package.json` | npm manifest. |\n| `packages/kb/src/hit.ts` | Curated hit purpose. |\n",
    );
    // tree: hit.ts (same purpose = hit) + miss.ts (new source row)
    writeFileSync(
      join(cwd, "packages", "kb", "src", "AGENTS.md"),
      "# DOX\n\n| File | Purpose |\n|------|---------|\n| `hit.ts` | Curated hit purpose. |\n| `miss.ts` | Authored miss purpose. |\n",
    );
    const r = exportRollup(cwd, { write: true });
    expect(r.perArea.kb.added).toBe(1); // only miss.ts
    const out = readFileSync(join(cwd, "docs", "file-index-kb.md"), "utf8");
    expect(out).toContain("| `packages/kb/package.json` | npm manifest. |"); // non-source preserved
    expect(out).toContain("| `packages/kb/src/hit.ts` | Curated hit purpose. |"); // hit unchanged
    expect(out).toContain("| `packages/kb/src/miss.ts` | Authored miss purpose. |"); // miss added
    expect(out.match(/Source-file rows synced/g)?.length).toBe(1); // exactly one banner
    // idempotent: second run adds nothing, still one banner
    const r2 = exportRollup(cwd, { write: true });
    expect(r2.perArea.kb.added).toBe(0);
    expect(readFileSync(join(cwd, "docs", "file-index-kb.md"), "utf8").match(/Source-file rows synced/g)?.length).toBe(1);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("migrate-runner: treeRows sidecar reconstruction", () => {
  it("resolves a capped `→ see <File>.AGENTS.md` pointer row back to full detail", () => {
    const cwd = mkdtempSync(join(tmpdir(), "kb-sidecar-"));
    const d = join(cwd, "packages", "client", "src", "components");
    mkdirSync(d, { recursive: true });
    // dir AGENTS.md: one lossless inline row + one capped pointer row
    writeFileSync(join(d, "AGENTS.md"), "# DOX\n\n| File | Purpose |\n|------|---------|\n| `Small.tsx` | Short purpose. |\n| `Big.tsx` | Summary only. → see `Big.tsx.AGENTS.md` |\n");
    // sidecar: full detail across two fragments
    writeFileSync(join(d, "Big.tsx.AGENTS.md"), "# Big.tsx — index\n\nFirst fragment detail. See change: alpha.\n\nSecond fragment detail. See change: beta.\n");
    const rows = treeRows(cwd);
    expect(rows.get("packages/client/src/components/Small.tsx")).toBe("Short purpose.");
    const big = rows.get("packages/client/src/components/Big.tsx");
    expect(big).toBe("First fragment detail. See change: alpha.<br>Second fragment detail. See change: beta.");
    expect(big).not.toContain("→ see"); // pointer never leaks into the rollup
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("migrate-runner: exportRollup cross-split dedup", () => {
  it("keeps a path present in >1 split only in its canonical owner, drops it elsewhere", () => {
    const cwd = mkdtempSync(join(tmpdir(), "kb-dedup-"));
    mkdirSync(join(cwd, "docs"), { recursive: true });
    mkdirSync(join(cwd, "packages", "kb", "src"), { recursive: true });
    // same source path duplicated across two splits (kb + extension)
    const dupRow = "| `packages/kb/src/dup.ts` | Curated purpose. |";
    writeFileSync(join(cwd, "docs", "file-index-kb.md"), `# KB\n\n| File | Purpose |\n|------|---------|\n${dupRow}\n| \`packages/kb/src/only.ts\` | Kb only. |\n`);
    writeFileSync(join(cwd, "docs", "file-index-extension.md"), `# EXT\n\n| File | Purpose |\n|------|---------|\n${dupRow}\n`);
    writeFileSync(join(cwd, "packages", "kb", "src", "AGENTS.md"), "# DOX\n\n| File | Purpose |\n|------|---------|\n| `dup.ts` | Curated purpose. |\n| `only.ts` | Kb only. |\n");
    const r = exportRollup(cwd, { write: true });
    const kb = readFileSync(join(cwd, "docs", "file-index-kb.md"), "utf8");
    const ext = readFileSync(join(cwd, "docs", "file-index-extension.md"), "utf8");
    // packages/kb/* → canonical owner = kb; kept in kb, dropped from extension
    expect(kb).toContain("| `packages/kb/src/dup.ts` |");
    expect(ext).not.toContain("packages/kb/src/dup.ts");
    expect(r.perArea.extension.removed).toBe(1);
    expect(r.perArea.kb.removed).toBe(0);
    // idempotent: re-run drops nothing more
    const r2 = exportRollup(cwd, { write: true });
    expect(r2.perArea.extension.removed).toBe(0);
    rmSync(cwd, { recursive: true, force: true });
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
