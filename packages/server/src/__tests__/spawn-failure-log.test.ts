/**
 * Tests for spawn-failure-log.ts.
 * See change: spawn-failure-diagnostics.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { appendSpawnFailure, readSpawnFailures, _setLogDirForTests } from "../spawn-process/spawn-failure-log.js";
import type { SpawnFailureEntry } from "../spawn-process/spawn-failure-log.js";

function makeEntry(overrides: Partial<SpawnFailureEntry> = {}): SpawnFailureEntry {
  return {
    ts: new Date().toISOString(),
    cwd: "/tmp/test",
    strategy: "headless",
    code: "PI_CRASHED",
    message: "Pi exited immediately",
    ...overrides,
  };
}

describe("spawn-failure-log", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "sfl-test-"));
    _setLogDirForTests(tmpDir);
  });

  afterEach(() => {
    _setLogDirForTests(null);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends an entry and reads it back", () => {
    const entry = makeEntry();
    appendSpawnFailure(entry);
    const entries = readSpawnFailures(10);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.cwd).toBe(entry.cwd);
    expect(entries[0]!.code).toBe(entry.code);
  });

  it("returns [] when no log file exists", () => {
    expect(readSpawnFailures(10)).toEqual([]);
  });

  it("returns [] for limit 0", () => {
    appendSpawnFailure(makeEntry());
    expect(readSpawnFailures(0)).toEqual([]);
  });

  it("returns [] for negative limit", () => {
    appendSpawnFailure(makeEntry());
    expect(readSpawnFailures(-5)).toEqual([]);
  });

  it("returns last N entries when more than limit exist", () => {
    for (let i = 0; i < 5; i++) {
      appendSpawnFailure(makeEntry({ message: `msg ${i}` }));
    }
    const result = readSpawnFailures(3);
    expect(result).toHaveLength(3);
    expect(result[2]!.message).toBe("msg 4");
  });

  it("skips malformed lines", () => {
    const logFile = path.join(tmpDir, "spawn-failures.log");
    writeFileSync(logFile, `not-json\n${JSON.stringify(makeEntry({ message: "good" }))}\n`);
    const entries = readSpawnFailures(10);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.message).toBe("good");
  });

  it("never throws when append fails", () => {
    const logFile = path.join(tmpDir, "spawn-failures.log");
    // Create as dir to force write failure.
    mkdirSync(logFile);
    expect(() => appendSpawnFailure(makeEntry())).not.toThrow();
  });

  it("rotates when file exceeds 10 MB", () => {
    const logFile = path.join(tmpDir, "spawn-failures.log");
    const logFile1 = path.join(tmpDir, "spawn-failures.log.1");

    // Write a file >10MB.
    const bigContent = "x".repeat(10 * 1024 * 1024 + 1);
    writeFileSync(logFile, bigContent);

    appendSpawnFailure(makeEntry({ message: "after rotation" }));

    expect(existsSync(logFile1)).toBe(true);
    const entries = readSpawnFailures(10);
    expect(entries.some((e) => e.message === "after rotation")).toBe(true);
    expect(statSync(logFile).size).toBeLessThan(bigContent.length);
  });

  it("reads from both .log.1 and .log (older first)", () => {
    const logFile = path.join(tmpDir, "spawn-failures.log");
    const logFile1 = path.join(tmpDir, "spawn-failures.log.1");

    writeFileSync(logFile1, JSON.stringify(makeEntry({ message: "old" })) + "\n");
    writeFileSync(logFile, JSON.stringify(makeEntry({ message: "new" })) + "\n");

    const entries = readSpawnFailures(10);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.message).toBe("old");
    expect(entries[1]!.message).toBe("new");
  });

  it("clamps limit at 500", () => {
    for (let i = 0; i < 10; i++) appendSpawnFailure(makeEntry());
    const entries = readSpawnFailures(9999);
    expect(entries.length).toBeLessThanOrEqual(500);
  });
});
