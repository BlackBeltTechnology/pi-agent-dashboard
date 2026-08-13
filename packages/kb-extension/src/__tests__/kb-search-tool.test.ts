// Tests for the kb_search tool's output contract (condensed default + json opt-in).
// Folded from openspec/changes/slim-kb-search-output/test-plan.md (E1–E4, E10, E11, E13).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import kbExtension from "../extension.js";

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
