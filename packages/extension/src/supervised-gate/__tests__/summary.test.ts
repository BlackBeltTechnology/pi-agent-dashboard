/**
 * Supervised action summary — L1. Test-plan: E44 (16 KiB diff cap) + the
 * command / path / stat / create-vs-replace / Agent content the card shows.
 */
import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { buildSupervisedSummary, capDiff, DIFF_BYTE_CAP, summaryMarkdown, summaryPlain, TRUNCATION_MARKER } from "../summary.js";

/** An `edit` whose rendered diff is exactly `bytes` long (single added line, ASCII). */
function editWithDiffBytes(bytes: number) {
  // diff of one hunk "-a\n+<filler>" = 2 + 1 + 1 + filler.length → 4 + filler
  const filler = "x".repeat(bytes - 4);
  return { path: "/w/repo/f.txt", edits: [{ oldText: "a", newText: filler }] };
}

describe("#E44 diff byte cap", () => {
  it("16383 and 16384 bytes: verbatim, no marker; 16385: first 16384 bytes + trailing marker", () => {
    for (const n of [16383, 16384]) {
      const s = buildSupervisedSummary("edit", editWithDiffBytes(n), "/w/repo");
      expect(Buffer.byteLength(s.diff!)).toBe(n);
      expect(s.diff!.endsWith(TRUNCATION_MARKER)).toBe(false);
    }
    const full = buildSupervisedSummary("edit", editWithDiffBytes(16385), "/w/repo");
    expect(full.diff!.endsWith(TRUNCATION_MARKER)).toBe(true);
    const kept = full.diff!.slice(0, -TRUNCATION_MARKER.length);
    expect(Buffer.byteLength(kept)).toBe(DIFF_BYTE_CAP);
    expect(kept.startsWith("-a\n+xxx")).toBe(true);
  });

  it("never splits a multi-byte character at the cut", () => {
    const text = `${"x".repeat(DIFF_BYTE_CAP - 1)}éé`; // 'é' is 2 bytes straddling the cap
    const out = capDiff(text);
    expect(out.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(out).not.toContain("\uFFFD");
    expect(Buffer.byteLength(out.slice(0, -TRUNCATION_MARKER.length))).toBeLessThanOrEqual(DIFF_BYTE_CAP);
  });
});

describe("summary content", () => {
  it("bash / powershell: command text", () => {
    for (const tool of ["bash", "powershell"]) {
      const s = buildSupervisedSummary(tool, { command: "rm -rf build" }, "/w/repo");
      expect(s).toMatchObject({ tool, title: "Run this command?", command: "rm -rf build", cwd: "/w/repo", line: `${tool}: rm -rf build` });
    }
  });

  it("edit: path + `+N −M` stat (common lines trimmed) + diff", () => {
    const s = buildSupervisedSummary(
      "edit",
      { path: "/w/repo/a.ts", edits: [{ oldText: "keep\nold1\nold2\nend", newText: "keep\nnew1\nend" }, { oldText: "z", newText: "z2\nz3" }] },
      "/w/repo",
    );
    expect(s.title).toBe("Edit this file?");
    expect(s.path).toBe("/w/repo/a.ts");
    expect(s.diffStat).toBe("+3 −3");
    expect(s.diff).toBe("-old1\n-old2\n+new1\n-z\n+z2\n+z3");
  });

  it("edit accepts `edits` sent as a JSON string; odd input degrades without throwing", () => {
    const json = JSON.stringify([{ oldText: "a", newText: "b" }]);
    expect(buildSupervisedSummary("edit", { path: "p", edits: json }, "/c").diffStat).toBe("+1 −1");
    expect(buildSupervisedSummary("edit", { path: "p", edits: "not json" }, "/c").diffStat).toBe("+0 −0");
    expect(buildSupervisedSummary("bash", null, "/c").command).toBe("");
    expect(buildSupervisedSummary("weird_tool", undefined, "/c")).toMatchObject({ tool: "weird_tool", line: "weird_tool" });
  });

  it("write: create (no file) shows all lines added; replace diffs against the existing file", () => {
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "sup-sum-"));
    try {
      const create = buildSupervisedSummary("write", { path: "notes/x.txt", content: "a\nb\nc\n" }, dir);
      expect(create).toMatchObject({ title: "Create this file?", diffStat: "+3 −0", diff: "+a\n+b\n+c" });
      fs.writeFileSync(nodePath.join(dir, "f.txt"), "a\nold\nc\n");
      const replace = buildSupervisedSummary("write", { path: "f.txt", content: "a\nnew\nc\n" }, dir);
      expect(replace).toMatchObject({ title: "Overwrite this file?", diffStat: "+1 −1", diff: "-old\n+new" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Agent: subagent type + task, with the not-approved-one-by-one caveat", () => {
    const s = buildSupervisedSummary("Agent", { subagent_type: "Explore", prompt: "find the thing" }, "/w");
    expect(s).toMatchObject({ title: "Start a subagent?", subagentType: "Explore", command: "find the thing" });
    expect(s.note).toMatch(/not approved one by one/);
    expect(summaryMarkdown(s)).toContain("Explore");
    expect(summaryPlain(s)).toContain("find the thing");
  });

  it("markdown / plain renderers carry command, stat and diff; plain has no control chars", () => {
    const s = buildSupervisedSummary("edit", { path: "/p\u0007", edits: [{ oldText: "a", newText: "b" }] }, "/w");
    expect(summaryMarkdown(s)).toContain("```diff\n-a\n+b\n```");
    expect(summaryMarkdown(s)).toContain("(+1 −1)");
    expect(summaryPlain(s)).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
  });
});
