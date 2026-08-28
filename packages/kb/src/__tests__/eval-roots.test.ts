// Tests for two-tier expect normalization + filesystem-anchored reachability
// (eval.ts evaluate with `roots`). Folded from
// openspec/changes/fix-kb-eval-measurement-integrity/test-plan.md
// (E7 spec scenario, E8 separator boundary, E9 longest prefix, E10 decision
// table + metric exclusions, E11 no-shrink invariant on the real fixture).
// Exemplar: packages/kb/src/__tests__/kb.test.ts (mock store pattern).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluate, type GoldenItem, type RootRef } from "../eval.js";
import type { KbHit, KbStore, SearchOpts } from "../types.js";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** Deterministic mock store: every search returns `pool` (in order, sliced to
 *  limit) as hits, so rank positions are hand-placed. Counts search calls. */
function mockStore(pool: string[]): KbStore & { calls: () => number } {
  let calls = 0;
  const hit = (path: string): KbHit => ({ root: "r", path, headingPath: "h", chunkId: path, docType: "doc", score: 1, snippet: "", parent: null });
  return {
    init() {}, begin() {}, commit() {}, rollback() {}, close() {},
    getFileState: () => null, setFileState() {}, listPaths: () => [], deleteByPath() {},
    insertChunk() {}, addNode() {}, addEdge() {},
    neighbors: () => [], backlinks: () => [], getChunk: () => null, getChunkById: () => null,
    counts: () => ({ files: 0, chunks: 0, nodes: 0, edges: 0 }),
    search: (_q: string, o?: SearchOpts) => {
      calls++;
      return pool.slice(0, o?.limit ?? 10).map(hit);
    },
    calls: () => calls,
  } as unknown as KbStore & { calls: () => number };
}

const root = (relPrefix: string, dir?: string): RootRef => ({ id: relPrefix || "cwd", relPrefix, dir });

describe("evaluate roots (E7 spec scenario)", () => {
  it("repo-relative expect + configured root → stripped candidate matches at rank 1", () => {
    const store = mockStore(["foo/AGENTS.md"]);
    const m = evaluate(store, [{ q: "agents", expect: "packages/foo/AGENTS.md" }], { k: 10, roots: [root("packages")] });
    expect(m["P@1"]).toBe(1);
    expect(m.unreachable).toBe(0);
  });
});

