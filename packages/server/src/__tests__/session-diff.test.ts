import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/git.js", () => ({
  numstatOr: vi.fn(() => ""),
  diffOr: vi.fn(() => ""),
  statusPorcelainOr: vi.fn(() => ""),
}));
vi.mock("../git-operations.js", () => ({ isGitRepo: vi.fn(() => true) }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => Buffer.from("hello\nworld")),
  statSync: vi.fn(() => ({ size: 10, mtimeMs: 0 })),
}));

import { existsSync, readFileSync, statSync } from "node:fs";
import type { FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import * as git from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { isGitRepo } from "../git-operations.js";
import {
  bashOutputCandidates,
  buildSessionDiff,
  enrichWithGitDiff,
  extractBashWindows,
  extractFileChanges,
  gitNumstat,
  parsePorcelain,
  redactCommand,
} from "../session-diff.js";

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

// ── detect-tool-created-files: detection / attribution / ownership ──────────

function makeBash(command: string, timestamp: number, toolCallId = `b-${timestamp}`): DashboardEvent {
  return makeEvent("tool_execution_start", timestamp, { toolName: "bash", toolCallId, args: { command } });
}
function makeBashEnd(timestamp: number, toolCallId: string): DashboardEvent {
  return makeEvent("tool_execution_end", timestamp, { toolName: "bash", toolCallId, result: "" });
}

describe("parsePorcelain", () => {
  const cwd = "/project";

  it("C-unquotes quoted paths and resolves rename targets to normalizePath keys", () => {
    const raw = `?? "dir with space/f.txt"\nR  old.ts -> new.ts\n`;
    const { paths } = parsePorcelain(raw, cwd);
    expect(paths.has("dir with space/f.txt")).toBe(true);
    expect(paths.has("new.ts")).toBe(true);
    expect(paths.has("old.ts")).toBe(false);
  });

  it("drops out-of-cwd and sibling-prefix entries", () => {
    const raw = `?? ../sibling/x\n?? ../project-backup/y.ts\n M src/in.ts\n`;
    const { paths } = parsePorcelain(raw, "/home/user/project");
    // cwd-relative resolution: ../sibling and ../project-backup escape cwd
    expect([...paths]).toEqual(["src/in.ts"]);
  });

  it("skips pure deletions", () => {
    const { paths } = parsePorcelain(" D gone.ts\nD  staged-gone.ts\n?? kept.ts\n", cwd);
    expect(paths.has("gone.ts")).toBe(false);
    expect(paths.has("staged-gone.ts")).toBe(false);
    expect(paths.has("kept.ts")).toBe(true);
  });

  it("drops node_modules / .git noise even when not gitignored", () => {
    const raw = "?? node_modules/.cache/x.mjs\n?? .git/index.lock\n?? src/real.ts\n";
    const { paths } = parsePorcelain(raw, cwd);
    expect([...paths]).toEqual(["src/real.ts"]);
  });
});

describe("bashOutputCandidates", () => {
  it("parses redirects, -o/--output, and tee", () => {
    expect(bashOutputCandidates("python b.py > notes.md")).toContain("notes.md");
    expect(bashOutputCandidates("cat x >> log.txt")).toContain("log.txt");
    expect(bashOutputCandidates('npx nano-banana "logo" --output logo.png')).toContain("logo.png");
    expect(bashOutputCandidates("pandoc a.md -o out.docx")).toContain("out.docx");
    expect(bashOutputCandidates("echo hi | tee saved.txt")).toContain("saved.txt");
    expect(bashOutputCandidates("cmd --output=res.json")).toContain("res.json");
  });
});

describe("redactCommand", () => {
  it("strips secret shapes and caps length", () => {
    const red = redactCommand("curl -u user:s3cr3tTOKEN https://x > dump.json");
    expect(red).not.toContain("s3cr3tTOKEN");
    expect(red.length).toBeLessThanOrEqual(120);
  });
});

describe("extractBashWindows", () => {
  it("pairs start/end by toolCallId and open windows use now", () => {
    const events = [
      makeBash("cmd", 100, "a"),
      makeBashEnd(200, "a"),
      makeBash("cmd2", 300, "b"), // no end
    ];
    const windows = extractBashWindows(events, 999);
    expect(windows).toContainEqual({ start: 100, end: 200 });
    expect(windows).toContainEqual({ start: 300, end: 999 });
  });
});

describe("buildSessionDiff — detection (git)", () => {
  const cwd = "/project";
  beforeEach(() => {
    vi.mocked(isGitRepo).mockReset().mockReturnValue(true);
    vi.mocked(git.diffOr).mockReset().mockReturnValue("");
    vi.mocked(git.numstatOr).mockReset().mockReturnValue("");
    vi.mocked(git.statusPorcelainOr).mockReset().mockReturnValue("");
    vi.mocked(existsSync).mockReset().mockReturnValue(true);
    vi.mocked(readFileSync).mockReset().mockImplementation((_p: any, enc: any) =>
      enc === "utf-8" ? "hello\nworld" : Buffer.from("hello\nworld"),
    );
    vi.mocked(statSync).mockReset().mockReturnValue({ size: 10, mtimeMs: 0 } as any);
  });

  it("D1 — tool-created file detected", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? out.docx\n");
    const events = [makeBash("pandoc report.md -o out.docx", 1000)];
    const { files } = buildSessionDiff(events, cwd);
    const entry = files.find((f) => f.path === "out.docx");
    expect(entry).toBeDefined();
    expect(entry!.origin).toBe("tool");
    expect(entry!.detectedVia).toBe("git-status");
  });

  it("D2 — mixed dedup, no ghost event", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M a.ts\n");
    const events = [makeToolStart("Write", { path: "a.ts", content: "x" }, 1000)];
    const { files } = buildSessionDiff(events, cwd);
    const entry = files.filter((f) => f.path === "a.ts");
    expect(entry).toHaveLength(1);
    expect(entry[0].origin).toBe("mixed");
    expect(entry[0].changes).toHaveLength(1);
    expect(entry[0].changes[0].type).toBe("write");
    expect(entry[0].changes.some((c) => c.type === "tool")).toBe(false);
  });

  it("D3 — quoted + rename porcelain keys equal normalizePath keys and dedup", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(`?? "dir with space/f.txt"\nR  old.ts -> new.ts\n`);
    const events = [
      makeToolStart("Write", { path: "dir with space/f.txt", content: "x" }, 1000),
      makeToolStart("Write", { path: "new.ts", content: "y" }, 1001),
    ];
    const { files } = buildSessionDiff(events, cwd);
    expect(files.filter((f) => f.path === "dir with space/f.txt")).toHaveLength(1);
    expect(files.filter((f) => f.path === "new.ts")).toHaveLength(1);
  });

  it("D3a — absolute-under-cwd yields relative key + dedups", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M src/foo.ts\n");
    const events = [makeToolStart("Write", { path: `${cwd}/src/foo.ts`, content: "x" }, 1000)];
    const { files } = buildSessionDiff(events, cwd);
    const matches = files.filter((f) => f.path === "src/foo.ts");
    expect(matches).toHaveLength(1);
    expect(files.every((f) => !f.path.startsWith("/"))).toBe(true);
  });

  it("D3b — sibling-prefix directory not admitted", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? ../project-backup/x.ts\n");
    const { files, otherChanges } = buildSessionDiff([], "/home/user/project");
    const all = [...files, ...otherChanges];
    expect(all.some((f) => f.path.includes("project-backup"))).toBe(false);
  });

  it("D4 — out-of-cwd porcelain entry excluded", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? ../sibling/x\n");
    const { files, otherChanges } = buildSessionDiff([], cwd);
    expect([...files, ...otherChanges].some((f) => f.path.endsWith("x"))).toBe(false);
  });

  it("D5 — gitignored excluded (not reported by porcelain)", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? kept.ts\n");
    const { files, otherChanges } = buildSessionDiff([makeBash("echo x > kept.ts", 1)], cwd);
    const all = [...files, ...otherChanges];
    expect(all.some((f) => f.path === "build/artifact.js")).toBe(false);
  });
});

