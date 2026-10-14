/**
 * chunkMarkdown link extraction: edge list, differential fuzz vs the previous
 * `matchAll` regexes (oracle), and linear-time budgets.
 * See change: fix-codeql-small-findings (test-plan #E3 #E4 #P3).
 */
import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "../chunker.js";

const links = (text: string) => {
  const r = chunkMarkdown({ root: "r", path: "a.md", text });
  return { wikilinks: r.wikilinks, mdLinks: r.mdLinks };
};
const oldLinks = (text: string) => ({
  wikilinks: [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim()),
  mdLinks: [...text.matchAll(/\]\(([^)]+\.mdx?)\)/g)].map((m) => m[1].trim()),
});

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("chunker links", () => {
  it("E3: edge inputs", () => {
    const text = "[[target]] [[ spaced ]] [[ ]] [[a]b]] [[[a]] [x](docs/a.md) [y](b.mdx) [z](c.txt) [w](a(b).md) [v](a.md ) ](.md)";
    const r = links(text);
    expect(r.wikilinks).toEqual(["target", "spaced", "", "[a"]);
    expect(r.mdLinks).toEqual(["docs/a.md", "b.mdx"]);
    expect(r).toEqual(oldLinks(text));
  });

  it("E4: 50 000 seeded random strings match the old regexes", () => {
    const rnd = mulberry32(0xc0de);
    const alphabet = ["[", "]", "(", ")", ".", "m", "d", "x", "a", " "];
    let diffs = 0;
    for (let n = 0; n < 50_000; n++) {
      const len = Math.floor(rnd() * 24);
      let s = "";
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      if (JSON.stringify(links(s)) !== JSON.stringify(oldLinks(s))) diffs++;
    }
    expect(diffs).toBe(0);
  });

  it("P3: unclosed openers stay under 100 ms", () => {
    for (const text of ["[[a".repeat(33_000), "](a".repeat(33_000), `${"](a".repeat(33_000)})`]) {
      const t0 = performance.now();
      const r = links(text);
      expect(performance.now() - t0).toBeLessThan(100);
      expect(r).toEqual({ wikilinks: [], mdLinks: [] });
    }
  });
});
