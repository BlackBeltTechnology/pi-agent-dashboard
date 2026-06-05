import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { searchFiles, splitQuery, scoreMatch } from "../command-handler.js";

/** Build a tmp tree from a list of relative file paths (dirs inferred). */
function makeTree(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "searchfiles-"));
  for (const f of files) {
    const full = join(root, f);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, "");
  }
  return root;
}

describe("splitQuery", () => {
  it("returns whole query as leaf when no slash", () => {
    expect(splitQuery("db")).toEqual({ prefix: "", leaf: "db" });
  });
  it("splits at last slash", () => {
    expect(splitQuery("x/db/co")).toEqual({ prefix: "x/db/", leaf: "co" });
  });
  it("trailing slash yields empty leaf", () => {
    expect(splitQuery("x/db/")).toEqual({ prefix: "x/db/", leaf: "" });
  });
});

describe("scoreMatch", () => {
  it("empty leaf scores 0", () => {
    expect(scoreMatch("src/db.ts", "")).toBe(0);
  });
  it("exact basename = 4", () => {
    expect(scoreMatch("src/db", "db")).toBe(4);
  });
  it("basename prefix = 3", () => {
    expect(scoreMatch("src/db.ts", "db")).toBe(3);
  });
  it("basename substring = 2", () => {
    expect(scoreMatch("src/mydb.ts", "db")).toBe(2);
  });
  it("path substring fallback = 1", () => {
    expect(scoreMatch("src/db/util.ts", "db")).toBe(1);
  });
  it("absent from basename and path = 0", () => {
    expect(scoreMatch("src/util.ts", "zzz")).toBe(0);
  });
  it("trailing-slash dir basename matches", () => {
    expect(scoreMatch("x/db/", "db")).toBe(4);
  });
});

describe("searchFiles ranking", () => {
  let root: string;
  const cleanup: string[] = [];
  afterAll(() => { for (const r of cleanup) rmSync(r, { recursive: true, force: true }); });

  function search(files: string[], query: string) {
    root = makeTree(files);
    cleanup.push(root);
    return searchFiles(root, query).map((f) => f.path);
  }

  it("exact basename outranks path substring", () => {
    const r = search(["db.ts", "src/dbg/util.ts"], "db");
    expect(r.indexOf("db.ts")).toBeLessThan(r.indexOf("src/dbg/util.ts"));
  });

  it("prefix outranks mid-string substring", () => {
    const r = search(["server.ts", "myserver.ts"], "server");
    expect(r.indexOf("server.ts")).toBeLessThan(r.indexOf("myserver.ts"));
  });

  it("shallower path wins on equal score", () => {
    const r = search(["config.ts", "a/b/config.ts"], "config");
    expect(r.indexOf("config.ts")).toBeLessThan(r.indexOf("a/b/config.ts"));
  });

  it("bare @ returns top-level entries first, alphabetically", () => {
    const r = search(["zeta.ts", "alpha.ts", "a/deep/nested/file.ts"], "");
    // top-level (depth 0) entries come first, alphabetical order
    expect(r.slice(0, 3)).toEqual(["a/", "alpha.ts", "zeta.ts"]);
    // a/ directory (depth 0) before its deeper contents
    expect(r.indexOf("a/")).toBeLessThan(r.indexOf("a/deep/"));
    expect(r.indexOf("zeta.ts")).toBeLessThan(r.indexOf("a/deep/nested/file.ts"));
  });

  it("slash-aware split scopes and ranks leaf as basename", () => {
    const r = search(["x/db/conn.ts", "x/db/proto.co", "other/co.ts"], "x/db/co");
    expect(r).not.toContain("other/co.ts");
    expect(r.indexOf("x/db/conn.ts")).toBeLessThan(r.indexOf("x/db/proto.co"));
  });

  it("bare directory query surfaces the directory and its contents", () => {
    const r = search(["x/db/conn.ts", "x/db/schema.sql"], "x/db");
    expect(r).toContain("x/db/");
    expect(r).toContain("x/db/conn.ts");
    expect(r).toContain("x/db/schema.sql");
  });

  it("trailing-slash query lists directory contents by depth then alpha", () => {
    const r = search(["x/db/conn.ts", "x/db/schema.sql", "x/db/sub/deep.ts"], "x/db/");
    expect(r).toContain("x/db/conn.ts");
    // shallower contents before deeper
    expect(r.indexOf("x/db/conn.ts")).toBeLessThan(r.indexOf("x/db/sub/deep.ts"));
    // alpha among same depth
    expect(r.indexOf("x/db/conn.ts")).toBeLessThan(r.indexOf("x/db/schema.sql"));
  });

  it("deep first-subtree does not starve a shallow sibling match", () => {
    const files: string[] = [];
    for (let i = 0; i < 30; i++) files.push(`a/deep/match${i}.ts`);
    files.push("match-root.ts");
    const r = search(files, "match");
    expect(r).toContain("match-root.ts");
    // root match (depth 0) ranks ahead of deep matches
    expect(r.indexOf("match-root.ts")).toBeLessThan(r.indexOf("a/deep/match0.ts"));
  });

  it("BFS visits shallow before deep even when the visit budget is exhausted", () => {
    // >4000 entries under one early-sorted deep subtree (DFS would drain the
    // MAX_VISITS=4000 budget here and never reach the root match).
    const files: string[] = [];
    // Deep matches: basename starts with "match" -> tier 3, depth 2.
    for (let i = 0; i < 4100; i++) files.push(`aaa_deep/sub/match${i}.ts`);
    // Shallow match: same tier 3 (basename starts with "match"), depth 0.
    files.push("match-root.ts");
    const r = search(files, "match");
    // DFS would drain the 4000-visit budget inside aaa_deep/ and never
    // COLLECT the depth-0 root match. BFS collects it at depth 0; the depth
    // tie-break then ranks it first among equal-score matches.
    expect(r).toContain("match-root.ts");
    expect(r[0]).toBe("match-root.ts");
  });

  it("cap applied AFTER ranking — 50 highest-ranked, length === 50", () => {
    const files: string[] = [];
    // 60 path-substring (tier 1) matches deep
    for (let i = 0; i < 60; i++) files.push(`deep/match/file${i}.ts`);
    // 3 exact-ish basename (tier 3) matches at root
    files.push("match.ts");
    const r = search(files, "match");
    expect(r.length).toBe(50);
    // the strong basename match survives the cap
    expect(r).toContain("match.ts");
  });

  it("unreadable directory is skipped, not fatal", () => {
    // Non-existent cwd: readdirSync throws -> caught -> empty result, no throw.
    expect(searchFiles(join(tmpdir(), "searchfiles-does-not-exist-xyz"), "")).toEqual([]);
  });

  it("IGNORE_DIRS and depth > 6 pruned", () => {
    const r = search([
      "node_modules/pkg/index.ts",
      "a/b/c/d/e/f/g/toodeep.ts",
      "keep.ts",
    ], "");
    expect(r.some((p) => p.startsWith("node_modules"))).toBe(false);
    expect(r).not.toContain("a/b/c/d/e/f/g/toodeep.ts");
    expect(r).toContain("keep.ts");
  });
});
