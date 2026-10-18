// Tests for the kb_search tool's output contract (condensed default + json opt-in).
// Folded from openspec/changes/slim-kb-search-output/test-plan.md (E1–E4, E10, E11, E13).
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexSource, SqliteFtsStore } from "@blackbelt-technology/pi-dashboard-kb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import kbExtension from "../extension.js";

// Passthrough mock so freshness tests can hang / reject `indexSource` per call.
vi.mock("@blackbelt-technology/pi-dashboard-kb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-kb")>();
  return { ...actual, indexSource: vi.fn(actual.indexSource) };
});

type Tool = {
  name: string;
  description: string;
  execute: (id: string, params: Record<string, unknown>, signal: undefined, onUpdate: undefined, ctx: { cwd: string }) => Promise<{ content: { type: string; text: string }[]; details: { hits: number } }>;
};

/** Load the extension against a fake pi and return its registered tools. */
function loadTools(): Map<string, Tool> {
  const tools = new Map<string, Tool>();
  const pi = {
    registerTool: (t: Tool) => tools.set(t.name, t),
    on: () => {},
  } as unknown as Parameters<typeof kbExtension>[0];
  kbExtension(pi);
  return tools;
}

/** Temp project with a KB config + a multi-section doc → several ranked hits. */
function setupProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-tool-"));
  mkdirSync(join(dir, ".pi", "dashboard", "kb"), { recursive: true });
  writeFileSync(
    join(dir, ".pi", "dashboard", "knowledge_base.json"),
    JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs", priority: 5 }], dbPath: ".pi/dashboard/kb/index.db" }),
  );
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(
    join(dir, "docs", "auth.md"),
    "# Auth Guide\nExplains how token authentication works including the interceptor and principal resolution flow in enough detail to exceed the merge threshold cleanly.\n" +
      "## Token Extraction\nExtract claims from the bearer token to identify the principal user account; this body is long enough to remain its own dedicated chunk for testing.\n" +
      "## Token Rotation\nRotate the refresh token periodically to limit exposure; this subsection is intentionally verbose so it survives merge and stays a distinct chunk.",
  );
  return dir;
}

