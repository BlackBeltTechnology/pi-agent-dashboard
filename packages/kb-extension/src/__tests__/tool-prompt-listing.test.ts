// Every kb tool declares a promptSnippet (pi lists only snippet-bearing tools in
// the system prompt's <tools> section) plus at least one promptGuideline.
// See change: fix-forced-system-prompt-drops-tool-guidelines (design D7).
import { describe, expect, it } from "vitest";
import kbExtension from "../extension.js";

type ToolDef = { name: string; promptSnippet?: string; promptGuidelines?: string[] };

function registeredTools(): Map<string, ToolDef> {
  const tools = new Map<string, ToolDef>();
  const pi = {
    registerTool: (def: ToolDef) => tools.set(def.name, def),
    on: () => {},
    sendMessage: () => {},
  } as unknown as Parameters<typeof kbExtension>[0];
  kbExtension(pi);
  return tools;
}

describe("kb tools are listed in the system prompt", () => {
  const tools = registeredTools();

  it.each(["kb_search", "kb_get", "kb_neighbors", "kb_guard_pause"])(
    "%s has a one-line promptSnippet and a guideline naming it",
    (name) => {
      const def = tools.get(name);
      expect(def, `${name} registered`).toBeDefined();
      expect(def?.promptSnippet?.trim()).toBeTruthy();
      expect(def?.promptSnippet).not.toMatch(/\n/);
      expect(def?.promptGuidelines?.some((g) => g.includes(name))).toBe(true);
    },
  );

  it("kb_guard_pause guideline forbids using it to skip a kb lookup", () => {
    const g = tools.get("kb_guard_pause")?.promptGuidelines?.join(" ") ?? "";
    expect(g).toMatch(/never/i);
    expect(g).toMatch(/skip/i);
  });
});
