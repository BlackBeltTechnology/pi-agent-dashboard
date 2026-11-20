// Shared section-fetch resolver: multi-root resolution, source-qualified paths,
// collision candidates, last-heading section fallback.
// Folded from openspec/changes/fix-kb-get-roots-and-guard/test-plan.md (E1, E2, E4–E15).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFetchRoots, type FetchRoot, renderFetch, resolveFetch } from "../fetch-resolve.js";
import { indexSource } from "../indexer.js";
import { SqliteFtsStore } from "../sqlite-store.js";

const pad = (s: string) => `${s} — this paragraph is deliberately long enough to stay a chunk of its own after the minimum-size merge pass runs over the file.`;

/** One store, several roots, each root a directory under `base`. */
async function makeStore(base: string, roots: Record<string, Record<string, string>>): Promise<{ store: SqliteFtsStore; fetchRoots: FetchRoot[] }> {
  const fs: Array<{ id: string; dir: string }> = [];
  for (const [id, files] of Object.entries(roots)) {
    const dir = id === "." ? base : join(base, id.replace(/[^A-Za-z0-9_./-]/g, "_"));
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    fs.push({ id, dir });
  }
  const store = new SqliteFtsStore(join(mkdtempSync(join(tmpdir(), "kb-fetch-db-")), "kb.db"));
  store.init();
  // index each root ONLY over its own files (a `.` root must not swallow siblings)
  for (const s of fs) await indexSource(store, { root: s.id, dir: s.dir, include: (rel: string) => rel.replace(/\\/g, "/") in roots[s.id] });
  // remote-looking ids (contain `:`) get no relDir — mimic a git/https root
  const fsOnly = fs.filter((s) => !s.id.includes(":"));
  return { store, fetchRoots: buildFetchRoots(store.listRoots(), fsOnly, base) };
}

const doc = (title: string) => `# ${title}\n${pad(title)}\n`;

describe("resolveFetch — paths across roots", () => {
  let base: string;
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "kb-fetch-"));
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  let n = 0;
  const sub = () => join(base, String(++n));

  it("E1 a hit in a non-first root resolves", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { a: { "x.md": doc("X") }, b: { "guide.md": doc("Guide B") } });
    const r = resolveFetch(store, fetchRoots, "guide.md");
    expect(r.kind).toBe("hit");
    if (r.kind === "hit") {
      expect(r.root).toBe("b");
      expect(r.chunk.body).toContain("Guide B");
    }
  });

  it("E2 every indexed path in a collision-free multi-root KB resolves", async () => {
    const { store, fetchRoots } = await makeStore(sub(), {
      a: { "one.md": doc("One"), "nested/two.md": doc("Two") },
      b: { "three.md": doc("Three") },
      c: { "deep/four.md": doc("Four") },
    });
    const paths = store.listRoots().flatMap((r) => store.listPaths(r));
    expect(paths.length).toBe(4);
    for (const p of paths) expect(resolveFetch(store, fetchRoots, p).kind, p).toBe("hit");
  });

  it("E4 an unknown path is missing and renders the not-found marker", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { a: { "x.md": doc("X") } });
    const r = resolveFetch(store, fetchRoots, "nope.md");
    expect(r.kind).toBe("missing");
    expect(renderFetch(r, "nope.md", undefined, "pass `section`").text).toBe("(not found: nope.md)");
  });

  it("E5 a directory-qualified path resolves within that root", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { ".pi/docs": { "knowledge-base.md": doc("KB") }, other: { "y.md": doc("Y") } });
    const r = resolveFetch(store, fetchRoots, ".pi/docs/knowledge-base.md");
    expect(r.kind).toBe("hit");
    if (r.kind === "hit") expect(r.root).toBe(".pi/docs");
  });

  it("E6 an id-qualified remote path round-trips (id containing `:`)", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { "git:https://github.com/o/r": { "README.md": doc("Remote") }, git: { "x.md": doc("X") } });
    const r = resolveFetch(store, fetchRoots, "git:https://github.com/o/r:README.md");
    expect(r.kind).toBe("hit");
    if (r.kind === "hit") {
      expect(r.root).toBe("git:https://github.com/o/r");
      expect(r.chunk.body).toContain("Remote");
    }
  });

  it("E7 a qualifier selects among colliding roots — no collision list", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { docs: { "README.md": doc("Docs") }, vendor: { "README.md": doc("Vendor") } });
    const r = resolveFetch(store, fetchRoots, "vendor/README.md");
    expect(r.kind).toBe("hit");
    if (r.kind === "hit") expect(r.chunk.body).toContain("Vendor");
  });

  it("E8 literal and qualified readings both resolving is ambiguous", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { ".": { "docs/a.md": doc("Literal") }, docs: { "a.md": doc("Qualified") } });
    const r = resolveFetch(store, fetchRoots, "docs/a.md");
    expect(r).toEqual({ kind: "ambiguous", on: "path", candidates: [".:docs/a.md", "docs:a.md"] });
    const out = renderFetch(r, "docs/a.md", undefined, "pass `section`");
    expect(out.text).not.toContain("Literal");
    expect(out.text).not.toContain("Qualified —");
  });

  it("E9 the same path in two roots lists candidates, found:false, no body; E10 a candidate round-trips", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { "packages/a": { "AGENTS.md": doc("Agents A") }, "packages/b": { "AGENTS.md": doc("Agents B") } });
    const r = resolveFetch(store, fetchRoots, "AGENTS.md");
    expect(r.kind).toBe("ambiguous");
    const out = renderFetch(r, "AGENTS.md", undefined, "pass `section`");
    expect(out.found).toBe(false);
    expect(out.candidates).toBe(2);
    expect(out.text).toContain("packages/a:AGENTS.md");
    expect(out.text).toContain("packages/b:AGENTS.md");
    expect(out.text).not.toContain("Agents A");
    // E10
    const back = resolveFetch(store, fetchRoots, "packages/b:AGENTS.md");
    expect(back.kind).toBe("hit");
    if (back.kind === "hit") expect(back.chunk.body).toContain("Agents B");
  });
});

