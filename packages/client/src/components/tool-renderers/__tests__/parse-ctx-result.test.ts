import { describe, it, expect } from "vitest";
import { parseCtxResult, stripNoise } from "../parse-ctx-result.js";
import { ctxFixtures as fx } from "../parse-ctx-result.fixtures.js";

describe("stripNoise", () => {
  it("drops a leading context-mode upgrade banner + its blank line", () => {
    const out = stripNoise(fx.index_with_banner);
    expect(out).not.toMatch(/context-mode v/);
    expect(out.startsWith("Indexed 830 sections")).toBe(true);
  });

  it("leaves banner-free text untouched", () => {
    expect(stripNoise(fx.index)).toBe(fx.index);
  });
});

describe("parseCtxResult — fixtures parse to expected structs", () => {
  it("ctx_execute plain stdout → execute kind, no intent", () => {
    const r = parseCtxResult("ctx_execute", fx.execute_stdout, false);
    expect(r.kind).toBe("execute");
    if (r.kind === "execute") {
      expect(r.intent).toBeUndefined();
      expect(r.stdout).toContain("DefaultActorResolver");
    }
  });

  it("ctx_execute with intent → execute kind with IntentPreview", () => {
    const r = parseCtxResult("ctx_execute", fx.execute_intent, false);
    expect(r.kind).toBe("execute");
    if (r.kind === "execute") {
      expect(r.intent).toBeDefined();
      expect(r.intent!.matched).toBe(2);
      expect(r.intent!.query).toBe("lint errors specific files and rules");
      expect(r.intent!.indexed).toBe(2);
      expect(r.intent!.previews.length).toBeGreaterThan(0);
    }
  });

  it("ctx_execute_file → execute kind", () => {
    const r = parseCtxResult("ctx_execute_file", fx.execute_file_stdout, false);
    expect(r.kind).toBe("execute");
  });

  it("ctx_batch_execute → batch summary + sections + queries", () => {
    const r = parseCtxResult("ctx_batch_execute", fx.batch, false);
    expect(r.kind).toBe("batch");
    if (r.kind === "batch") {
      expect(r.summary.commands).toBe(6);
      expect(r.summary.sections).toBe(31);
      expect(r.summary.queries).toBe(5);
      expect(r.sections.length).toBeGreaterThan(0);
      expect(r.sections[0].label).toBe("Proposal");
      expect(r.queries.length).toBeGreaterThan(0);
      expect(r.queries[0].sections.length).toBeGreaterThan(0);
    }
  });

  it("ctx_search → per-query blocks with snippets", () => {
    const r = parseCtxResult("ctx_search", fx.search, false);
    expect(r.kind).toBe("search");
    if (r.kind === "search") {
      expect(r.queries.length).toBeGreaterThan(0);
      expect(r.queries[0].sections.length).toBeGreaterThan(0);
      expect(r.queries[0].noResults).toBe(false);
    }
  });

  it("ctx_search 'No results found' → noResults flag per query", () => {
    const r = parseCtxResult("ctx_search", fx.search_no_results, false);
    expect(r.kind).toBe("search");
    if (r.kind === "search") {
      expect(r.queries.length).toBe(2);
      expect(r.queries.every((q) => q.noResults)).toBe(true);
      expect(r.queries.every((q) => q.sections.length === 0)).toBe(true);
    }
  });

  it("ctx_index → index struct", () => {
    const r = parseCtxResult("ctx_index", fx.index, false);
    expect(r).toMatchObject({ kind: "index", sections: 830, withCode: 169 });
    if (r.kind === "index") expect(r.source).toContain("docs/");
  });

  it("ctx_fetch_and_index → fetch struct with source + url", () => {
    const r = parseCtxResult("ctx_fetch_and_index", fx.fetch, false);
    expect(r.kind).toBe("fetch");
    if (r.kind === "fetch") {
      expect(r.sections).toBe(145);
      expect(r.size).toBe("13.2KB");
      expect(r.source).toBe("openspec-workflows");
      expect(r.url).toContain("raw.githubusercontent.com");
    }
  });

  it("ctx_insight → insight struct with dashboard url", () => {
    const r = parseCtxResult("ctx_insight", fx.insight, false);
    expect(r.kind).toBe("insight");
    if (r.kind === "insight") expect(r.url).toBe("http://localhost:4747");
  });
});