describe("buildSessionDiff — attribution", () => {
  const cwd = "/project";
  beforeEach(() => {
    vi.mocked(isGitRepo).mockReset().mockReturnValue(true);
    vi.mocked(git.diffOr).mockReset().mockReturnValue("");
    vi.mocked(git.numstatOr).mockReset().mockReturnValue("");
    vi.mocked(git.statusPorcelainOr).mockReset().mockReturnValue("");
    vi.mocked(existsSync).mockReset().mockReturnValue(true);
    vi.mocked(readFileSync).mockReset().mockImplementation((_p: any, enc: any) =>
      enc === "utf-8" ? "x" : Buffer.from("x"),
    );
    vi.mocked(statSync).mockReset().mockReturnValue({ size: 10, mtimeMs: 0 } as any);
  });

  it("A1 — attribution labels a detected file", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? logo.png\n");
    const events = [makeBash('npx nano-banana "logo" --output logo.png', 1000)];
    const { files } = buildSessionDiff(events, cwd);
    const entry = files.find((f) => f.path === "logo.png");
    expect(entry!.producedBy).toContain("nano-banana");
    expect(entry!.detectedVia).toBe("git-status");
  });

  it("A2 — false-positive token adds/re-tags nothing", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("");
    const events = [
      makeBash("grep -o pattern src/index.ts", 1000),
      makeToolStart("Write", { path: "src/index.ts", content: "x" }, 1001),
    ];
    const { files } = buildSessionDiff(events, cwd);
    expect(files.some((f) => f.path === "pattern")).toBe(false);
    const idx = files.find((f) => f.path === "src/index.ts");
    expect(idx!.changes).toHaveLength(1);
    expect(idx!.changes[0].type).toBe("write");
  });

  it("A3 — secret redaction on producedBy", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? dump.json\n");
    const events = [makeBash("curl -u user:s3cr3tTOKEN https://x > dump.json", 1000)];
    const { files } = buildSessionDiff(events, cwd);
    const entry = files.find((f) => f.path === "dump.json");
    expect(entry!.producedBy).toBeDefined();
    expect(entry!.producedBy).not.toContain("s3cr3tTOKEN");
    expect(entry!.producedBy!.length).toBeLessThanOrEqual(120);
  });

  it("A4 — collision resolves by timestamp, no throw", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? same.png\n");
    const events = [
      makeBash("echo one --output same.png", 1),
      makeBash("echo two --output same.png", 2),
    ];
    const { files } = buildSessionDiff(events, cwd);
    const entry = files.find((f) => f.path === "same.png");
    expect(entry!.producedBy).toContain("two");
  });
});