describe("resolveFetch — section argument", () => {
  let base: string;
  let store: SqliteFtsStore;
  let roots: FetchRoot[];
  beforeAll(async () => {
    base = mkdtempSync(join(tmpdir(), "kb-fetch-sec-"));
    const md = [
      "# Guide", pad("intro"),
      "## Setup", pad("setup"),
      "### Files", pad("setup files"),
      "## Usage", pad("usage"),
      "### Config", pad("usage config"),
    ].join("\n");
    const dup = ["# Doc", pad("doc"), "## A", pad("a"), "### Files", pad("a files"), "## B", pad("b"), "### Files", pad("b files")].join("\n");
    ({ store, fetchRoots: roots } = await makeStore(base, { docs: { "guide.md": md, "dup.md": dup } }));
  });
  afterAll(() => {
    store.close();
    rmSync(base, { recursive: true, force: true });
  });

  it("E11 an exact heading path returns that section", () => {
    const r = resolveFetch(store, roots, "guide.md", "Guide > Setup > Files");
    expect(r.kind).toBe("hit");
    if (r.kind === "hit") expect(r.chunk.headingPath).toBe("Guide > Setup > Files");
  });

  it("E12 a unique last heading returns that section", () => {
    const r = resolveFetch(store, roots, "guide.md", "Config");
    expect(r.kind).toBe("hit");
    if (r.kind === "hit") expect(r.chunk.headingPath).toBe("Guide > Usage > Config");
  });

  it("E13 an ambiguous last heading lists both full heading paths, no body", () => {
    const r = resolveFetch(store, roots, "dup.md", "Files");
    expect(r).toEqual({ kind: "ambiguous", on: "section", candidates: ["Doc > A > Files", "Doc > B > Files"] });
    const out = renderFetch(r, "dup.md", "Files", "pass `section`");
    expect(out.found).toBe(false);
    expect(out.text).not.toContain("a files");
  });

  it("E14 an unknown section in a resolved file is section-missing", () => {
    expect(resolveFetch(store, roots, "guide.md", "Nope").kind).toBe("section-missing");
    expect(resolveFetch(store, roots, "guide.md", "Guide > Nope > Files").kind).toBe("section-missing");
  });

  it("E15 getChunk keeps exact-heading-path semantics (no last-heading fallback) and path-only suppressedSections", () => {
    expect(store.getChunk("docs", "guide.md", "Files")).toBeNull();
    expect(store.getChunk("docs", "guide.md", "Guide > Setup > Files")!.headingPath).toBe("Guide > Setup > Files");
    expect(store.getChunk("docs", "guide.md")!.suppressedSections).toBeGreaterThan(0);
  });
});

