import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/git.js", () => ({
  numstatOr: vi.fn(() => ""),
  diffOr: vi.fn(() => ""),
  statusPorcelainOr: vi.fn(() => ""),
}));
vi.mock("../git-operations.js", () => ({ isGitRepo: vi.fn(() => true) }));

import { extractFileChanges, gitNumstat, enrichWithGitDiff } from "../session-diff.js";
import * as git from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import { isGitRepo } from "../git-operations.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";

function makeEvent(eventType: string, timestamp: number, data: Record<string, unknown> = {}): DashboardEvent {
  return { eventType, timestamp, data: { type: eventType, ...data } };
}

function makeToolStart(toolName: string, args: Record<string, unknown>, timestamp = 1000): DashboardEvent {
  return makeEvent("tool_execution_start", timestamp, { toolName, toolCallId: `tc-${timestamp}`, args });
}

function makeMessageEnd(text: string, timestamp = 900): DashboardEvent {
  return makeEvent("message_end", timestamp, {
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

describe("extractFileChanges", () => {
  const cwd = "/project";

  it("should extract Write tool events", () => {
    const events = [
      makeToolStart("Write", { path: "src/foo.ts", content: "hello world" }, 1000),
    ];
    const result = extractFileChanges(events, cwd);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/foo.ts");
    expect(result[0].changes).toHaveLength(1);
    expect(result[0].changes[0].type).toBe("write");
    expect(result[0].changes[0].content).toBe("hello world");
    expect(result[0].changes[0].timestamp).toBe(1000);
  });

  it("should extract Edit tool events", () => {
    const edits = [{ oldText: "foo", newText: "bar" }];
    const events = [
      makeToolStart("Edit", { path: "src/bar.ts", edits }, 2000),
    ];
    const result = extractFileChanges(events, cwd);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/bar.ts");
    expect(result[0].changes[0].type).toBe("edit");
    expect(result[0].changes[0].edits).toEqual(edits);
  });

  it("should be case-insensitive for tool names", () => {
    const events = [
      makeToolStart("write", { path: "a.ts", content: "x" }, 1000),
      makeToolStart("EDIT", { path: "b.ts", edits: [{ oldText: "a", newText: "b" }] }, 2000),
    ];
    const result = extractFileChanges(events, cwd);
    expect(result).toHaveLength(2);
  });

  it("should support file_path arg alias", () => {
    const events = [
      makeToolStart("Write", { file_path: "src/alt.ts", content: "x" }, 1000),
    ];
    const result = extractFileChanges(events, cwd);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/alt.ts");
  });

  it("should group multiple changes to same file", () => {
    const events = [
      makeToolStart("Write", { path: "src/foo.ts", content: "v1" }, 1000),
      makeToolStart("Edit", { path: "src/foo.ts", edits: [{ oldText: "v1", newText: "v2" }] }, 2000),
    ];
    const result = extractFileChanges(events, cwd);
    expect(result).toHaveLength(1);
    expect(result[0].changes).toHaveLength(2);
    expect(result[0].changes[0].type).toBe("write");
    expect(result[0].changes[1].type).toBe("edit");
  });

  it("should order changes by timestamp", () => {
    const events = [
      makeToolStart("Edit", { path: "src/foo.ts", edits: [{ oldText: "a", newText: "b" }] }, 3000),
      makeToolStart("Write", { path: "src/foo.ts", content: "init" }, 1000),
    ];
    const result = extractFileChanges(events, cwd);
    expect(result[0].changes[0].timestamp).toBe(1000);
    expect(result[0].changes[1].timestamp).toBe(3000);
  });

  it("should filter out absolute paths outside cwd", () => {
    const events = [
      makeToolStart("Write", { path: "/tmp/scratch.ts", content: "x" }, 1000),
      makeToolStart("Write", { path: "/project/src/inside.ts", content: "y" }, 2000),
      makeToolStart("Write", { path: "src/relative.ts", content: "z" }, 3000),
    ];
    const result = extractFileChanges(events, cwd);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.path).sort()).toEqual(["src/inside.ts", "src/relative.ts"]);
  });

  it("should extract preceding assistant message as context", () => {
    const events = [
      makeMessageEnd("I'll create the file now", 900),
      makeToolStart("Write", { path: "src/foo.ts", content: "hello" }, 1000),
    ];
    const result = extractFileChanges(events, cwd);
    expect(result[0].changes[0].message).toBe("I'll create the file now");
  });

  it("should truncate long context messages to 120 chars", () => {
    const longMsg = "A".repeat(200);
    const events = [
      makeMessageEnd(longMsg, 900),
      makeToolStart("Write", { path: "src/foo.ts", content: "hello" }, 1000),
    ];
    const result = extractFileChanges(events, cwd);
    expect(result[0].changes[0].message!.length).toBeLessThanOrEqual(123); // 120 + "..."
  });

  it("should ignore non-Write/Edit tool events", () => {
    const events = [
      makeToolStart("Read", { path: "src/foo.ts" }, 1000),
      makeToolStart("Bash", { command: "ls" }, 2000),
    ];
    const result = extractFileChanges(events, cwd);
    expect(result).toHaveLength(0);
  });

  it("should skip events with no path", () => {
    const events = [
      makeToolStart("Write", { content: "no path" }, 1000),
    ];
    const result = extractFileChanges(events, cwd);
    expect(result).toHaveLength(0);
  });

  it("should return empty array for empty events", () => {
    const result = extractFileChanges([], cwd);
    expect(result).toHaveLength(0);
  });
});

describe("gitNumstat parser", () => {
  beforeEach(() => {
    vi.mocked(git.numstatOr).mockReset();
  });

  it("parses tab-separated adds/dels/path rows", () => {
    vi.mocked(git.numstatOr).mockReturnValue("1\t2\tsrc/a.ts\n5\t3\tsrc/b.ts\n");
    const map = gitNumstat("/project");
    expect(map.get("src/a.ts")).toEqual({ additions: 1, deletions: 2 });
    expect(map.get("src/b.ts")).toEqual({ additions: 5, deletions: 3 });
  });

  it("omits binary rows reporting `-`", () => {
    vi.mocked(git.numstatOr).mockReturnValue("-\t-\timg.png\n2\t0\tsrc/a.ts\n");
    const map = gitNumstat("/project");
    expect(map.has("img.png")).toBe(false);
    expect(map.get("src/a.ts")).toEqual({ additions: 2, deletions: 0 });
  });

  it("skips blank and malformed lines", () => {
    vi.mocked(git.numstatOr).mockReturnValue("\ngarbage\n3\t4\tsrc/c.ts\n");
    const map = gitNumstat("/project");
    expect(map.size).toBe(1);
    expect(map.get("src/c.ts")).toEqual({ additions: 3, deletions: 4 });
  });

  it("returns empty map for empty output", () => {
    vi.mocked(git.numstatOr).mockReturnValue("");
    expect(gitNumstat("/project").size).toBe(0);
  });
});

describe("enrichWithGitDiff numstat counts", () => {
  const files: FileDiffEntry[] = [
    { path: "src/a.ts", changes: [] },
    { path: "src/b.ts", changes: [] },
  ];

  beforeEach(() => {
    vi.mocked(isGitRepo).mockReset().mockReturnValue(true);
    vi.mocked(git.diffOr).mockReset().mockReturnValue("");
    vi.mocked(git.statusPorcelainOr).mockReset().mockReturnValue("");
    vi.mocked(git.numstatOr).mockReset().mockReturnValue("");
  });

  it("attaches per-file counts and aggregate totals", () => {
    vi.mocked(git.numstatOr).mockReturnValue("1\t2\tsrc/a.ts\n5\t3\tsrc/b.ts\n");
    const { enrichedFiles, isGitRepo: isRepo, totalAdditions, totalDeletions } =
      enrichWithGitDiff("/project", files);
    expect(isRepo).toBe(true);
    expect(enrichedFiles[0]).toMatchObject({ path: "src/a.ts", additions: 1, deletions: 2 });
    expect(enrichedFiles[1]).toMatchObject({ path: "src/b.ts", additions: 5, deletions: 3 });
    expect(totalAdditions).toBe(6);
    expect(totalDeletions).toBe(5);
  });

  it("excludes binary files from per-file counts and totals", () => {
    const withBinary: FileDiffEntry[] = [
      { path: "img.png", changes: [] },
      { path: "src/a.ts", changes: [] },
    ];
    vi.mocked(git.numstatOr).mockReturnValue("-\t-\timg.png\n2\t0\tsrc/a.ts\n");
    const { enrichedFiles, totalAdditions, totalDeletions } =
      enrichWithGitDiff("/project", withBinary);
    expect(enrichedFiles[0].additions).toBeUndefined();
    expect(enrichedFiles[0].deletions).toBeUndefined();
    expect(enrichedFiles[1]).toMatchObject({ additions: 2, deletions: 0 });
    expect(totalAdditions).toBe(2);
    expect(totalDeletions).toBe(0);
  });

  it("omits all count fields for a non-git repo", () => {
    vi.mocked(isGitRepo).mockReturnValue(false);
    const { enrichedFiles, isGitRepo: isRepo, totalAdditions, totalDeletions } =
      enrichWithGitDiff("/project", files);
    expect(isRepo).toBe(false);
    expect(enrichedFiles[0].additions).toBeUndefined();
    expect(totalAdditions).toBeUndefined();
    expect(totalDeletions).toBeUndefined();
  });

  it("succeeds with counts absent when the git repo check throws", () => {
    vi.mocked(isGitRepo).mockImplementation(() => {
      throw new Error("corrupt repo");
    });
    const { enrichedFiles, isGitRepo: isRepo, totalAdditions } =
      enrichWithGitDiff("/project", files);
    expect(isRepo).toBe(false);
    expect(enrichedFiles).toEqual(files);
    expect(totalAdditions).toBeUndefined();
  });
});