describe("buildSessionDiff — non-git detection", () => {
  const cwd = "/project";
  beforeEach(() => {
    vi.mocked(isGitRepo).mockReset().mockReturnValue(false);
    vi.mocked(existsSync).mockReset();
    vi.mocked(statSync).mockReset().mockReturnValue({ size: 10, mtimeMs: 0 } as any);
  });

  it("N1 — non-git in-cwd tool file listed", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const events = [makeBash("python b.py > notes.md", 1000)];
    const { files, isGitRepo: isRepo } = buildSessionDiff(events, cwd);
    expect(isRepo).toBe(false);
    const entry = files.find((f) => f.path === "notes.md");
    expect(entry).toBeDefined();
    expect(entry!.origin).toBe("tool");
    expect(entry!.detectedVia).toBe("bash-artifact");
  });

  it("N2 — non-git out-of-cwd path not probed", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const events = [makeBash("gen --output /etc/shadow", 1000)];
    const { files } = buildSessionDiff(events, cwd);
    // The out-of-cwd path normalizes to null, so existsSync is never called on it.
    const probed = vi.mocked(existsSync).mock.calls.map((c) => String(c[0]));
    expect(probed.some((p) => p.includes("shadow"))).toBe(false);
    expect(files.some((f) => f.path.includes("shadow"))).toBe(false);
  });
});

