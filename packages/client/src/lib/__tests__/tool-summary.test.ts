import { mdiFileDocumentOutline, mdiMagnify, mdiWrenchOutline } from "@mdi/js";
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
