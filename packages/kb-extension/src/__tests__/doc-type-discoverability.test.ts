// Tests for change: fix-kb-search-lane-composition — `doc_type` must be
// discoverable from the tool schema alone (design D4).
// Folded from openspec/changes/fix-kb-search-lane-composition/test-plan.md
// (E1 parameter description, E2 prompt guideline).
// Exemplar: packages/kb-extension/src/__tests__/kb-search-tool.test.ts (loadTools).
import { describe, expect, it } from "vitest";
import kbExtension from "../extension.js";

type Tool = {
  name: string;
  description: string;
  promptGuidelines?: string[];
  parameters: { properties?: Record<string, { description?: string; [k: string]: unknown }> };
};

function loadTools(): Map<string, Tool> {
  const tools = new Map<string, Tool>();
  const pi = { registerTool: (t: Tool) => tools.set(t.name, t), on: () => {} } as unknown as Parameters<typeof kbExtension>[0];
  kbExtension(pi);
  return tools;
}

const kbSearch = () => loadTools().get("kb_search")!;

/** The parameter schema is a TypeBox object; `doc_type` is wrapped in
 *  `Type.Optional`, which keeps the description on the property schema. */
function docTypeSchema(): { description?: string } {
  const props = kbSearch().parameters.properties;
  expect(props, "kb_search parameters must expose properties").toBeTruthy();
  return props!.doc_type as { description?: string };
}

describe("E1: doc_type parameter description", () => {
  it("carries a non-empty description", () => {
    const d = docTypeSchema().description;
    expect(typeof d).toBe("string");
    expect((d ?? "").trim().length).toBeGreaterThan(0);
  });

  it("names BOTH lanes — the agents value and the unset/default lane", () => {
    const d = (docTypeSchema().description ?? "").toLowerCase();
    expect(d).toContain("agents");
    expect(d).toMatch(/unset|leave it out|omit|default/);
  });

  it("does not recommend one value unconditionally", () => {
    const d = (docTypeSchema().description ?? "").toLowerCase();
    // A description that says "always"/"prefer agents" would re-create the
    // measured markdown-intent regression (P@1 0.150 → 0.067 under the filter).
    expect(d).not.toMatch(/\balways\b/);
    expect(d).not.toMatch(/prefer\s+["']?agents/);
    // The trade-off must be conditional: a file/symbol arm AND a conceptual arm.
    expect(d).toMatch(/file|symbol/);
    expect(d).toMatch(/conceptual|how\b|works/);
  });
});

describe("E2: promptGuidelines entry", () => {
  it("has an entry carrying both halves of the lane choice", () => {
    const entries = kbSearch().promptGuidelines ?? [];
    const match = entries.find((e) => /doc_type/.test(e));
    expect(match, `no promptGuidelines entry mentions doc_type: ${JSON.stringify(entries)}`).toBeTruthy();
    const e = match!.toLowerCase();
    expect(e).toMatch(/file|symbol/); // → agents
    expect(e).toContain("agents");
    expect(e).toMatch(/conceptual|how\b/); // → unset
    expect(e).toMatch(/unset|leave it out|omit/);
  });
});