// See change: fix-kb-parent-link-and-section-miss (test-plan #E11–#E18).
describe("resolveFetch — section not found", () => {
  let base: string;
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "kb-fetch-miss-"));
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  let n = 0;
  const sub = () => join(base, String(++n));
  const HINT = "pass `section`";
  const guide = ["# Guide", pad("intro"), "## Setup", pad("setup"), "## Config", pad("config")].join("\n");
  const sections = (k: number) => Array.from({ length: k }, (_, i) => `## S${i}\n${pad(`s${i}`)}`).join("\n");
  const bigDoc = ["---", "title: Other Title", "description: d", "---", "# Guide", pad("intro"), "## Big", "p".repeat(2600), "", "q".repeat(2600)].join("\n");
  const e6Doc = `## Big\n\n\n\n${"p".repeat(4500)}\n\n${"q".repeat(600)}\n`;
  const e3Doc = ["# Title", pad("title"), "## P", "### C", pad("cbody")].join("\n");

  it("E11 unknown section lists the file's heading paths, no body", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { docs: { "guide.md": guide } });
    const r = resolveFetch(store, fetchRoots, "guide.md", "Guide > Nope");
    expect(r.kind).toBe("section-missing");
    const out = renderFetch(r, "guide.md", "Guide > Nope", HINT);
    expect(out.text).toBe("(section not found: Guide > Nope in guide.md — sections:)\nGuide\nGuide > Setup\nGuide > Config");
    expect(out.found).toBe(false);
    expect(out.text).not.toContain("(not found: guide.md)");
    expect(out.text).not.toContain("deliberately long");
  });

  it("E12 the section list is capped at 50 in document order", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { docs: { "s50.md": sections(50), "s51.md": sections(51), "s60.md": sections(60) } });
    const lines = (f: string) => renderFetch(resolveFetch(store, fetchRoots, f, "Nope"), f, "Nope", HINT).text.split("\n");
    const first50 = Array.from({ length: 50 }, (_, i) => `S${i}`);
    const l50 = lines("s50.md");
    expect(l50.slice(1)).toEqual(first50);
    const l51 = lines("s51.md");
    expect(l51.slice(1, 51)).toEqual(first50);
    expect(l51[51]).toBe("(+1 more section)");
    expect(l51).toHaveLength(52);
    const l60 = lines("s60.md");
    expect(l60.slice(1, 51)).toEqual(first50);
    expect(l60[51]).toBe("(+10 more sections)");
    expect(l60).toHaveLength(52);
  });

  it("E13 a split section is listed once; the frontmatter meta chunk is excluded", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { docs: { "big.md": bigDoc } });
    const text = renderFetch(resolveFetch(store, fetchRoots, "big.md", "Nope"), "big.md", "Nope", HINT).text;
    expect(text.split("\n").filter((l) => l === "Guide > Big")).toHaveLength(1);
    expect(text).not.toContain("Other Title");
  });

  it("E14 a file without body sections reports no sections", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { docs: { "fm.md": "---\ntitle: Only Meta\ndescription: just frontmatter\n---\n" } });
    const out = renderFetch(resolveFetch(store, fetchRoots, "fm.md", "Nope"), "fm.md", "Nope", HINT);
    expect(out.text).toBe("(section not found: Nope in fm.md — no sections)");
    expect(out.found).toBe(false);
  });

  it("E15 every listed heading path round-trips to a non-empty section", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { docs: { "big.md": bigDoc, "e6.md": e6Doc } });
    for (const f of ["big.md", "e6.md"]) {
      const r = resolveFetch(store, fetchRoots, f, "Nope");
      expect(r.kind).toBe("section-missing");
      if (r.kind !== "section-missing") continue;
      expect(r.sections.length).toBeGreaterThan(0);
      for (const hp of r.sections) {
        const hit = resolveFetch(store, fetchRoots, f, hp);
        expect(hit.kind, `${f} ${hp}`).toBe("hit");
        if (hit.kind === "hit") expect(hit.chunk.body.trim()).not.toBe("");
      }
    }
  });

  it("E16 an unknown path keeps the path not-found marker", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { docs: { "guide.md": guide } });
    const r = resolveFetch(store, fetchRoots, "nope.md", "Anything");
    expect(r.kind).toBe("missing");
    expect(renderFetch(r, "nope.md", "Anything", HINT).text).toBe("(not found: nope.md)");
  });

  it("E17 the marker names the path as passed", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { docs: { "guide.md": guide } });
    const text = renderFetch(resolveFetch(store, fetchRoots, "docs:guide.md", "Nope"), "docs:guide.md", "Nope", HINT).text;
    expect(text.split("\n")[0]).toBe("(section not found: Nope in docs:guide.md — sections:)");
  });

  it("E18 the bare leaf of a chunkless child still resolves", async () => {
    const { store, fetchRoots } = await makeStore(sub(), { docs: { "e3.md": e3Doc } });
    const r = resolveFetch(store, fetchRoots, "e3.md", "C");
    expect(r.kind).toBe("hit");
    if (r.kind === "hit") expect(r.chunk.body).toContain("cbody");
  });
});