describe("parseCtxResult — error classification", () => {
  it("validation error captures message + receivedArgs", () => {
    const r = parseCtxResult("ctx_execute", fx.err_validation, true);
    expect(r).toMatchObject({ kind: "error", variant: "validation" });
    if (r.kind === "error") {
      expect(r.message).toContain("must have required properties code");
      expect(r.receivedArgs).toBeDefined();
      expect(r.receivedArgs).toContain("language");
    }
  });

  it("timeout error", () => {
    const r = parseCtxResult("ctx_execute", fx.err_timeout, true);
    expect(r).toMatchObject({ kind: "error", variant: "timeout" });
  });

  it("runtime error (exit-code/stderr dump) → runtime variant", () => {
    const r = parseCtxResult("ctx_execute", fx.err_runtime, true);
    expect(r).toMatchObject({ kind: "error", variant: "runtime" });
    if (r.kind === "error") expect(r.message).toContain("Exit code: 1");
  });

  // ── repair-tool-error-surfaces: the runtime error's execution shape ──────────
  it("runtime error with the execution shape is structured into fields", () => {
    const r = parseCtxResult("ctx_execute", fx.err_runtime_fenced, true);
    expect(r).toMatchObject({ kind: "error", variant: "runtime" });
    if (r.kind !== "error") return;
    expect(r.language).toBe("shell");
    expect(r.command).toContain("npm run test:e2e");
    expect(r.command).not.toContain("```");
    expect(r.command).not.toContain("Exit code");
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  it("runtime error captures streams even without a fenced command", () => {
    const r = parseCtxResult("ctx_execute", fx.err_runtime, true);
    if (r.kind !== "error") throw new Error("expected error kind");
    expect(r.command).toBeUndefined();
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("TypeError: 'NoneType' object is not subscriptable");
  });

  it("plain-sentence runtime error leaves the fields undefined and keeps message", () => {
    const r = parseCtxResult("ctx_execute", fx.err_runtime_plain, true);
    expect(r).toMatchObject({ kind: "error", variant: "runtime" });
    if (r.kind !== "error") return;
    expect(r.command).toBeUndefined();
    expect(r.language).toBeUndefined();
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toBeUndefined();
    expect(r.stderr).toBeUndefined();
    expect(r.message).toBe(fx.err_runtime_plain);
  });

  it("prose above the dump is kept as a preamble, never dropped", () => {
    const r = parseCtxResult("ctx_execute", `Runtime error: sandbox refused.\n\n${fx.err_runtime}`, true);
    if (r.kind !== "error") throw new Error("expected error kind");
    expect(r.preamble).toBe("Runtime error: sandbox refused.");
    expect(r.exitCode).toBe(1);
  });

  it("never throws on partial or malformed execution shapes", () => {
    const bodies = [
      "```shell\nunterminated fence",
      "Exit code: not-a-number",
      "stdout:",
      "stderr:\n\n\nstdout:\nout",
      "```\n\n```\nExit code: -1",
    ];
    for (const body of bodies) {
      const r = parseCtxResult("ctx_execute", body, true);
      expect(r.kind).toBe("error");
    }
  });
});

describe("parseCtxResult — raw fallback never throws", () => {
  const malformed = "totally unexpected output \n with no recognizable header ## fake";
  const tools = [
    "ctx_execute",
    "ctx_execute_file",
    "ctx_batch_execute",
    "ctx_search",
    "ctx_index",
    "ctx_fetch_and_index",
    "ctx_insight",
    "ctx_stats", // unmapped ctx_* tool
  ];

  for (const tool of tools) {
    it(`${tool} falls back to raw on malformed input`, () => {
      const r = parseCtxResult(tool, malformed, false);
      // execute/insight always produce their kind (stdout/log is the body),
      // structured tools fall back to raw when their header is absent.
      if (["ctx_batch_execute", "ctx_index", "ctx_fetch_and_index", "ctx_stats"].includes(tool)) {
        expect(r.kind).toBe("raw");
      }
      expect(() => r).not.toThrow();
    });
  }

  it("handles undefined result without throwing", () => {
    expect(() => parseCtxResult("ctx_execute", undefined, false)).not.toThrow();
    const r = parseCtxResult("ctx_search", undefined, false);
    expect(r.kind === "search" || r.kind === "raw").toBe(true);
  });

  it("strips noise even on the raw fallback path", () => {
    const r = parseCtxResult("ctx_index", fx.index_with_banner.replace("Indexed 830", "NOPE 830"), false);
    expect(r.kind).toBe("raw");
    if (r.kind === "raw") expect(r.text).not.toMatch(/context-mode v/);
  });
});
