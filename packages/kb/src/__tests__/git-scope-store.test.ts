// Store additions the git scope relies on (change: add-kb-git-forge-scope, design G1).
import { describe, expect, it } from "vitest";
import { SqliteFtsStore } from "../sqlite-store.js";
import type { Chunk } from "../types.js";

const chunk = (path: string, body: string): Chunk => ({ root: "git", path, chunkId: `${path}#0`, headingPath: `${path} > ${body}`, heading: body, level: 0, parentChunkId: null, docType: "doc", body, bodyHash: `h-${path}-${body}` });
const fresh = () => {
  const s = new SqliteFtsStore(":memory:");
  s.init();
  return s;
};

describe("store additions", () => {
  it("replaceItem keeps inbound edges (delete-then-insert would lose them)", () => {
    const s = fresh();
    s.replaceItem("git", "commit/aaa", [chunk("commit/aaa", "fix parser")], [{ src: "commit/aaa", dst: "pr/1", rel: "references" }]);
    s.replaceItem("git", "pr/1", [chunk("pr/1", "first title")], []);
    s.replaceItem("git", "pr/1", [chunk("pr/1", "edited title")], []);
    expect(s.backlinks("pr/1").map((n) => n.name)).toEqual(["commit/aaa"]);
    expect(s.search("edited", { root: "git" })).toHaveLength(1);
    expect(s.search("first", { root: "git" })).toHaveLength(0);
  });

  it("replaceItem replaces OUTBOUND edges", () => {
    const s = fresh();
    s.replaceItem("git", "commit/aaa", [chunk("commit/aaa", "x")], [{ src: "commit/aaa", dst: "pr/1", rel: "references" }]);
    s.replaceItem("git", "commit/aaa", [chunk("commit/aaa", "x")], [{ src: "commit/aaa", dst: "pr/2", rel: "references" }]);
    expect(s.neighbors("commit/aaa", 1).map((n) => n.name)).toEqual(["pr/2"]);
  });

  it("ensureNode makes an edge to a not-yet-indexed target survive", () => {
    const s = fresh();
    s.addNode({ type: "file", name: "commit/aaa", path: "commit/aaa" });
    s.ensureNode("pr/9");
    s.addEdge({ src: "commit/aaa", dst: "pr/9", rel: "references" });
    expect(s.neighbors("commit/aaa", 1).map((n) => n.name)).toEqual(["pr/9"]);
  });

  it("pathPrefix is pushed into SQL: the page fills although 300 commits outrank the PRs", () => {
    const s = fresh();
    for (let i = 0; i < 300; i++) s.replaceItem("git", `commit/${i}`, [chunk(`commit/${i}`, "token token token token")], []);
    for (let i = 0; i < 12; i++) s.replaceItem("git", `pr/${i}`, [chunk(`pr/${i}`, "token")], []);
    const hits = s.search("token", { root: "git", limit: 10, dedup: false, sourceDedup: false, laneQuota: 0, pathPrefix: ["pr/"] });
    expect(hits).toHaveLength(10);
    expect(hits.every((h) => h.path.startsWith("pr/"))).toBe(true);
  });

  it("pathPrefix escapes LIKE wildcards", () => {
    const s = fresh();
    s.replaceItem("git", "pr/1", [chunk("pr/1", "token")], []);
    expect(s.search("token", { root: "git", pathPrefix: ["%"] })).toHaveLength(0);
  });

  it("dedup:false keeps identical bodies apart", () => {
    const s = fresh();
    s.replaceItem("git", "commit/a", [{ ...chunk("commit/a", "same"), bodyHash: "dup" }], []);
    s.replaceItem("git", "pr/1", [{ ...chunk("pr/1", "same"), bodyHash: "dup" }], []);
    expect(s.search("same", { root: "git", dedup: false, sourceDedup: false })).toHaveLength(2);
  });

  it("findPathsByPrefix lists indexed items only (placeholders excluded)", () => {
    const s = fresh();
    s.replaceItem("git", "commit/abcdef1111", [chunk("commit/abcdef1111", "a")], []);
    s.replaceItem("git", "commit/abcdef2222", [chunk("commit/abcdef2222", "b")], []);
    s.ensureNode("commit/abcdef3333");
    expect(s.findPathsByPrefix("git", "commit/abcdef", 10)).toEqual(["commit/abcdef1111", "commit/abcdef2222"]);
    expect(s.findPathsByPrefix("git", "commit/zzz", 10)).toEqual([]);
  });

  it("immediate rolls back on throw", () => {
    const s = fresh();
    expect(() => s.immediate(() => (s.replaceItem("git", "pr/1", [chunk("pr/1", "x")], []), (() => { throw new Error("boom"); })()))).toThrow("boom");
    expect(s.search("x", { root: "git" })).toHaveLength(0);
  });
});
