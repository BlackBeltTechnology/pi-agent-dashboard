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

  // ── repair-tool-error-surfaces: folded scenario manifest (test-plan.md) ──────

  it("#E2 streams absent → command + exitCode set, streams undefined (not empty string)", () => {
    const r = parseCtxResult("ctx_execute", "```shell\nls /nope\n```\n\nExit code: 2", true);
    if (r.kind !== "error") throw new Error("expected error kind");
    expect(r.command).toBe("ls /nope");
    expect(r.exitCode).toBe(2);
    // `undefined` (section absent) must stay distinguishable from `""`
    // (section present but empty) — the renderer omits one and labels the other.
    expect(r.stdout).toBeUndefined();
    expect(r.stderr).toBeUndefined();
  });

  it("#E3 exit code 0 survives the falsy boundary", () => {
    const r = parseCtxResult("ctx_execute", "```shell\ntrue\n```\n\nExit code: 0", true);
    if (r.kind !== "error") throw new Error("expected error kind");
    expect(r.exitCode).toBe(0);
    expect(r.exitCode).not.toBeUndefined();
  });

  it("#E4 non-numeric exit code leaves the field undefined and keeps the text", () => {
    for (const body of ["```sh\nx\n```\n\nExit code: null", "```sh\nx\n```\n\nExit code:"]) {
      const r = parseCtxResult("ctx_execute", body, true);
      if (r.kind !== "error") throw new Error("expected error kind");
      expect(r.exitCode).toBeUndefined();
      expect(r.message).toContain("Exit code:");
    }
  });

  it("#E6 truncated body loses no text across command + streams + message", () => {
    const body = "```shell\ngrep foo\n\nExit code: 1\n\nstdout:\nhalf a li";
    const r = parseCtxResult("ctx_execute", body, true);
    if (r.kind !== "error") throw new Error("expected error kind");
    // The fence never closes, so nothing is structured out of it — but the
    // whole body must still be reachable verbatim through `message`.
    expect(r.message).toBe(body.trim());
  });

  it("#E7 the upgrade banner is stripped BEFORE shape detection", () => {
    const banner = "⚠️ context-mode v1.0.161 outdated → v1.0.162 available. Upgrade: npm run build\n\n";
    const r = parseCtxResult("ctx_execute", banner + fx.err_runtime_fenced, true);
    if (r.kind !== "error") throw new Error("expected error kind");
    expect(r.message).not.toContain("context-mode v");
    // …and every field still lands exactly as in the banner-free #E1 case.
    expect(r.language).toBe("shell");
    expect(r.command).toContain("npm run test:e2e");
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
    expect(r.preamble).toBeUndefined();
  });

  it("#E8 a fence with no language sets command and leaves language undefined", () => {
    const r = parseCtxResult("ctx_execute", "```\nmake build\n```\n\nExit code: 1", true);
    if (r.kind !== "error") throw new Error("expected error kind");
    expect(r.command).toBe("make build");
    expect(r.language).toBeUndefined();
  });

  it("#E9 delimiter injection inside stdout does not open a section or hijack the exit code", () => {
    const body = [
      "```shell",
      "cat log",
      "```",
      "",
      "Exit code: 1",
      "",
      "stdout:",
      "line one",
      "stderr:",
      "Exit code: 7",
      "line four",
      "",
      "stderr:",
      "the real stderr",
    ].join("\n");
    const r = parseCtxResult("ctx_execute", body, true);
    if (r.kind !== "error") throw new Error("expected error kind");
    expect(r.exitCode).toBe(1);
    // The injected lines are mid-stream (no blank line above), so they stay
    // inside stdout instead of splitting it.
    expect(r.stdout).toContain("stderr:");
    expect(r.stdout).toContain("Exit code: 7");
    expect(r.stdout).toContain("line four");
    expect(r.stderr).toBe("the real stderr");
  });

  it("#E10 with two fences the FIRST becomes command and the second survives verbatim", () => {
    const body = "```shell\nfirst cmd\n```\n\nsecond block:\n\n```js\nconst x = 1;\n```\n\nExit code: 3";
    const r = parseCtxResult("ctx_execute", body, true);
    if (r.kind !== "error") throw new Error("expected error kind");
    expect(r.command).toBe("first cmd");
    expect(r.language).toBe("shell");
    expect(r.exitCode).toBe(3);
    // No byte dropped: the second fence, markers included, stays in `message`.
    expect(r.message).toContain("```js");
    expect(r.message).toContain("const x = 1;");
  });

  it("#X1 fuzz table — no malformed body throws, and each keeps its text in message", () => {
    const bodies = [
      "",
      "```",
      "Exit code:",
      "```shell\r\nls\r\n```\r\n\r\nExit code: 1\r\n",
      "\u0000\u0007 control chars \u001b[31mred\u001b[0m",
      "stdout:\n\nstderr:\n",
      "Exit code: 1\n\nstdout:",
    ];
    for (const body of bodies) {
      const r = parseCtxResult("ctx_execute", body, true);
      expect(r.kind).toBe("error");
      if (r.kind !== "error") continue;
      const reachable = [r.preamble, r.command, r.stdout, r.stderr, r.message].filter(Boolean).join("\n");
      for (const token of body.split("\n").map((l) => l.trim()).filter(Boolean)) {
        expect(reachable).toContain(token);
      }
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