describe("evaluate roots (E8 separator boundary)", () => {
  it("`packages` never strips against `packages-x/…` — raw candidate scores, item reachable", () => {
    // The root's dir carries a top-level `packages-x` entry → rule (b) keeps the
    // item reachable (manifest: "item scored, not unreachable"). Rank geometry
    // exposes a broken strip: a wrong `x/foo.md` candidate would match at rank 1
    // (MRR 1.0); the correct no-strip behavior matches the raw at rank 2 (MRR 0.5).
    const dir = mkdtempSync(join(tmpdir(), "kb-e8-"));
    mkdirSync(join(dir, "packages-x"), { recursive: true });
    try {
      const store = mockStore(["x/foo.md", "packages-x/foo.md"]);
      const m = evaluate(store, [{ q: "foo", expect: "packages-x/foo.md" }], { k: 10, roots: [{ id: "packages", relPrefix: "packages", dir }] });
      expect(m.n).toBe(1);
      expect(m.unreachable).toBe(0);
      expect(m["P@1"]).toBe(0);
      expect(m.MRR).toBe(0.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("evaluate roots (E9 longest prefix)", () => {
  it("nested roots strip against the DEEPER root → candidate src/a.md, not client/src/a.md", () => {
    // "client/deep/a.md" (rank 1) must NOT contain the right candidate; a wrong
    // shorter-prefix strip ("packages" → "client/src/a.md") matches nothing.
    const store = mockStore(["client/deep/a.md", "src/a.md"]);
    const m = evaluate(
      store,
      [{ q: "a", expect: "packages/client/src/a.md" }],
      { k: 10, roots: [root("packages"), root("packages/client")] },
    );
    expect(m["P@1"]).toBe(0);
    expect(m["P@5"]).toBe(1);
    expect(m.MRR).toBe(0.5);
    expect(m.unreachable).toBe(0);
  });
});

describe("evaluate roots (E10 decision table + metric exclusions)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kb-roots-"));
    mkdirSync(join(dir, "openspec-root", "changes"), { recursive: true });
    mkdirSync(join(dir, "cwd-root"), { recursive: true });
    writeFileSync(join(dir, "openspec-root", "changes", "placeholder.md"), "# p\n");
    writeFileSync(join(dir, "cwd-root", "README.md"), "# r\n");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("bare → scored; root-top-level → scored; foreign first segments → unreachable; excluded from all metrics; no search call for them", () => {
    const roots: RootRef[] = [
      root("docs", join(dir, "docs-root")),
      root("openspec", join(dir, "openspec-root")),
      root("", join(dir, "cwd-root")), // empty relPrefix → only rule (b) can classify
    ];
    const golden: GoldenItem[] = [
      { q: "faq", expect: "faq.md" }, // bare basename → reachable attempt
      { q: "changes", expect: "changes/specs/x.md" }, // top-level entry of the openspec root → reachable
      { q: "tests", expect: "tests/foo.md" }, // no root prefix, not a top-level entry → unreachable
      { q: "documents", expect: "Documents/Projektek/a.md" }, // unreachable
    ];
    const store = mockStore(["docs/faq.md", "changes/specs/x.md"]);
    const m = evaluate(store, golden, { k: 10, roots });
    expect(m.n + m.unreachable).toBe(4);
    expect(m.n).toBe(2);
    expect(m.unreachable).toBe(2);
    expect(m["P@1"]).toBe(0.5);
    expect(m.MRR).toBe(0.75); // (1 + 0.5) / 2
    // Unreachable items never reach the store: 2 scored items → 2 search calls.
    expect(store.calls()).toBe(2);
    // Verbose carries the path list; JSON output carries the count.
    const mv = evaluate(store, golden, { k: 10, roots, verbose: true });
    expect(mv.unreachablePaths).toEqual(["tests/foo.md", "Documents/Projektek/a.md"]);
  });
});

describe("evaluate roots (E11 no-shrink invariant on the real fixture)", () => {
  it("new matcher vs old path.includes(expect) over reachable items → identical ranks", () => {
    const raw = JSON.parse(readFileSync(fileURLToPath(new URL("../../eval/golden.markdown-intent.json", import.meta.url)), "utf8")) as { items: GoldenItem[] };
    const golden: GoldenItem[] = raw.items;
    const roots: RootRef[] = ["docs", "openspec", "packages", ".pi"].map((p) => root(p, join(REPO, p)));

    // Deterministic per-query pool: the fixture's own target paths (+ root-
    // relative transforms), shuffled by a hash of (query, path) so rank
    // positions vary across items but are reproducible.
    const poolSet = new Set<string>();
    for (const g of golden) {
      poolSet.add(g.expect);
      for (const p of ["docs", "openspec", "packages", ".pi", "specs", "server"]) {
        if (g.expect.startsWith(p + "/")) poolSet.add(g.expect.slice(p.length + 1));
        poolSet.add(`${p}/${g.expect.split("/").pop()}`);
      }
      poolSet.add(g.expect.split("/").pop()!);
    }
    for (let i = 0; i < 40; i++) poolSet.add(`packages/client/src/generated${i}.md`);
    const pool = [...poolSet];
    const hash = (s: string) => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    };
    const ordered = (q: string) => pool.map((p) => ({ p, h: hash(q + "\u001f" + p) })).sort((a, b) => a.h - b.h || a.p.localeCompare(b.p)).map((x) => x.p);
    const hit = (path: string): KbHit => ({ root: "r", path, headingPath: "h", chunkId: path, docType: "doc", score: 1, snippet: "", parent: null });

    // Old matcher, replayed over the SAME per-query lists evaluate() will see.
    // Reachability is classified by the SAME rule evaluate() applies (design D4):
    // rule (a) first segments of the root prefixes; rule (b) top-level entries of
    // the four real root dirs. The m.n === oldN assertion cross-checks the copy.
    const firstSegs = new Set(["docs", "openspec", "packages", ".pi"]);
    const topSegs = new Set(["docs", "openspec", "packages", ".pi"].flatMap((p) => (existsSync(join(REPO, p)) ? readdirSync(join(REPO, p)) : [])));
    const unreachable = (expect: string) => expect.includes("/") && !firstSegs.has(expect.split("/")[0]) && !topSegs.has(expect.split("/")[0]);
    let oldP1 = 0, oldP5 = 0, oldRecall = 0, oldMrr = 0, oldNdcg = 0, oldN = 0;
    for (const g of golden) {
      if (unreachable(g.expect)) continue; // unreachable: not searched
      const res = ordered(g.q).slice(0, 10).map(hit);
      oldN++;
      let first = 0;
      res.forEach((r, i) => {
        if (!first && r.path.includes(g.expect)) first = i + 1;
      });
      if (first === 1) oldP1++;
      if (first >= 1 && first <= 5) oldP5++;
      if (first >= 1) {
        oldRecall++;
        oldMrr += 1 / first;
        oldNdcg += 1 / Math.log2(first + 1);
      }
    }
    const round = (x: number, d: number) => +x.toFixed(d);

    const store = mockStore([]);
    (store as unknown as { search: (q: string, o?: SearchOpts) => KbHit[] }).search = (q: string, o?: SearchOpts) => ordered(q).slice(0, o?.limit ?? 10).map(hit);
    const m = evaluate(store, golden, { k: 10, roots });
    expect(m.n + m.unreachable).toBe(108); // census: 104 reachable + 4 unreachable
    expect(m.n).toBe(oldN);
    expect(m["P@1"]).toBe(round(oldP1 / oldN, 3));
    expect(m["P@5"]).toBe(round(oldP5 / oldN, 3));
    expect(m["Recall@K"]).toBe(round(oldRecall / oldN, 3));
    expect(m.MRR).toBe(round(oldMrr / oldN, 3));
    expect(m["nDCG@K"]).toBe(round(oldNdcg / oldN, 3));
  });
});
