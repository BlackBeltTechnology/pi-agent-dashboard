/**
 * slugifyBranch: parity with the previous regex chain (oracle) + linear-time budget.
 * See change: fix-codeql-small-findings (test-plan #E5 #P4).
 */
import { describe, expect, it } from "vitest";
import { slugifyBranch } from "../git-worktree-helpers.js";

const oldSlugify = (branch: string) =>
  branch
    .toLowerCase()
    .replace(/[\/\\:\s]+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("slugifyBranch", () => {
  it("E5: edge list", () => {
    expect(slugifyBranch("-feat")).toBe("feat");
    expect(slugifyBranch("--x--")).toBe("x");
    expect(slugifyBranch("/foo")).toBe("foo");
    for (const s of ["-feat", "--x--", "/foo", "a/b", "", "x".repeat(70), "-".repeat(70), `${"a".repeat(63)}-b`]) {
      expect(slugifyBranch(s), JSON.stringify(s)).toBe(oldSlugify(s));
    }
  });

  it("E5: 20 000 seeded random strings match the oracle", () => {
    const rnd = mulberry32(0x51a6);
    const alphabet = ["-", "/", "\\", ":", " ", "A", "a", "9", ".", "_", "é"];
    let diffs = 0;
    for (let n = 0; n < 20_000; n++) {
      const len = Math.floor(rnd() * 80);
      let s = "";
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      if (slugifyBranch(s) !== oldSlugify(s)) diffs++;
    }
    expect(diffs).toBe(0);
  });

  it("P4: a 100 000-dash run stays under 100 ms", () => {
    const input = `a${"-".repeat(100_000)}a`;
    const t0 = performance.now();
    const out = slugifyBranch(input);
    expect(performance.now() - t0).toBeLessThan(100);
    // Interior dashes are not collapsed; only the 64-char cap applies. (The oracle is quadratic on this input, so the value is spelled out.)
    expect(out).toBe(`a${"-".repeat(63)}`);
    expect(oldSlugify(`a${"-".repeat(2_000)}a`)).toBe(slugifyBranch(`a${"-".repeat(2_000)}a`));
  });
});
