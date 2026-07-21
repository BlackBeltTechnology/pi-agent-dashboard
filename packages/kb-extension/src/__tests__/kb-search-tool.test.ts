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
});