describe("buildSessionDiff — binary / size / count safety", () => {
  const cwd = "/project";
  beforeEach(() => {
    vi.mocked(isGitRepo).mockReset().mockReturnValue(true);
    vi.mocked(git.diffOr).mockReset().mockReturnValue("");
    vi.mocked(git.numstatOr).mockReset().mockReturnValue("");
    vi.mocked(git.statusPorcelainOr).mockReset().mockReturnValue("");
    vi.mocked(existsSync).mockReset().mockReturnValue(true);
    vi.mocked(readFileSync).mockReset().mockImplementation((_p: any, enc: any) =>
      enc === "utf-8" ? "hello\nworld" : Buffer.from("hello\nworld"),
    );
    vi.mocked(statSync).mockReset().mockReturnValue({ size: 10, mtimeMs: 0 } as any);
  });

  it("B1 — generated PNG not rendered as text diff", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? logo.png\n");
    const events = [makeBash("gen --output logo.png", 1000)];
    const { files } = buildSessionDiff(events, cwd);
    const entry = files.find((f) => f.path === "logo.png");
    expect(entry!.origin).toBe("tool");
    expect(entry!.gitDiff).toBeUndefined();
    // .png is binary by extension → no utf-8 read of the file.
    const utf8Reads = vi.mocked(readFileSync).mock.calls.filter((c) => c[1] === "utf-8");
    expect(utf8Reads).toHaveLength(0);
  });

  it("B2 — synthetic-diff size cap (256 KB)", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? big.txt\n");
    const events = [makeBash("gen --output big.txt", 1000)];

    vi.mocked(statSync).mockReturnValue({ size: 256 * 1024 - 1, mtimeMs: 0 } as any);
    const under = buildSessionDiff(events, cwd).files.find((f) => f.path === "big.txt");
    expect(under!.gitDiff).toBeDefined();

    vi.mocked(statSync).mockReturnValue({ size: 256 * 1024 + 1, mtimeMs: 0 } as any);
    const over = buildSessionDiff(events, cwd).files.find((f) => f.path === "big.txt");
    expect(over!.gitDiff).toBeUndefined();
  });

  it("B3 — file-count cap (200)", () => {
    const porcelain = Array.from({ length: 200 }, (_, i) => `?? f${i}.txt`).join("\n");
    vi.mocked(git.statusPorcelainOr).mockReturnValue(`${porcelain}\n`);
    // A Bash window covering all files' mtime makes the 200 detector-only owned.
    vi.mocked(statSync).mockReturnValue({ size: 10, mtimeMs: 150 } as any);
    const events = [
      makeToolStart("Write", { path: "main.ts", content: "x" }, 100),
      makeBash("build", 100, "w"),
      makeBashEnd(200, "w"),
    ];
    const { files } = buildSessionDiff(events, cwd);
    expect(files).toHaveLength(200);
    expect(files.some((f) => f.path === "main.ts")).toBe(true);
  });
});

describe("buildSessionDiff — ownership gate", () => {
  const cwd = "/project";
  beforeEach(() => {
    vi.mocked(isGitRepo).mockReset().mockReturnValue(true);
    vi.mocked(git.diffOr).mockReset().mockReturnValue("");
    vi.mocked(git.numstatOr).mockReset().mockReturnValue("");
    vi.mocked(git.statusPorcelainOr).mockReset().mockReturnValue("");
    vi.mocked(existsSync).mockReset().mockReturnValue(true);
    vi.mocked(readFileSync).mockReset().mockImplementation((_p: any, enc: any) =>
      enc === "utf-8" ? "x" : Buffer.from("x"),
    );
  });

  it("O1 — mtime-in-window file is owned", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? out.pdf\n");
    vi.mocked(statSync).mockReset().mockReturnValue({ size: 10, mtimeMs: 150 } as any);
    const events = [makeBash("pandoc convert", 100, "w"), makeBashEnd(200, "w")];
    const { files, otherChanges } = buildSessionDiff(events, cwd);
    const entry = files.find((f) => f.path === "out.pdf");
    expect(entry).toBeDefined();
    expect(entry!.sessionOwned).toBe(true);
    expect(otherChanges.some((f) => f.path === "out.pdf")).toBe(false);
  });

  it("O2 — other-session file diverted (no evidence)", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? stray.ts\n");
    vi.mocked(statSync).mockReset().mockReturnValue({ size: 10, mtimeMs: 5000 } as any);
    const { files, otherChanges } = buildSessionDiff([], cwd);
    expect(files.some((f) => f.path === "stray.ts")).toBe(false);
    expect(otherChanges.some((f) => f.path === "stray.ts")).toBe(true);
  });

  it("O3 — formatter-bump outside any window not claimed", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? fmt.ts\n");
    // mtime is AFTER the window end + slack → not owned.
    vi.mocked(statSync).mockReset().mockReturnValue({ size: 10, mtimeMs: 100000 } as any);
    const events = [makeBash("lint", 100, "w"), makeBashEnd(200, "w")];
    const { files, otherChanges } = buildSessionDiff(events, cwd);
    expect(files.some((f) => f.path === "fmt.ts")).toBe(false);
    expect(otherChanges.some((f) => f.path === "fmt.ts")).toBe(true);
  });
});

describe("buildSessionDiff — degradation", () => {
  const cwd = "/project";
  it("G1 — git absent, still returns Write/Edit entries", () => {
    vi.mocked(isGitRepo).mockReset().mockReturnValue(false);
    const events = [makeToolStart("Write", { path: "src/a.ts", content: "x" }, 1000)];
    const { files, isGitRepo: isRepo, otherChanges } = buildSessionDiff(events, cwd);
    expect(isRepo).toBe(false);
    expect(files.some((f) => f.path === "src/a.ts")).toBe(true);
    expect(otherChanges).toEqual([]);
  });
});

