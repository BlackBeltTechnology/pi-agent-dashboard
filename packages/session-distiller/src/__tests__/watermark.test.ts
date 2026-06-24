import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readWatermark,
  writeWatermark,
  listNewerSessions,
  timestampFromName,
  sessionDirName,
  cwdHash,
} from "../watermark.js";

let root: string;
let sessions: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "distill-wm-"));
  sessions = mkdtempSync(join(tmpdir(), "distill-sess-"));
});

describe("watermark store (task 2.3)", () => {
  it("returns an empty watermark before any run", () => {
    expect(readWatermark("/repo", root).lastTimestamp).toBe("");
  });

  it("round-trips a written watermark", () => {
    writeWatermark("/repo", "2026-06-20T10:00:00.000Z", root);
    expect(readWatermark("/repo", root).lastTimestamp).toBe("2026-06-20T10:00:00.000Z");
  });

  it("isolates watermarks per cwd hash", () => {
    expect(cwdHash("/a")).not.toBe(cwdHash("/b"));
  });

  it("encodes a cwd to its session dir name", () => {
    expect(sessionDirName("/Users/x/proj")).toBe("--Users-x-proj--");
  });

  it("parses the timestamp from a session filename", () => {
    expect(timestampFromName("2026-06-23T22-25-00-849Z_uuid.jsonl")).toBe(
      "2026-06-23T22:25:00.849Z",
    );
  });

  it("lists only sessions newer than the watermark", () => {
    const mk = (name: string) => writeFileSync(join(sessions, name), "{}\n");
    mk("2026-06-20T10-00-00-000Z_a.jsonl");
    mk("2026-06-21T10-00-00-000Z_b.jsonl");
    mk("2026-06-22T10-00-00-000Z_c.jsonl");
    const newer = listNewerSessions("/repo", "2026-06-20T10:00:00.000Z", sessions);
    expect(newer.map((r) => r.path.endsWith("_b.jsonl") || r.path.endsWith("_c.jsonl"))).toEqual([
      true,
      true,
    ]);
  });

  it("re-run over unchanged corpus is a no-op", () => {
    writeFileSync(join(sessions, "2026-06-21T10-00-00-000Z_b.jsonl"), "{}\n");
    const first = listNewerSessions("/repo", "", sessions);
    expect(first.length).toBe(1);
    const watermark = first[first.length - 1].timestamp;
    const second = listNewerSessions("/repo", watermark, sessions);
    expect(second.length).toBe(0);
  });
});