describe("kb_search tool output contract", () => {
  let dir: string;
  let kbSearch: Tool;
  beforeAll(() => {
    dir = setupProject();
    kbSearch = loadTools().get("kb_search")!;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (params: Record<string, unknown>) => kbSearch.execute("id", params, undefined, undefined, { cwd: dir });

  it("E1: condensed by default — first entry is rank-led, no BM25 float", async () => {
    const text = (await run({ query: "token" })).content[0].text;
    const firstLine = text.split("\n")[0];
    expect(firstLine).toMatch(/^1  \S+  ::  /);
    expect(text).not.toMatch(/-\d+\.\d\d/); // no negative BM25 float leaked
  });

  it("E2: format json — compact, each hit has numeric score + integer rank, slim parent", async () => {
    const text = (await run({ query: "token", format: "json" })).content[0].text;
    expect(text).not.toContain("\n  "); // compact, not pretty-printed
    const hits = JSON.parse(text) as { score: unknown; rank: unknown; parent?: Record<string, unknown> | null }[];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(typeof h.score).toBe("number");
      expect(Number.isInteger(h.rank)).toBe(true);
      if (h.parent) expect(Object.keys(h.parent)).toEqual(["headingPath"]);
    }
  });

  it("E3: unknown format falls back to condensed, no throw", async () => {
    const text = (await run({ query: "token", format: "xml" })).content[0].text;
    expect(text.split("\n")[0]).toMatch(/^1  \S+  ::  /);
  });

  it("E4: format allowlist is exact-match — wrong case falls back to condensed", async () => {
    const text = (await run({ query: "token", format: "JSON" })).content[0].text;
    expect(text.split("\n")[0]).toMatch(/^1  \S+  ::  /);
    expect(() => JSON.parse(text)).toThrow(); // proves it is NOT json
  });

  it("E10: empty/whitespace query, condensed → explicit (no query) marker", async () => {
    const text = (await run({ query: "   " })).content[0].text;
    expect(text).toBe("(no query)");
  });

  it("E11: empty query, json → []", async () => {
    const text = (await run({ query: "", format: "json" })).content[0].text;
    expect(text).toBe("[]");
  });

  it("E13: description describes condensed default + format, not the stale JSON-object shape", () => {
    expect(kbSearch.description).not.toContain("{path, headingPath, score, snippet, akaPaths, parent}");
    expect(kbSearch.description.toLowerCase()).toContain("condensed");
    expect(kbSearch.description).toContain("format");
  });

  // --- change: fix-kb-search-retrieval-quality ------------------------------

  it("no two condensed entries name the same path (limit bounds distinct sources)", async () => {
    const text = (await run({ query: "token", limit: 10 })).content[0].text;
    const paths = text.split("\n").filter((l) => /^\d+  /.test(l)).map((l) => l.split("  ")[1]);
    expect(paths.length).toBeGreaterThan(0);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("condensed output carries the leaf heading, not the full breadcrumb", async () => {
    const text = (await run({ query: "token extraction claims" })).content[0].text;
    const header = text.split("\n").find((l) => /^\d+  /.test(l))!;
    expect(header).not.toContain(" > ");
  });

  it("condensed output marks further matching sections of the same source", async () => {
    const text = (await run({ query: "token", limit: 10 })).content[0].text;
    // auth.md has three matching sections collapsed to one entry.
    expect(text).toMatch(/\(\+\d+ more sections?\)/);
  });

  it("json format retains score, rank, the FULL headingPath and the suppressed count", async () => {
    const text = (await run({ query: "token", format: "json" })).content[0].text;
    const hits = JSON.parse(text) as { headingPath: string; score: number; rank: number; suppressedSections?: number }[];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(typeof h.headingPath).toBe("string");
      expect(h.headingPath.length).toBeGreaterThan(0);
      expect(typeof h.suppressedSections).toBe("number");
    }
    expect(hits.some((h) => h.headingPath.includes(" > "))).toBe(true);
  });

  it("the description states the delivered shape and drops the unrewarded term-count advice", () => {
    expect(kbSearch.description).toContain("leafHeading");
    expect(kbSearch.description).toContain("more sections");
    expect(kbSearch.description).toContain("DISTINCT SOURCES");
    expect(kbSearch.description).not.toContain("Prefer 2");
  });
});

describe("kb_get tool: path-only fetch never truncates silently (design D7)", () => {
  let dir: string;
  let kbGet: Tool;
  let kbSearch: Tool;
  beforeAll(async () => {
    dir = setupProject();
    const tools = loadTools();
    kbGet = tools.get("kb_get")!;
    kbSearch = tools.get("kb_search")!;
    await kbSearch.execute("id", { query: "token" }, undefined, undefined, { cwd: dir }); // populate the index
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reports how many further sections exist for a multi-section file", async () => {
    const res = await kbGet.execute("id", { path: "auth.md" }, undefined, undefined, { cwd: dir });
    expect(res.content[0].text).toMatch(/\(\+\d+ more sections? in this file/);
    expect((res.details as unknown as { suppressedSections: number }).suppressedSections).toBeGreaterThan(0);
  });

  it("adds no marker when a section is addressed explicitly", async () => {
    const json = (await kbSearch.execute("id", { query: "token extraction claims", format: "json" }, undefined, undefined, { cwd: dir })).content[0].text;
    const target = (JSON.parse(json) as { path: string; headingPath: string }[]).find((h) => h.path.endsWith("auth.md"))!;
    const res = await kbGet.execute("id", { path: target.path, section: target.headingPath }, undefined, undefined, { cwd: dir });
    expect(res.content[0].text).not.toMatch(/more sections? in this file/);
  });

  it("still reports a clean not-found", async () => {
    const res = await kbGet.execute("id", { path: "nope.md" }, undefined, undefined, { cwd: dir });
    expect(res.content[0].text).toContain("(not found: nope.md)");
  });
});

// --- change: bound-kb-search-freshness -------------------------------------
const STALE = "(index refresh still running — results may be stale)";
const BUILDING = "(index is still being built — no results available yet; retry shortly)";
const CANCELLED = "(cancelled — no results retrieved)";

type Res = { content: { type: string; text: string }[]; details: Record<string, unknown> };
type AnyTool = { execute: (id: string, p: Record<string, unknown>, s: AbortSignal | undefined, u: undefined, ctx: { cwd: string }) => Promise<Res> };
type IdxResult = Awaited<ReturnType<typeof indexSource>>;

describe("kb tools: bounded, abortable freshness (bound-kb-search-freshness)", () => {
  const dirs: string[] = [];
  let actualIndexSource: typeof indexSource;
  beforeAll(async () => {
    actualIndexSource = (await vi.importActual<typeof import("@blackbelt-technology/pi-dashboard-kb")>("@blackbelt-technology/pi-dashboard-kb")).indexSource;
  });
  afterEach(() => {
    delete process.env.KB_FRESHNESS_BUDGET_MS;
    vi.mocked(indexSource).mockReset();
    vi.mocked(indexSource).mockImplementation((...a) => actualIndexSource(...a));
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const project = () => { const d = setupProject(); dirs.push(d); return d; };
  const tools = () => {
    const t = loadTools() as unknown as Map<string, AnyTool>;
    return { search: t.get("kb_search")!, get: t.get("kb_get")!, neighbors: t.get("kb_neighbors")!, all: [t.get("kb_search")!, t.get("kb_get")!, t.get("kb_neighbors")!] };
  };
  const callAll = (t: ReturnType<typeof tools>, cwd: string, signal?: AbortSignal) => [
    t.search.execute("i", { query: "token" }, signal, undefined, { cwd }),
    t.get.execute("i", { path: "auth.md" }, signal, undefined, { cwd }),
    t.neighbors.execute("i", { node: "auth.md" }, signal, undefined, { cwd }),
  ];
  const hang = () => {
    let release!: (v: IdxResult) => void;
    const p = new Promise<IdxResult>((r) => (release = r));
    vi.mocked(indexSource).mockImplementation(() => p);
    return release;
  };
  const warm = async (t: ReturnType<typeof tools>, cwd: string) => (await t.search.execute("i", { query: "token" }, undefined, undefined, { cwd })).content[0].text;

  it("E9/E11: timeout with chunks>0 → stale line then hits; json: line + byte-identical array as final line", async () => {
    const dir = project();
    const t = tools();
    const doneCondensed = await warm(t, dir);
    const doneJson = (await t.search.execute("i", { query: "token", format: "json" }, undefined, undefined, { cwd: dir })).content[0].text;
    const release = hang();
    process.env.KB_FRESHNESS_BUDGET_MS = "20";
    const c = await t.search.execute("i", { query: "token" }, undefined, undefined, { cwd: dir });
    expect(c.content[0].text).toBe(`${STALE}\n${doneCondensed}`);
    expect(c.details.stale).toBe(true);
    const j = (await t.search.execute("i", { query: "token", format: "json" }, undefined, undefined, { cwd: dir })).content[0].text;
    expect(j).toBe(`${STALE}\n${doneJson}`);
    expect(j.split("\n").pop()).toBe(doneJson);
    release({ scanned: 0, changed: 0, deleted: 0, chunks: 0 });
  });

  it("E9/E12: cold index + timeout → being-built line, never a hit list; json = line + []", async () => {
    const dir = project();
    const t = tools();
    hang();
    process.env.KB_FRESHNESS_BUDGET_MS = "20";
    const c = await t.search.execute("i", { query: "token" }, undefined, undefined, { cwd: dir });
    expect(c.content[0].text).toBe(BUILDING);
    const j = await t.search.execute("i", { query: "token", format: "json" }, undefined, undefined, { cwd: dir });
    expect(j.content[0].text.split("\n")).toEqual([BUILDING, "[]"]);
  });

  it("E10: cold + timeout on kb_get / kb_neighbors → being-built replaces (not found)/empty list", async () => {
    const dir = project();
    const t = tools();
    hang();
    process.env.KB_FRESHNESS_BUDGET_MS = "20";
    expect((await t.get.execute("i", { path: "auth.md" }, undefined, undefined, { cwd: dir })).content[0].text).toBe(BUILDING);
    expect((await t.neighbors.execute("i", { node: "auth.md" }, undefined, undefined, { cwd: dir })).content[0].text).toBe(BUILDING);
  });

  it("E9: done → no status line (warm, pass finishes in budget)", async () => {
    const dir = project();
    const t = tools();
    const text = await warm(t, dir);
    expect(text).not.toContain("(index");
    expect(text).not.toContain("(cancelled");
  });

  it("E9/X1: failed pass with existing chunks → stale line + existing hits (warn logged)", async () => {
    const dir = project();
    const t = tools();
    const baseline = await warm(t, dir);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(indexSource).mockRejectedValue(new Error("walk exploded"));
    const out = (await t.search.execute("i", { query: "token" }, undefined, undefined, { cwd: dir })).content[0].text;
    expect(out).toBe(`${STALE}\n${baseline}`);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("walk exploded"))).toBe(true);
    warn.mockRestore();
  });

  it("X2: failed pass on a cold index → well-formed, stale line, never the being-built line", async () => {
    const dir = project();
    const t = tools();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(indexSource).mockRejectedValue(new Error("deterministic failure"));
    for (const r of await Promise.all([
      t.get.execute("i", { path: "auth.md" }, undefined, undefined, { cwd: dir }),
      t.neighbors.execute("i", { node: "auth.md" }, undefined, undefined, { cwd: dir }),
    ])) {
      expect(r.content[0].text.startsWith(STALE)).toBe(true);
      expect(r.content[0].text).not.toContain(BUILDING);
    }
    warn.mockRestore();
  });

  it("E19: a completed-but-empty pass (source dir missing) → normal (not found), no being-built", async () => {
    const dir = project();
    rmSync(join(dir, "docs"), { recursive: true, force: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = tools();
    await t.search.execute("i", { query: "token" }, undefined, undefined, { cwd: dir }); // first pass completes
    const r = await t.get.execute("i", { path: "auth.md" }, undefined, undefined, { cwd: dir });
    expect(r.content[0].text).toBe("(not found: auth.md)");
    warn.mockRestore();
  });

  it("F5: budget 0, warm → pass starts in background, stale line, hits returned", async () => {
    const dir = project();
    const t = tools();
    const baseline = await warm(t, dir);
    const release = hang();
    vi.mocked(indexSource).mockClear();
    process.env.KB_FRESHNESS_BUDGET_MS = "0";
    const out = (await t.search.execute("i", { query: "token" }, undefined, undefined, { cwd: dir })).content[0].text;
    expect(indexSource).toHaveBeenCalledTimes(1);
    expect(out).toBe(`${STALE}\n${baseline}`);
    release({ scanned: 0, changed: 0, deleted: 0, chunks: 0 });
  });

  it("F7: budget 0 on a cold index → being-built on each of the three tools", async () => {
    const dir = project();
    const t = tools();
    hang();
    process.env.KB_FRESHNESS_BUDGET_MS = "0";
    for (const r of await Promise.all(callAll(t, dir))) expect(r.content[0].text).toBe(BUILDING);
  });

  it("F13/F14: already-aborted signal → exactly the cancelled line on all three tools, nothing started, no throw", async () => {
    const dir = project();
    const t = tools();
    vi.mocked(indexSource).mockClear();
    for (const r of await Promise.all(callAll(t, dir, AbortSignal.abort()))) {
      expect(r.content[0].text).toBe(CANCELLED);
      expect(r.details.aborted).toBe(true);
    }
    expect(indexSource).not.toHaveBeenCalled();
  });

  it("E13: cancelled kb_search json → cancelled line then []", async () => {
    const dir = project();
    const r = await tools().search.execute("i", { query: "token", format: "json" }, AbortSignal.abort(), undefined, { cwd: dir });
    expect(r.content[0].text.split("\n")).toEqual([CANCELLED, "[]"]);
  });

  it("E14: cancel takes precedence over the empty-query marker; no reindex started", async () => {
    const dir = project();
    const t = tools();
    vi.mocked(indexSource).mockClear();
    for (const q of ["", "  "]) {
      expect((await t.search.execute("i", { query: q }, AbortSignal.abort(), undefined, { cwd: dir })).content[0].text).toBe(CANCELLED);
      expect((await t.search.execute("i", { query: q, format: "json" }, AbortSignal.abort(), undefined, { cwd: dir })).content[0].text).toBe(`${CANCELLED}\n[]`);
    }
    expect(indexSource).not.toHaveBeenCalled();
  });

  it("E15: empty query with a live signal → existing marker, no reindex", async () => {
    const dir = project();
    const t = tools();
    vi.mocked(indexSource).mockClear();
    expect((await t.search.execute("i", { query: " " }, new AbortController().signal, undefined, { cwd: dir })).content[0].text).toBe("(no query)");
    expect(indexSource).not.toHaveBeenCalled();
  });

  it("F9: abort mid-wait → each tool resolves with the cancelled line before the pass settles; no search/get/graph work", async () => {
    const dir = project();
    const t = tools();
    const release = hang();
    process.env.KB_FRESHNESS_BUDGET_MS = "30000";
    const ac = new AbortController();
    const pending = Promise.all(callAll(t, dir, ac.signal));
    await new Promise((r) => setTimeout(r, 30));
    const t0 = Date.now();
    ac.abort();
    for (const r of await pending) expect(r.content[0].text).toBe(CANCELLED);
    expect(Date.now() - t0).toBeLessThan(1000);
    release({ scanned: 0, changed: 0, deleted: 0, chunks: 0 });
  });

  it("F15: an absent signal behaves exactly like an unaborted one", async () => {
    const dir = project();
    const t = tools();
    await warm(t, dir);
    const a = await Promise.all(callAll(t, dir, undefined));
    const b = await Promise.all(callAll(t, dir, new AbortController().signal));
    expect(a.map((r) => r.content[0].text)).toEqual(b.map((r) => r.content[0].text));
  });

  it("F16: scope git + aborted signal → cancelled result on kb_search and kb_get, no forge/git work", async () => {
    const dir = project();
    const t = tools();
    const s = await t.search.execute("i", { query: "x", scope: "git" }, AbortSignal.abort(), undefined, { cwd: dir });
    const g = await t.get.execute("i", { path: "commit/abcdef1", scope: "git" }, AbortSignal.abort(), undefined, { cwd: dir });
    expect(s.content[0].text).toBe(CANCELLED);
    expect(g.content[0].text).toBe(CANCELLED);
  });

  it("F11: abort fired after the search → cancelled result, not a hit list", async () => {
    const dir = project();
    const t = tools();
    await warm(t, dir);
    const ac = new AbortController();
    const real = SqliteFtsStore.prototype.search;
    const spy = vi.spyOn(SqliteFtsStore.prototype, "search").mockImplementation(function (this: unknown, ...a: Parameters<typeof real>) {
      const r = real.apply(this as never, a);
      ac.abort();
      return r;
    });
    try {
      const r = await t.search.execute("i", { query: "token" }, ac.signal, undefined, { cwd: dir });
      expect(r.content[0].text).toBe(CANCELLED);
    } finally {
      spy.mockRestore();
    }
  });

  it("F12: abort during the verdict rename scan → cancelled line, no degraded GONE hit; scan child killed", async () => {
    const dir = project();
    const t = tools();
    await warm(t, dir);
    const bin = mkdtempSync(join(tmpdir(), "kb-gitstub-"));
    dirs.push(bin);
    const pidFile = join(bin, "pid");
    writeFileSync(join(bin, "git"), `#!/usr/bin/env node\nrequire("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 60000);\n`);
    chmodSync(join(bin, "git"), 0o755);
    const hit = { root: "docs", path: "AGENTS.md", headingPath: "DOX — x", chunkId: "x", docType: "agents", score: 1, snippet: "s", body: "| File | Purpose |\n|------|---------|\n| `missing-file.ts` | M. |\n" };
    const spy = vi.spyOn(SqliteFtsStore.prototype, "search").mockReturnValue([hit] as never);
    const prevPath = process.env.PATH;
    process.env.PATH = `${bin}:${prevPath}`;
    try {
      const ac = new AbortController();
      const p = t.search.execute("i", { query: "token" }, ac.signal, undefined, { cwd: dir });
      for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 20));
      ac.abort();
      const r = await p;
      expect(r.content[0].text).toBe(CANCELLED);
      expect(r.content[0].text).not.toContain("GONE");
    } finally {
      process.env.PATH = prevPath;
      spy.mockRestore();
    }
  }, 15_000);
});