// ── retain-failed-tool-file-changes: failure correlation ────────────────────

/**
 * Live-shape tool end: `result` is the full ToolResult ({content, details}),
 * `details` lifted to top-level by the bridge, plus `isError`.
 */
function makeToolEnd(
  toolName: string,
  toolCallId: string,
  opts: { isError?: boolean; result?: unknown; details?: unknown; timestamp?: number } = {},
): DashboardEvent {
  return makeEvent("tool_execution_end", opts.timestamp ?? 2000, {
    toolName,
    toolCallId,
    isError: opts.isError ?? false,
    ...(opts.result !== undefined ? { result: opts.result } : {}),
    ...(opts.details !== undefined ? { details: opts.details } : {}),
  });
}

function startWithId(toolName: string, args: Record<string, unknown>, id: string, timestamp = 1000): DashboardEvent {
  return makeEvent("tool_execution_start", timestamp, { toolName, toolCallId: id, args });
}

describe("buildSessionDiff — file-operation failures", () => {
  const cwd = "/project";
  beforeEach(() => {
    vi.mocked(isGitRepo).mockReset().mockReturnValue(true);
    vi.mocked(git.diffOr).mockReset().mockReturnValue("");
    vi.mocked(git.numstatOr).mockReset().mockReturnValue("");
    vi.mocked(git.statusPorcelainOr).mockReset().mockReturnValue("");
    vi.mocked(existsSync).mockReset().mockReturnValue(true);
    vi.mocked(readFileSync).mockReset().mockImplementation((_p: any, enc: any) =>
      enc === "utf-8" ? "x" : Buffer.from("x"),
    );
    vi.mocked(statSync).mockReset().mockReturnValue({ size: 10, mtimeMs: 0 } as any);
  });

  it("2.1 failed Write retains its changed file + one error failure", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M src/foo.ts\n");
    const events = [
      startWithId("Write", { path: "src/foo.ts", content: "x" }, "w1", 1000),
      makeToolEnd("Write", "w1", { isError: true, result: "EACCES: permission denied", timestamp: 2000 }),
    ];
    const { files, fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(files.some((f) => f.path === "src/foo.ts")).toBe(true);
    expect(fileOperationFailures).toHaveLength(1);
    expect(fileOperationFailures![0].kind).toBe("error");
    expect(fileOperationFailures![0].toolCallId).toBe("w1");
    expect(fileOperationFailures![0].affectedPaths).toEqual(["src/foo.ts"]);
    expect(fileOperationFailures![0].message).toContain("EACCES");
  });

  it("2.1 StrReplace failure surfaces via direct-file family", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M lib/x.ts\n");
    const events = [
      startWithId("StrReplace", { path: "lib/x.ts", oldText: "a", newText: "b" }, "s1", 1000),
      makeToolEnd("StrReplace", "s1", { isError: true, result: "no match", timestamp: 2000 }),
    ];
    const { files, fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(files.some((f) => f.path === "lib/x.ts")).toBe(true);
    expect(fileOperationFailures).toHaveLength(1);
    expect(fileOperationFailures![0].toolName).toBe("StrReplace");
  });

  it("2.1 unrelated failure is NOT attributed to a changed file", () => {
    // A changed file exists (git-status) but the failed tool touched no path.
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M src/foo.ts\n");
    const events = [
      startWithId("Write", { path: "src/foo.ts", content: "x" }, "w1", 1000),
      // A DIFFERENT failed tool call with no path evidence at all.
      startWithId("Read", { path: "other.ts" }, "r1", 1500),
      makeToolEnd("Read", "r1", { isError: true, result: "boom", timestamp: 1600 }),
    ];
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    // Read is not a mutation tool → no failure entry.
    expect(fileOperationFailures).toBeUndefined();
  });

  it("2.2 Codex apply_patch partial_failure with isError:false → partial_failure", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M a.ts\n?? b.ts\n");
    const events = [
      startWithId("apply_patch", { patch: "..." }, "p1", 1000),
      makeToolEnd("apply_patch", "p1", {
        isError: false,
        result: "applied 2, failed 1",
        details: {
          status: "partial_failure",
          appliedFiles: ["a.ts", "b.ts"],
          failedFiles: ["c.ts"],
          error: "hunk failed for c.ts",
        },
        timestamp: 2000,
      }),
    ];
    const { files, fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(files.some((f) => f.path === "a.ts")).toBe(true);
    expect(files.some((f) => f.path === "b.ts")).toBe(true);
    expect(fileOperationFailures).toHaveLength(1);
    expect(fileOperationFailures![0].kind).toBe("partial_failure");
    expect(fileOperationFailures![0].affectedPaths.sort()).toEqual(["a.ts", "b.ts"]);
    // failed-only target is excluded from affectedPaths
    expect(fileOperationFailures![0].affectedPaths).not.toContain("c.ts");
  });

  it("2.2 isError:true wins over partial_failure → kind error", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M a.ts\n");
    const events = [
      startWithId("apply_patch", { patch: "..." }, "p1", 1000),
      makeToolEnd("apply_patch", "p1", {
        isError: true,
        result: "fatal",
        details: { status: "partial_failure", appliedFiles: ["a.ts"] },
        timestamp: 2000,
      }),
    ];
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(fileOperationFailures![0].kind).toBe("error");
  });

  it("2.2 unknown structured status is not a failure without isError", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M a.ts\n");
    const events = [
      startWithId("apply_patch", { patch: "..." }, "p1", 1000),
      makeToolEnd("apply_patch", "p1", {
        isError: false,
        result: "ok",
        details: { status: "some_other_status", appliedFiles: ["a.ts"] },
        timestamp: 2000,
      }),
    ];
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(fileOperationFailures).toBeUndefined();
  });

  it("2.2 failed-only patch target does not create a file row", () => {
    // No git-status change; apply_patch only reports a FAILED target.
    vi.mocked(git.statusPorcelainOr).mockReturnValue("");
    const events = [
      startWithId("apply_patch", { patch: "..." }, "p1", 1000),
      makeToolEnd("apply_patch", "p1", {
        isError: true,
        result: "all hunks failed",
        details: { status: "partial_failure", appliedFiles: [], failedFiles: ["c.ts"] },
        timestamp: 2000,
      }),
    ];
    const { files, fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(files.some((f) => f.path === "c.ts")).toBe(false);
    expect(fileOperationFailures).toBeUndefined();
  });

  it("2.2 duplicate end events dedupe deterministically (latest wins)", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M a.ts\n");
    const events = [
      startWithId("Write", { path: "a.ts", content: "x" }, "w1", 1000),
      makeToolEnd("Write", "w1", { isError: true, result: "first", timestamp: 2000 }),
      makeToolEnd("Write", "w1", { isError: true, result: "second", timestamp: 2500 }),
    ];
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(fileOperationFailures).toHaveLength(1);
    expect(fileOperationFailures![0].message).toContain("second");
    expect(fileOperationFailures![0].timestamp).toBe(2500);
  });

  it("4.2 emits the same failure payload for equivalent live and replay streams", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M a.ts\n");
    const details = { status: "partial_failure", appliedFiles: ["a.ts"], error: "one hunk failed" };
    const start = startWithId("apply_patch", { patch: "..." }, "p1", 1000);
    const live = makeToolEnd("apply_patch", "p1", {
      isError: false,
      result: { content: [{ type: "text", text: "one hunk failed" }], details },
      timestamp: 2000,
    });
    const replay = makeToolEnd("apply_patch", "p1", {
      isError: false,
      result: "one hunk failed",
      details,
      timestamp: 2000,
    });

    expect(buildSessionDiff([start, live], cwd).fileOperationFailures).toEqual(
      buildSessionDiff([start, replay], cwd).fileOperationFailures,
    );
  });

  it("2.3 failed Shell attributes output-token path", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? out.txt\n");
    const events = [
      startWithId("Shell", { command: "echo hi > out.txt && false" }, "sh1", 1000),
      makeToolEnd("Shell", "sh1", { isError: true, result: "exit 1", timestamp: 2000 }),
    ];
    const { files, fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(files.some((f) => f.path === "out.txt")).toBe(true);
    expect(fileOperationFailures).toHaveLength(1);
    expect(fileOperationFailures![0].affectedPaths).toContain("out.txt");
  });

  it("2.3 exec_command alias works like shell", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? gen.json\n");
    const events = [
      startWithId("exec_command", { command: "tool -o gen.json" }, "e1", 1000),
      makeToolEnd("exec_command", "e1", { isError: true, result: "boom", timestamp: 2000 }),
    ];
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(fileOperationFailures![0].affectedPaths).toContain("gen.json");
  });

  it("2.3 mtime-only proximity CANNOT attach a failure", () => {
    // File is owned via mtime-in-window, but the failed shell command has no
    // output token naming it → no exact candidate path → no failure.
    vi.mocked(git.statusPorcelainOr).mockReturnValue("?? touched.ts\n");
    vi.mocked(statSync).mockReset().mockReturnValue({ size: 10, mtimeMs: 150 } as any);
    const events = [
      startWithId("Shell", { command: "make build" }, "sh1", 100),
      makeToolEnd("Shell", "sh1", { isError: true, result: "build failed", timestamp: 200 }),
    ];
    const { files, fileOperationFailures } = buildSessionDiff(events, cwd);
    // The file may be session-owned via mtime, but no failure is attributed.
    expect(files.some((f) => f.path === "touched.ts")).toBe(true);
    expect(fileOperationFailures).toBeUndefined();
  });

  it("2.4 non-git apply_patch applied path is discovered + failure surfaces", () => {
    vi.mocked(isGitRepo).mockReset().mockReturnValue(false);
    vi.mocked(existsSync).mockReset().mockReturnValue(true);
    const events = [
      startWithId("apply_patch", { patch: "..." }, "p1", 1000),
      makeToolEnd("apply_patch", "p1", {
        isError: false,
        result: "partial",
        details: { status: "partial_failure", appliedFiles: ["src/x.ts"] },
        timestamp: 2000,
      }),
    ];
    const { files, fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(files.some((f) => f.path === "src/x.ts")).toBe(true);
    expect(fileOperationFailures).toHaveLength(1);
    expect(fileOperationFailures![0].affectedPaths).toContain("src/x.ts");
  });

  it("2.4 non-git StrReplace direct path is retained with its failure", () => {
    vi.mocked(isGitRepo).mockReset().mockReturnValue(false);
    const events = [
      startWithId("StrReplace", { path: "src/x.ts", oldText: "a", newText: "b" }, "s1", 1000),
      makeToolEnd("StrReplace", "s1", { isError: true, result: "no match", timestamp: 2000 }),
    ];
    const { files, fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(files.some((f) => f.path === "src/x.ts")).toBe(true);
    expect(fileOperationFailures![0].affectedPaths).toEqual(["src/x.ts"]);
  });

  it("2.4 cwd-escape candidate is excluded from the failure payload", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M safe.ts\n");
    const events = [
      startWithId("Write", { path: "../outside.ts", content: "x" }, "w1", 1000),
      makeToolEnd("Write", "w1", { isError: true, result: "failed", timestamp: 2000 }),
    ];
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(fileOperationFailures).toBeUndefined();
  });

  it("2.4 orphan end (no matching start) is not fabricated", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M a.ts\n");
    const events = [makeToolEnd("Write", "orphan", { isError: true, result: "x", timestamp: 2000 })];
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(fileOperationFailures).toBeUndefined();
  });

  it("2.4 missing toolCallId on end is skipped", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M a.ts\n");
    const events = [
      startWithId("Write", { path: "a.ts", content: "x" }, "w1", 1000),
      makeEvent("tool_execution_end", 2000, { toolName: "Write", isError: true, result: "x" }),
    ];
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(fileOperationFailures).toBeUndefined();
  });

  it("2.4 start with no end is not a proven failure", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M a.ts\n");
    const events = [startWithId("Write", { path: "a.ts", content: "x" }, "w1", 1000)];
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(fileOperationFailures).toBeUndefined();
  });

  it("2.4 empty message falls back to `<toolName> failed`", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M a.ts\n");
    const events = [
      startWithId("Write", { path: "a.ts", content: "x" }, "w1", 1000),
      makeToolEnd("Write", "w1", { isError: true, result: "", timestamp: 2000 }),
    ];
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(fileOperationFailures![0].message).toBe("Write failed");
  });

  it("2.4 blank tool name falls back to generic label", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M a.ts\n");
    const events = [
      startWithId("Write", { path: "a.ts", content: "x" }, "w1", 1000),
      makeEvent("tool_execution_end", 2000, { toolName: "", toolCallId: "w1", isError: true, result: "" }),
    ];
    // toolName "" is not a mutation tool at start; use Write start, blank end name.
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    // start carries "Write" so message uses that; assert non-empty.
    expect(fileOperationFailures![0].message.length).toBeGreaterThan(0);
  });

  it("2.4 oversized + control-sequence output is bounded and sanitized", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M a.ts\n");
    const big = `\u001b[31m${"E".repeat(5000)}\u001b[0m`;
    const events = [
      startWithId("Write", { path: "a.ts", content: "x" }, "w1", 1000),
      makeToolEnd("Write", "w1", { isError: true, result: big, timestamp: 2000 }),
    ];
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    const msg = fileOperationFailures![0].message;
    expect(msg.length).toBeLessThanOrEqual(500);
    expect(msg).not.toContain("\u001b");
  });

  it("2.4 cwd/home prefixes collapse in the message", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M a.ts\n");
    const events = [
      startWithId("Write", { path: "a.ts", content: "x" }, "w1", 1000),
      makeToolEnd("Write", "w1", { isError: true, result: "failed at /project/a.ts", timestamp: 2000 }),
    ];
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(fileOperationFailures![0].message).toContain("./a.ts");
    expect(fileOperationFailures![0].message).not.toContain("/project/a.ts");
  });

  it("2.4 Windows USERPROFILE prefix also collapses in the message", () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    delete process.env.HOME;
    process.env.USERPROFILE = "C:\\Users\\pi";
    try {
      vi.mocked(git.statusPorcelainOr).mockReturnValue(" M a.ts\n");
      const events = [
        startWithId("Write", { path: "a.ts", content: "x" }, "w1", 1000),
        makeToolEnd("Write", "w1", {
          isError: true,
          result: "failed at C:\\Users\\pi\\a.ts",
          timestamp: 2000,
        }),
      ];
      expect(buildSessionDiff(events, cwd).fileOperationFailures![0].message).toContain("~\\a.ts");
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
    }
  });

  it("2.4 one file touched by multiple failed calls → one entry per call", () => {
    vi.mocked(git.statusPorcelainOr).mockReturnValue(" M shared.ts\n");
    const events = [
      startWithId("Write", { path: "shared.ts", content: "x" }, "w1", 1000),
      makeToolEnd("Write", "w1", { isError: true, result: "e1", timestamp: 2000 }),
      startWithId("Edit", { path: "shared.ts" }, "w2", 3000),
      makeToolEnd("Edit", "w2", { isError: true, result: "e2", timestamp: 4000 }),
    ];
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(fileOperationFailures).toHaveLength(2);
    expect(fileOperationFailures!.every((f) => f.affectedPaths.includes("shared.ts"))).toBe(true);
    // newest end first
    expect(fileOperationFailures![0].toolCallId).toBe("w2");
  });

  it("2.4 caps failures at MAX_FAILURES and paths at MAX_AFFECTED_PATHS", () => {
    const porcelainLines: string[] = [];
    const events: DashboardEvent[] = [];
    for (let i = 0; i < 120; i++) {
      porcelainLines.push(` M f${i}.ts`);
      events.push(startWithId("Write", { path: `f${i}.ts`, content: "x" }, `w${i}`, 1000 + i));
      events.push(makeToolEnd("Write", `w${i}`, { isError: true, result: "e", timestamp: 5000 + i }));
    }
    vi.mocked(git.statusPorcelainOr).mockReturnValue(`${porcelainLines.join("\n")}\n`);
    const { fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(fileOperationFailures!.length).toBeLessThanOrEqual(100);
  });

  it("2.4 caps affected paths after final changed-file intersection", () => {
    const appliedFiles = Array.from({ length: 60 }, (_unused, i) => `f${i}.ts`);
    vi.mocked(git.statusPorcelainOr).mockReturnValue(appliedFiles.map((path) => ` M ${path}`).join("\n"));
    const events = [
      startWithId("apply_patch", { patch: "..." }, "p1", 1000),
      makeToolEnd("apply_patch", "p1", {
        isError: false,
        result: "partial",
        details: { status: "partial_failure", appliedFiles },
        timestamp: 2000,
      }),
    ];
    expect(buildSessionDiff(events, cwd).fileOperationFailures![0].affectedPaths).toHaveLength(50);
  });

  it("2.4 drops a failure whose only path was evicted by MAX_FILES", () => {
    const paths = Array.from({ length: 201 }, (_unused, i) => `f${String(i).padStart(3, "0")}.ts`);
    vi.mocked(git.statusPorcelainOr).mockReturnValue(paths.map((path) => ` M ${path}`).join("\n"));
    const events = paths.map((path, i) => startWithId("Write", { path, content: "x" }, `w${i}`, 1000 + i));
    events.push(makeToolEnd("Write", "w200", { isError: true, result: "late failure", timestamp: 3000 }));

    const { files, fileOperationFailures } = buildSessionDiff(events, cwd);
    expect(files).toHaveLength(200);
    expect(files.some((f) => f.path === "f200.ts")).toBe(false);
    expect(fileOperationFailures).toBeUndefined();
  });
});
