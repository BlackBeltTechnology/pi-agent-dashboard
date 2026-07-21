import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMetaPersistence } from "../persistence/meta-persistence.js";
import { metaPath, readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";

describe("meta-persistence", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-persist-test-"));
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function sessionFile(name: string): string {
    return path.join(tmpDir, `${name}.jsonl`);
  }

  it("should debounce writes (not write immediately)", () => {
    const mp = createMetaPersistence();
    const sf = sessionFile("a");
    mp.save(sf, { source: "dashboard", cost: 1.0 });
    // Not written yet
    expect(fs.existsSync(metaPath(sf))).toBe(false);
    mp.dispose();
  });

  it("should write after debounce period", () => {
    const mp = createMetaPersistence();
    const sf = sessionFile("a");
    mp.save(sf, { source: "dashboard", cost: 1.0 });
    vi.advanceTimersByTime(1000);
    const meta = readSessionMeta(sf);
    expect(meta?.cost).toBe(1.0);
    mp.dispose();
  });

  it("should reset debounce on subsequent saves", () => {
    const mp = createMetaPersistence();
    const sf = sessionFile("a");
    mp.save(sf, { source: "dashboard", cost: 1.0 });
    vi.advanceTimersByTime(500);
    // Update before debounce fires
    mp.save(sf, { source: "dashboard", cost: 2.0 });
    vi.advanceTimersByTime(500);
    // First timer would have fired, but it was reset
    expect(fs.existsSync(metaPath(sf))).toBe(false);
    vi.advanceTimersByTime(500);
    // Now the second timer fires
    const meta = readSessionMeta(sf);
    expect(meta?.cost).toBe(2.0);
    mp.dispose();
  });

  it("should write sessions independently", () => {
    const mp = createMetaPersistence();
    const sfA = sessionFile("a");
    const sfB = sessionFile("b");
    mp.save(sfA, { source: "dashboard", name: "A" });
    vi.advanceTimersByTime(500);
    mp.save(sfB, { source: "dashboard", name: "B" });
    vi.advanceTimersByTime(500);
    // A's timer fired, B's hasn't
    expect(readSessionMeta(sfA)?.name).toBe("A");
    expect(fs.existsSync(metaPath(sfB))).toBe(false);
    vi.advanceTimersByTime(500);
    expect(readSessionMeta(sfB)?.name).toBe("B");
    mp.dispose();
  });

  it("should flush all pending writes immediately", () => {
    const mp = createMetaPersistence();
    const sfA = sessionFile("a");
    const sfB = sessionFile("b");
    mp.save(sfA, { source: "dashboard", name: "A" });
    mp.save(sfB, { source: "dashboard", name: "B" });
    mp.flushAll();
    expect(readSessionMeta(sfA)?.name).toBe("A");
    expect(readSessionMeta(sfB)?.name).toBe("B");
    mp.dispose();
  });

  it("should use atomic writes (no leftover .tmp files)", () => {
    const mp = createMetaPersistence();
    const sf = sessionFile("a");
    mp.save(sf, { source: "dashboard" });
    mp.flushAll();
    expect(fs.existsSync(metaPath(sf) + ".tmp")).toBe(false);
    expect(fs.existsSync(metaPath(sf))).toBe(true);
    mp.dispose();
  });

  it("setDisplayPrefsOverride round-trips: set then null clears the field", () => {
    const mp = createMetaPersistence();
    const sf = sessionFile("prefs");
    // Seed an existing meta so we can verify other fields survive.
    mp.save(sf, { source: "dashboard", name: "keepme" });
    mp.flushAll();

    mp.setDisplayPrefsOverride(sf, { reasoning: false, toolCalls: { bash: false } });
    const after = readSessionMeta(sf);
    expect(after?.displayPrefsOverride?.reasoning).toBe(false);
    expect(after?.displayPrefsOverride?.toolCalls?.bash).toBe(false);
    expect(after?.name).toBe("keepme");

    mp.setDisplayPrefsOverride(sf, null);
    const cleared = readSessionMeta(sf);
    expect(cleared?.displayPrefsOverride).toBeUndefined();
    expect(cleared?.name).toBe("keepme");
    mp.dispose();
  });

  it("setProcessDrawerCollapsed round-trips and preserves sibling fields", () => {
    const mp = createMetaPersistence();
    const sf = sessionFile("drawer");
    mp.save(sf, { source: "dashboard", name: "keepme" });
    mp.flushAll();

    mp.setProcessDrawerCollapsed(sf, false);
    const expanded = readSessionMeta(sf);
    expect(expanded?.processDrawerCollapsed).toBe(false);
    expect(expanded?.name).toBe("keepme");

    mp.setProcessDrawerCollapsed(sf, true);
    const collapsed = readSessionMeta(sf);
    expect(collapsed?.processDrawerCollapsed).toBe(true);
    expect(collapsed?.name).toBe("keepme");
    mp.dispose();
  });

  it("persists gitWorktree parentage (mainPath + name) round-trip", () => {
    const mp = createMetaPersistence();
    const sf = sessionFile("wt");
    mp.save(sf, { source: "dashboard", gitWorktree: { mainPath: "/repo", name: "feat-x" } });
    mp.flushAll();
    const meta = readSessionMeta(sf);
    expect(meta?.gitWorktree?.mainPath).toBe("/repo");
    expect(meta?.gitWorktree?.name).toBe("feat-x");
    mp.dispose();
  });

  it("omits parentage fields for a plain checkout (undefined stripped)", () => {
    const mp = createMetaPersistence();
    const sf = sessionFile("plain");
    mp.save(sf, { source: "dashboard", gitWorktree: undefined });
    mp.flushAll();
    const raw = readSessionMeta(sf) as Record<string, unknown>;
    expect("gitWorktree" in raw).toBe(false);
    mp.dispose();
  });

  it("setLiveness writes immediately without waiting for the debounce window", () => {
    const mp = createMetaPersistence();
    const sf = sessionFile("live");
    mp.setLiveness(sf, { live: true, liveEpoch: 42 });
    // No timer advance — must already be on disk.
    const meta = readSessionMeta(sf);
    expect(meta?.live).toBe(true);
    expect(meta?.liveEpoch).toBe(42);
    expect(fs.existsSync(metaPath(sf) + ".tmp")).toBe(false);
    mp.dispose();
  });

  it("setLiveness folds in a pending debounced field (no lost stats)", () => {
    const mp = createMetaPersistence();
    const sf = sessionFile("live2");
    mp.save(sf, { source: "dashboard", cost: 9 });
    // Pending (not yet flushed) — eager liveness write must preserve it.
    mp.setLiveness(sf, { live: true, liveEpoch: 7 });
    const meta = readSessionMeta(sf);
    expect(meta?.cost).toBe(9);
    expect(meta?.live).toBe(true);
    mp.dispose();
  });

  it("setLiveness clears live + stamps closedReason on manual close", () => {
    const mp = createMetaPersistence();
    const sf = sessionFile("live3");
    mp.setLiveness(sf, { live: true, liveEpoch: 1 });
    mp.setLiveness(sf, { live: false, closedReason: "manual" });
    const meta = readSessionMeta(sf);
    expect(meta?.live).toBe(false);
    expect(meta?.closedReason).toBe("manual");
    mp.dispose();
  });

  it("setLiveness clears a stale closedReason when omitted on re-activation", () => {
    // Regression (CodeRabbit PR #210): a resumed-then-crashed session must not
    // keep an earlier `closedReason:"manual"`, or cold start wrongly excludes it.
    const mp = createMetaPersistence();
    const sf = sessionFile("reactivate");
    mp.setLiveness(sf, { live: false, closedReason: "manual" });
    expect(readSessionMeta(sf)?.closedReason).toBe("manual");
    // Re-activate without a closedReason — the stale reason must be dropped.
    mp.setLiveness(sf, { live: true, liveEpoch: 99 });
    const meta = readSessionMeta(sf);
    expect(meta?.live).toBe(true);
    expect(meta?.liveEpoch).toBe(99);
    expect(meta?.closedReason).toBeUndefined();
    mp.dispose();
  });

  it("setLiveness clears a stale liveEpoch when omitted", () => {
    const mp = createMetaPersistence();
    const sf = sessionFile("epoch-clear");
    mp.setLiveness(sf, { live: true, liveEpoch: 12 });
    mp.setLiveness(sf, { live: false });
    const meta = readSessionMeta(sf);
    expect(meta?.live).toBe(false);
    expect(meta?.liveEpoch).toBeUndefined();
    mp.dispose();
  });

  it("mid-write crash leaves the prior sidecar intact (atomic tmp+rename)", () => {
    const mp = createMetaPersistence();
    const sf = sessionFile("live4");
    mp.setLiveness(sf, { live: true, liveEpoch: 5 });
    const before = fs.readFileSync(metaPath(sf), "utf-8");
    // Simulate a crash during the next write: rename throws after the temp
    // file is created. The original sidecar must survive untouched.
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("simulated crash");
    });
    expect(() => mp.setLiveness(sf, { live: false })).toThrow("simulated crash");
    renameSpy.mockRestore();
    expect(fs.readFileSync(metaPath(sf), "utf-8")).toBe(before);
    mp.dispose();
  });

  it("should dispose without writing", () => {
    const mp = createMetaPersistence();
    const sf = sessionFile("a");
    mp.save(sf, { source: "dashboard" });
    mp.dispose();
    vi.advanceTimersByTime(2000);
    expect(fs.existsSync(metaPath(sf))).toBe(false);
  });
});
