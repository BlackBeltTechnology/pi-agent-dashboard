import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBranchedSessionFile, findSessionToolCallPayload } from "../session/session-file-reader.js";

describe("createBranchedSessionFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "session-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSession(entries: any[]): string {
    const path = join(tmpDir, "test-session.jsonl");
    writeFileSync(path, entries.map(e => JSON.stringify(e)).join("\n") + "\n");
    return path;
  }

  it("should create a branched session file with root-to-target path", () => {
    const sessionFile = writeSession([
      { type: "session", id: "sess-1", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
      { type: "message", id: "e1", parentId: null, message: { role: "user", content: "Hello" } },
      { type: "message", id: "e2", parentId: "e1", message: { role: "assistant", content: "Hi" } },
      { type: "message", id: "e3", parentId: "e2", message: { role: "user", content: "More" } },
      { type: "message", id: "e4", parentId: "e3", message: { role: "assistant", content: "Done" } },
    ]);

    const newPath = createBranchedSessionFile(sessionFile, "e2");
    const lines = readFileSync(newPath, "utf-8").trim().split("\n").map(l => JSON.parse(l));

    // Header + 2 entries (e1, e2)
    expect(lines).toHaveLength(3);
    expect(lines[0].type).toBe("session");
    expect(lines[0].parentSession).toBe(sessionFile);
    expect(lines[1].id).toBe("e1");
    expect(lines[1].parentId).toBeNull();
    expect(lines[2].id).toBe("e2");
    expect(lines[2].parentId).toBe("e1");
  });

  it("should throw for non-existent entry ID", () => {
    const sessionFile = writeSession([
      { type: "session", id: "sess-1", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
      { type: "message", id: "e1", parentId: null, message: { role: "user", content: "Hello" } },
    ]);

    expect(() => createBranchedSessionFile(sessionFile, "nonexistent")).toThrow("Entry ID not found");
  });

  it("should throw for non-existent session file", () => {
    expect(() => createBranchedSessionFile("/no/such/file.jsonl", "e1")).toThrow("Session file not found");
  });

  it("should handle single-entry branch (root entry)", () => {
    const sessionFile = writeSession([
      { type: "session", id: "sess-1", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
      { type: "message", id: "e1", parentId: null, message: { role: "user", content: "Hello" } },
    ]);

    const newPath = createBranchedSessionFile(sessionFile, "e1");
    const lines = readFileSync(newPath, "utf-8").trim().split("\n").map(l => JSON.parse(l));

    expect(lines).toHaveLength(2); // header + 1 entry
    expect(lines[1].id).toBe("e1");
    expect(lines[1].parentId).toBeNull();
  });

  it("should generate a new session ID for the branched file", () => {
    const sessionFile = writeSession([
      { type: "session", id: "original-id", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
      { type: "message", id: "e1", parentId: null, message: { role: "user", content: "Hello" } },
    ]);

    const newPath = createBranchedSessionFile(sessionFile, "e1");
    const header = JSON.parse(readFileSync(newPath, "utf-8").split("\n")[0]);

    expect(header.id).not.toBe("original-id");
    expect(header.id).toMatch(/^[0-9a-f-]+$/); // UUID format
  });
});

// opt-in-out-of-cwd-session-diffs: full untruncated payload from the on-disk JSONL.
describe("findSessionToolCallPayload", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "session-payload-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
  function writeSession(entries: any[]): string {
    const path = join(tmpDir, "s.jsonl");
    writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    return path;
  }

  it("E4 — returns untruncated Write content (7 KB, no truncation marker)", () => {
    const bigContent = "x".repeat(7 * 1024);
    const file = writeSession([
      { type: "session", id: "s1", cwd: "/tmp" },
      {
        type: "message", id: "e1", parentId: null,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "writing" },
            { type: "toolCall", id: "tc-write", name: "write", arguments: { path: "/tmp/big.txt", content: bigContent } },
          ],
        },
      },
    ]);
    const payload = findSessionToolCallPayload(file, "tc-write");
    expect(payload).not.toBeNull();
    expect(payload!.content).toBe(bigContent);
    expect(payload!.content).not.toContain("[truncated]");
    expect(payload!.content!.length).toBe(7 * 1024);
  });

  it("E5 — returns the full 21-element edits array", () => {
    const edits = Array.from({ length: 21 }, (_, i) => ({ oldText: `a${i}`, newText: `b${i}` }));
    const file = writeSession([
      { type: "session", id: "s1", cwd: "/tmp" },
      {
        type: "message", id: "e1", parentId: null,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tc-edit", name: "edit", arguments: { path: "src/a.ts", edits } }],
        },
      },
    ]);
    const payload = findSessionToolCallPayload(file, "tc-edit");
    expect(payload!.edits).toHaveLength(21);
    expect(payload!.edits).toEqual(edits);
  });

  it("E6 — unknown toolCallId yields null (not-found)", () => {
    const file = writeSession([
      { type: "session", id: "s1", cwd: "/tmp" },
      {
        type: "message", id: "e1", parentId: null,
        message: { role: "assistant", content: [{ type: "toolCall", id: "tc-real", name: "write", arguments: { path: "a", content: "x" } }] },
      },
    ]);
    expect(findSessionToolCallPayload(file, "tc-missing")).toBeNull();
  });

  it("X3 — missing JSONL file yields null (graceful, no throw)", () => {
    expect(findSessionToolCallPayload(join(tmpDir, "gone.jsonl"), "tc-x")).toBeNull();
  });

  it("reads the nested content[].id, not the entry top-level id", () => {
    // Decoy: the entry's TOP-LEVEL id differs from the nested tool-call id.
    const file = writeSession([
      { type: "session", id: "s1", cwd: "/tmp" },
      {
        type: "message", id: "entry-top-level-id", parentId: null,
        message: { role: "assistant", content: [{ type: "toolCall", id: "tc-nested", name: "write", arguments: { path: "a", content: "correct" } }] },
      },
    ]);
    // Matching the NESTED tool-call id resolves the payload.
    expect(findSessionToolCallPayload(file, "tc-nested")!.content).toBe("correct");
    // Matching the entry TOP-LEVEL id must NOT resolve (never keyed on it).
    expect(findSessionToolCallPayload(file, "entry-top-level-id")).toBeNull();
  });
});
