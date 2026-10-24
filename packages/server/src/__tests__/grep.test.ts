import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { grepWithJsScan, parseRipgrepJson, runGrep } from "../lib/grep.js";
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

/** 10 ms main-thread probe: the largest gap between ticks while a scan runs. */
function startTickProbe() {
  let last = performance.now();
  let max = 0;
  const id = setInterval(() => {
    const now = performance.now();
    max = Math.max(max, now - last);
    last = now;
  }, 10);
  return {
    stop(): number {
      clearInterval(id);
      return max;
    },
  };
}

// 40 `a` then `!` makes `(a+)+$` backtrack exponentially (V8 irregexp).
const PATHOLOGICAL_LINE = `${"a".repeat(40)}!\n`;
const PATHOLOGICAL_QUERY = "(a+)+$";

describe("runGrep JS fallback — regex semantics unchanged by the worker move (#E9 #E10)", () => {
  it("#E9: a regex query matches by pattern, not by literal text", async () => {
    const root = makeTree({ "a.txt": "foo123\nfooBar\n" });
    const out = await runGrep(root, "foo\\d+", { regex: true, rgPath: null });
    expect(out.map((m) => [m.line, m.snippet])).toEqual([[1, "foo123"]]);
  });

  it("#E10: an invalid pattern degrades to a literal substring search", async () => {
    const root = makeTree({ "a.txt": "x a(b y\nnothing\n" });
    const out = await runGrep(root, "a(b", { regex: true, rgPath: null });
    expect(out.map((m) => [m.line, m.snippet])).toEqual([[1, "x a(b y"]]);
  });
});

describe("runGrep JS fallback — scan runs off the main thread, bounded by a timeout", () => {
  it("#P1: a catastrophic regex times out without stalling the main thread", async () => {
    const root = makeTree({ "a.txt": PATHOLOGICAL_LINE });
    const probe = startTickProbe();
    const t0 = Date.now();
    await expect(
      runGrep(root, PATHOLOGICAL_QUERY, { regex: true, rgPath: null, scanTimeoutMs: 500 }),
    ).rejects.toMatchObject({ name: "GrepTimeoutError" });
    const elapsed = Date.now() - t0;
    const gap = probe.stop();
    expect(elapsed).toBeLessThan(1500);
    expect(gap).toBeLessThan(200);
  });

  it.skipIf(process.platform === "win32")(
    "#X2: patterns rg rejects (exit 2) fall to the same bounded scan",
    async () => {
      const root = makeTree({ "a.txt": PATHOLOGICAL_LINE });
      const fakeRg = join(root, "fake-rg.sh");
      writeFileSync(fakeRg, "#!/bin/sh\nexit 2\n");
      chmodSync(fakeRg, 0o755);
      const probe = startTickProbe();
      const t0 = Date.now();
      await expect(
        runGrep(root, PATHOLOGICAL_QUERY, { regex: true, rgPath: fakeRg, scanTimeoutMs: 300 }),
      ).rejects.toMatchObject({ name: "GrepTimeoutError" });
      const elapsed = Date.now() - t0;
      const gap = probe.stop();
      expect(elapsed).toBeLessThan(1300);
      expect(gap).toBeLessThan(200);
    },
  );

  it("#X3: a worker entry that throws on start rejects (no hang, no unhandled rejection)", async () => {
    const root = makeTree({ "a.txt": "needle\n", "boom.mjs": 'throw new Error("boom on start");\n' });
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const t0 = Date.now();
      await expect(
        runGrep(root, "needle", {
          rgPath: null,
          scanWorkerUrl: pathToFileURL(join(root, "boom.mjs")).href,
        }),
      ).rejects.toThrow(/boom on start/);
      expect(Date.now() - t0).toBeLessThan(5000);
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
