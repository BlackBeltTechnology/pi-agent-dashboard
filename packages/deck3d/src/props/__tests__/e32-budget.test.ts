/**
 * E32 — the prop budget is a warning, never a failure: ≤ 5 props and ≤
 * 10,485,760 cached bytes validate clean; one over either bound still exits 0
 * but states the count and/or the total bytes.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validIR } from "../../ir/__tests__/fixtures.js";
import type { PropOverride } from "../../ir/types.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const MIB = 1024 * 1024;
const BYTE_BUDGET = 10 * MIB; // 10,485,760
const COUNT_BUDGET = 5;
const IDS = ["robot", "cube", "shield", "cloud", "server", "laptop"];

function cli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

/** Deck with `sizes.length` props, each cached at `.deck3d/props/vendored-<id>.glb`. */
function deckWith(sizes: number[]): string {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-e32-"));
  const ir = validIR();
  ir.overrides.props = sizes.map((_, i) => {
    return {
      source: "vendored",
      id: IDS[i],
      licence: "CC0-1.0",
      author: "deck3d corpus",
      sha256: "a".repeat(64),
      slide: "intro",
      role: "illustration",
    } satisfies PropOverride;
  });
  writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);
  mkdirSync(join(dir, ".deck3d", "props"), { recursive: true });
  sizes.forEach((size, i) => writeFileSync(join(dir, ".deck3d", "props", `vendored-${IDS[i]}.glb`), Buffer.alloc(size)));
  return dir;
}

describe("E32 prop budget warning", () => {
  it("5 props totalling exactly the byte budget produce no warning", () => {
    const dir = deckWith(Array.from({ length: COUNT_BUDGET }, () => BYTE_BUDGET / COUNT_BUDGET));
    const r = cli(["validate", "deck.json"], dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("valid");
    expect(r.stderr).not.toMatch(/^warn /m);
  });

  it("6 props warn with the count and the total bytes, exit 0", () => {
    const dir = deckWith(Array.from({ length: COUNT_BUDGET + 1 }, () => BYTE_BUDGET / COUNT_BUDGET));
    const r = cli(["validate", "deck.json"], dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain(`${COUNT_BUDGET + 1} props exceed the budget of ${COUNT_BUDGET}`);
    expect(r.stderr).toContain(`${12_582_912} bytes exceed the budget of ${BYTE_BUDGET}`);
  });

  it("5 props one byte over the byte budget warn about bytes only, exit 0", () => {
    const dir = deckWith([BYTE_BUDGET / COUNT_BUDGET + 1, ...Array.from({ length: COUNT_BUDGET - 1 }, () => BYTE_BUDGET / COUNT_BUDGET)]);
    const r = cli(["validate", "deck.json"], dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain(`${BYTE_BUDGET + 1} bytes exceed the budget of ${BYTE_BUDGET}`);
    expect(r.stderr).not.toContain("props exceed the budget of");
  });
});
