import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { grepWithJsScan, parseRipgrepJson } from "../lib/grep.js";
import { detectRipgrep, resetRipgrepCache } from "../ripgrep-detection.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const r of cleanup) rmSync(r, { recursive: true, force: true });
});

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "grep-"));
  cleanup.push(root);
  for (const [f, content] of Object.entries(files)) {
    const full = join(root, f);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe("detectRipgrep (4.1)", () => {
  beforeEach(() => resetRipgrepCache());

  it("returns the resolved path when present", () => {
    expect(detectRipgrep(() => "/usr/bin/rg")).toBe("/usr/bin/rg");
  });
  it("returns null when absent", () => {
    expect(detectRipgrep(() => null)).toBeNull();
  });
  it("caches the first result", () => {
    expect(detectRipgrep(() => "/first/rg")).toBe("/first/rg");
    expect(detectRipgrep(() => "/second/rg")).toBe("/first/rg");
  });
});

describe("parseRipgrepJson (rg path)", () => {
  it("extracts path/line/col/snippet from --json match records", () => {
    const cwd = "/proj";
    const ndjson = [
      JSON.stringify({ type: "begin", data: { path: { text: "/proj/src/a.ts" } } }),
      JSON.stringify({
        type: "match",
        data: {
          path: { text: "/proj/src/a.ts" },
          line_number: 12,
          submatches: [{ start: 4 }],
          lines: { text: "    MAX_VISITS = 20000\n" },
        },
      }),
      JSON.stringify({ type: "end" }),
      "not json",
    ].join("\n");
    const out = parseRipgrepJson(ndjson, cwd);
    expect(out).toEqual([{ path: "src/a.ts", line: 12, col: 5, snippet: "MAX_VISITS = 20000" }]);
  });
});

describe("grepWithJsScan (JS fallback path — 4.2)", () => {
  it("finds literal matches with 1-based line/col and a trimmed snippet", () => {
    const root = makeTree({ "src/a.ts": "const x = 1\nconst MAX = 2\n", "src/b.ts": "nope\n" });
    const out = grepWithJsScan(root, "MAX");
    expect(out).toEqual([{ path: "src/a.ts", line: 2, col: 7, snippet: "const MAX = 2" }]);
  });

  it("supports regexp mode and degrades to substring on an invalid pattern", () => {
    const root = makeTree({ "a.ts": "fooBarTest here\n" });
    expect(grepWithJsScan(root, "foo.*Test", { regex: true }).map((m) => m.path)).toEqual(["a.ts"]);
    // Invalid regex → literal substring "foo(" (absent) → no throw, no match.
    expect(() => grepWithJsScan(root, "foo(", { regex: true })).not.toThrow();
  });

  it("respects the max-matches cap", () => {
    const root = makeTree({ "a.ts": "hit\nhit\nhit\nhit\n" });
    expect(grepWithJsScan(root, "hit", { maxMatches: 2 })).toHaveLength(2);
  });

  it("skips .gitignore-ignored trees", () => {
    const root = makeTree({
      ".gitignore": "coverage/\n",
      "coverage/x.ts": "needle\n",
      "src/y.ts": "needle\n",
    });
    const paths = grepWithJsScan(root, "needle").map((m) => m.path);
    expect(paths).toContain("src/y.ts");
    expect(paths).not.toContain("coverage/x.ts");
  });

  it("returns empty for an empty query", () => {
    const root = makeTree({ "a.ts": "x\n" });
    expect(grepWithJsScan(root, "")).toEqual([]);
  });
});
