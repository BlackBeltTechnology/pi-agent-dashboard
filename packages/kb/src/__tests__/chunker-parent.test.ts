/**
 * chunkMarkdown parent linkage: a chunk's parentChunkId names the first chunk of
 * its direct enclosing section, or null when that section emitted no chunk.
 * See change: fix-kb-parent-link-and-section-miss (test-plan #E1–#E8).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "../chunker.js";
import type { Chunk } from "../types.js";

const body = (n: number, ch = "x") => ch.repeat(n);
const chunk = (text: string) => chunkMarkdown({ root: "r", path: "a.md", text }).chunks;
const byPath = (cs: Chunk[], hp: string) => {
  const c = cs.find((x) => x.headingPath === hp);
  if (!c) throw new Error(`no chunk ${hp}: ${cs.map((x) => x.headingPath).join(" | ")}`);
  return c;
};

describe("chunker parent linkage", () => {
  it("E1 siblings share the enclosing parent", () => {
    const cs = chunk(["# Title", body(120), "## A", body(120, "a"), "## B", body(120, "b")].join("\n"));
    const t = byPath(cs, "Title");
    const a = byPath(cs, "Title > A");
    const b = byPath(cs, "Title > B");
    expect(a.parentChunkId).toBe(t.chunkId);
    expect(b.parentChunkId).toBe(t.chunkId);
    expect(a.parentChunkId).not.toBe(a.chunkId);
    expect(b.parentChunkId).not.toBe(a.chunkId);
  });

  it("E2 parent survives a blank preamble (judo extension-points shape)", () => {
    const lines = ["---", "title: Frontend Extension Points", "---", "", "# Frontend Extension Points", body(98, "i")];
    for (let i = 0; i < 12; i++) lines.push(`## Section ${i}`, body(200, String.fromCharCode(97 + i)));
    lines.push("### Nested", body(150, "n"));
    const cs = chunk(lines.join("\n"));
    const top = byPath(cs, "Frontend Extension Points");
    expect(top.chunkId.endsWith(":0")).toBe(true);
    for (let i = 0; i < 12; i++) expect(byPath(cs, `Frontend Extension Points > Section ${i}`).parentChunkId).toBe(top.chunkId);
    expect(byPath(cs, "Frontend Extension Points > Section 11 > Nested").parentChunkId).toBe(byPath(cs, "Frontend Extension Points > Section 11").chunkId);
    for (const c of cs) expect(c.parentChunkId).not.toBe(c.chunkId);
  });

  it("E3 a chunkless (empty) enclosing section yields a null parent", () => {
    const cs = chunk(["# Title", body(120), "## P", "### C", body(120, "c")].join("\n"));
    const c = byPath(cs, "Title > P > C");
    expect(c.parentChunkId).toBeNull();
  });

  it("E4 tiny-merge boundary: 99 → merged away (null), 100 → own chunk", () => {
    const mk = (n: number) => chunk(["# Title", body(120), "## P", body(n, "p"), "### C", body(120, "c")].join("\n"));
    const c99 = byPath(mk(99), "Title > P > C");
    expect(c99.parentChunkId).toBeNull();
    const cs100 = mk(100);
    expect(byPath(cs100, "Title > P > C").parentChunkId).toBe(byPath(cs100, "Title > P").chunkId);
  });

  it("E5 children of an oversize-split parent reference its first piece", () => {
    const cs = chunk(["## Big", body(2600, "p"), "", body(2600, "q"), "### Kid", body(120, "k")].join("\n"));
    const big = cs.filter((c) => c.headingPath === "Big");
    expect(big.length).toBeGreaterThanOrEqual(2);
    expect(byPath(cs, "Big > Kid").parentChunkId).toBe(big[0].chunkId);
  });

  it("E6 no whitespace-only split piece", () => {
    const p1 = body(4500, "p");
    const cs = chunk(`## Big\n\n\n\n${p1}\n\n${body(600, "q")}\n`);
    for (const c of cs) expect(c.body.trim()).not.toBe("");
    const big = cs.filter((c) => c.headingPath === "Big");
    expect(big[0].body.startsWith(p1)).toBe(true);
  });

  it("E7 skipped heading level links to the enclosing heading", () => {
    const cs = chunk(["# T", body(120), "### C", body(120, "c")].join("\n"));
    const c = byPath(cs, "T > C");
    expect(c.parentChunkId).toBe(byPath(cs, "T").chunkId);
  });

  it("E8 invariant over repo docs/ and openspec/specs/", () => {
    const repo = join(__dirname, "../../../..");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (e.endsWith(".md")) files.push(p);
      }
    };
    walk(join(repo, "docs"));
    walk(join(repo, "openspec/specs"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const cs = chunkMarkdown({ root: "r", path: relative(repo, f), text: readFileSync(f, "utf8") }).chunks;
      const ids = new Map(cs.map((c) => [c.chunkId, c]));
      for (const c of cs) {
        if (!c.parentChunkId) continue;
        const p = ids.get(c.parentChunkId);
        expect(p, `${f} ${c.headingPath}`).toBeDefined();
        expect(c.parentChunkId).not.toBe(c.chunkId);
        // direct parent: the child's path is exactly the parent's path plus its own heading
        expect(`${p!.headingPath} > ${c.heading}`, f).toBe(c.headingPath);
      }
    }
  });
});
