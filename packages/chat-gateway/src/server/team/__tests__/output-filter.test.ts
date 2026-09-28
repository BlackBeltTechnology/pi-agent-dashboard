/**
 * Outbound mirror filter + elision (change: add-chat-gateway-team-controls).
 * Scenarios: E24 (names-only omits structured payloads), X27 (prose boundary).
 */
import { describe, expect, it } from "vitest";
import { elide, renderMirror } from "../output-filter.js";

describe("renderMirror", () => {
  it("E24: names-only shows tool names + basename, omits args/diff/output", () => {
    const call = renderMirror(
      { kind: "tool_call", toolName: "edit", target: "/repo/src/secret.ts", args: { old: "x" }, diff: "@@ -1 +1 @@" },
      "names-only",
    );
    expect(call).toContain("edit");
    expect(call).toContain("secret.ts");
    expect(call).not.toContain("@@ -1 +1 @@");
    expect(call).not.toContain("old");

    expect(renderMirror({ kind: "tool_result", output: "command output" }, "names-only")).toBeNull();
    expect(renderMirror({ kind: "terminal", output: "ls -la" }, "names-only")).toBeNull();
    expect(renderMirror({ kind: "diff", diff: "@@ -1 +1 @@" }, "names-only")).toBeNull();
  });

  it("assistant prose is mirrored verbatim at names-only", () => {
    const prose = "Here is the diff I applied:\n@@ -1 +1 @@\n-old\n+new";
    expect(renderMirror({ kind: "assistant_text", text: prose }, "names-only")).toBe(prose);
  });

  it("X27: a diff quoted inside prose still mirrors verbatim", () => {
    const prose = "Q: why change\n```diff\n- a\n+ b\n```";
    expect(renderMirror({ kind: "assistant_text", text: prose }, "names-only")).toBe(prose);
  });

  it("names-and-diffs surfaces diffs but not full output/args", () => {
    expect(renderMirror({ kind: "diff", diff: "@@" }, "names-and-diffs")).toBe("@@");
    expect(renderMirror({ kind: "tool_result", output: "out" }, "names-and-diffs")).toBeNull();
  });

  it("full-transcript surfaces everything", () => {
    expect(renderMirror({ kind: "terminal", output: "out" }, "full-transcript")).toBe("out");
    expect(renderMirror({ kind: "tool_result", output: "res" }, "full-transcript")).toBe("res");
  });

  it("F7: elide never silently shortens content", () => {
    const long = "x".repeat(100);
    const cut = elide(long, 10);
    expect(cut.startsWith("xxxxxxxxxx")).toBe(true);
    expect(cut).toContain("elided");
    expect(elide("short", 100)).toBe("short");
  });
});
