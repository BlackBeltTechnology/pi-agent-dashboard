/**
 * @structural-pin tool-summary.ts must import no plugin or plugin runtime so the collapsed Agent summaries work with the plugin absent; import specifiers are only observable in the source text
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mdiFileDocumentOutline, mdiMagnify, mdiRobotOutline, mdiWrenchOutline } from "@mdi/js";
import { describe, expect, it } from "vitest";
import { getSummary, getToolIcon } from "../chat/tool-summary.js";

describe("getSummary", () => {
  it("renders a known tool summary", () => {
    expect(getSummary("read", { path: "/a" })).toBe("Read /a");
    expect(getSummary("grep", { pattern: "foo" })).toBe("Grep foo");
  });
  it("falls back to the tool name for an unknown kind", () => {
    expect(getSummary("mystery_tool")).toBe("mystery_tool");
  });
});

describe("getToolIcon", () => {
  it("maps known kinds to their mdi path", () => {
    expect(getToolIcon("grep")).toBe(mdiMagnify);
    expect(getToolIcon("read")).toBe(mdiFileDocumentOutline);
  });
  it("falls back to a generic wrench for unknown kinds", () => {
    expect(getToolIcon("mystery_tool")).toBe(mdiWrenchOutline);
    expect(getToolIcon("")).toBe(mdiWrenchOutline);
  });
});

// Agent-related tools keep their collapsed summary + icon in core, as tool-name
// data that needs no plugin (test-plan #E37; spec agent-tool-rendering).
describe("subagent tool summaries stay in core (E37)", () => {
  it("Agent / get_subagent_result / steer_subagent have descriptive summaries", () => {
    expect(getSummary("Agent", { subagent_type: "Explore", description: "Fix auth bug" })).toBe("Explore: Fix auth bug");
    expect(getSummary("get_subagent_result", { agent_id: "ag-1" })).toBe("Get result: ag-1");
    expect(getSummary("steer_subagent", { agent_id: "ag-1" })).toBe("Steer: ag-1");
  });

  it("they share the robot icon", () => {
    for (const name of ["Agent", "get_subagent_result", "steer_subagent"]) expect(getToolIcon(name)).toBe(mdiRobotOutline);
  });

  it("tool-summary.ts imports no plugin and no plugin runtime (works with the plugin absent)", () => {
    const src = readFileSync(resolve(__dirname, "../chat/tool-summary.ts"), "utf8");
    const specifiers = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers.filter((spec) => /plugin/i.test(spec))).toEqual([]);
  });
});
