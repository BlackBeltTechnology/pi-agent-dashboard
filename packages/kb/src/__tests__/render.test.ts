// Tests for the shared hit renderer + parent-collapse at the source.
// Folded from openspec/changes/slim-kb-search-output/test-plan.md (E5–E9, E12, E14).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexSource } from "../indexer.js";
import { renderHits } from "../render.js";
import { SqliteFtsStore } from "../sqlite-store.js";
import type { KbHit } from "../types.js";

/** Minimal valid hit; override per scenario. */
function hit(over: Partial<KbHit> = {}): KbHit {
  return {
    root: "r",
    path: "a/b.md",
    headingPath: "A > B",
    chunkId: "sha8:1",
    docType: "doc",
    score: -18.9,
    snippet: "some snippet body",
    ...over,
  };
}

const TOOL = { leading: "rank", parentGlyph: "\u2937 ", multiline: true } as const;

describe("renderHits", () => {
  it("E5: surfaces akaPaths as a (+N dup) marker", () => {
    const out = renderHits([hit({ akaPaths: ["a", "b"] })], TOOL);
    expect(out).toContain("(+2 dup)");
  });

  it("E6: no dup marker when akaPaths is absent", () => {
    const out = renderHits([hit()], TOOL);
    expect(out).not.toContain("(+");
  });

  it("E7: parent continuation renders with the glyph", () => {
    const out = renderHits([hit({ parent: { headingPath: "P" } })], TOOL);
    expect(out).toContain("\u2937 P");
  });

  it("E8: no parent line when parent is null", () => {
    const out = renderHits([hit({ parent: null })], TOOL);
    expect(out).not.toContain("\u2937");
  });

  it("E9: rank is a 1-based ordinal over the given list (N=1 and N=3)", () => {
    const one = renderHits([hit()], TOOL);
    expect(one.split("\n")[0].startsWith("1  ")).toBe(true);

    const three = renderHits([hit(), hit(), hit()], TOOL);
    const leads = three.split("\n").filter((l) => /^\d+  /.test(l)).map((l) => l.split("  ")[0]);
    expect(leads).toEqual(["1", "2", "3"]);
  });

  it("CLI form (leading:score, single-line) stays byte-identical to the legacy render", () => {
    const h = hit({ akaPaths: ["x"], parent: { headingPath: "Parent H" } });
    const out = renderHits([h], { leading: "score", parentGlyph: "[parent: ", multiline: false });
    const legacy = `${h.score.toFixed(2)}  ${h.path}  ::  ${h.headingPath}  (+${h.akaPaths!.length} dup)  [parent: ${h.parent!.headingPath}]\n      ${h.snippet.replace(/\s+/g, " ").slice(0, 160)}`;
    expect(out).toBe(legacy);
  });
});

describe("parent collapse at the source (E12)", () => {
  let dir: string;
  let store: SqliteFtsStore;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "kb-render-"));
    writeFileSync(
      join(dir, "auth.md"),
      "# Auth Guide\nThis guide explains authentication including the interceptor and principal resolution flow in enough detail to exceed the merge threshold cleanly.\n" +
        "## Token Rotation\nRotate the refresh token periodically to limit exposure; this subsection body is intentionally verbose so it survives merge and stays its own chunk.",
    );
    store = new SqliteFtsStore(join(dir, ".kb.db"));
    store.init();
    await indexSource(store, { root: "r", dir });
  });
  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("attaches a parent carrying headingPath ONLY", () => {
    const hits = store.search("token rotation refresh", { limit: 5, expandParent: true });
    const rot = hits.find((h) => h.headingPath.includes("Token Rotation"));
    expect(rot?.parent).toBeTruthy();
    expect(Object.keys(rot!.parent!)).toEqual(["headingPath"]);
    expect(rot!.parent!.headingPath).toContain("Auth");
  });
});

describe("KbHit.parent is non-recursive (E14)", () => {
  it("hit.parent.parent is a compile error under tsc --noEmit", () => {
    const h = hit({ parent: { headingPath: "P" } });
    // @ts-expect-error parent is { headingPath } only — non-recursive by design.
    const _grandparent = h.parent?.parent;
    expect(_grandparent).toBeUndefined();
  });
});
