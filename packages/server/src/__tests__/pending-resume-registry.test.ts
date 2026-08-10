import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPendingResumeRegistry } from "../pending/pending-resume-registry.js";

describe("PendingResumeRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records and consumes a pending resume", () => {
    const reg = createPendingResumeRegistry();
    reg.record("/project", {
      text: "fix the bug",
      oldSessionId: "old-1",
      sessionFile: "session.jsonl",
    });
    const result = reg.consume("/project");
    expect(result).toEqual({
      text: "fix the bug",
      oldSessionId: "old-1",
      sessionFile: "session.jsonl",
    });
  });

  it("returns undefined when no pending resume", () => {
    const reg = createPendingResumeRegistry();
    expect(reg.consume("/project")).toBeUndefined();
  });

  it("consume clears the entry", () => {
    const reg = createPendingResumeRegistry();
    reg.record("/project", {
      text: "fix it",
      oldSessionId: "old-1",
      sessionFile: "session.jsonl",
    });
    reg.consume("/project");
    expect(reg.consume("/project")).toBeUndefined();
  });

  it("expires after 30 seconds", () => {
    const onTimeout = vi.fn();
    const reg = createPendingResumeRegistry({ onTimeout });
    reg.record("/project", {
      text: "fix it",
      oldSessionId: "old-1",
      sessionFile: "session.jsonl",
    });
    vi.advanceTimersByTime(30_001);
    expect(reg.consume("/project")).toBeUndefined();
    expect(onTimeout).toHaveBeenCalledWith("old-1");
  });

  it("does not expire before 30 seconds", () => {
    const reg = createPendingResumeRegistry();
    reg.record("/project", {
      text: "fix it",
      oldSessionId: "old-1",
      sessionFile: "session.jsonl",
    });
    vi.advanceTimersByTime(29_999);
    expect(reg.consume("/project")).toBeDefined();
  });

  it("latest entry overwrites previous for same cwd", () => {
    const reg = createPendingResumeRegistry();
    reg.record("/project", {
      text: "first prompt",
      oldSessionId: "old-1",
      sessionFile: "session.jsonl",
    });
    reg.record("/project", {
      text: "second prompt",
      oldSessionId: "old-2",
      sessionFile: "session2.jsonl",
    });
    const result = reg.consume("/project");
    expect(result?.text).toBe("second prompt");
    expect(result?.oldSessionId).toBe("old-2");
  });

  it("different cwds are independent", () => {
    const reg = createPendingResumeRegistry();
    reg.record("/a", { text: "prompt-a", oldSessionId: "old-a", sessionFile: "a.jsonl" });
    reg.record("/b", { text: "prompt-b", oldSessionId: "old-b", sessionFile: "b.jsonl" });
    expect(reg.consume("/a")?.text).toBe("prompt-a");
    expect(reg.consume("/b")?.text).toBe("prompt-b");
  });

  it("preserves images in pending resume", () => {
    const reg = createPendingResumeRegistry();
    const images = [{ type: "image" as const, data: "base64data", mimeType: "image/png" }];
    reg.record("/project", {
      text: "look at this",
      images,
      oldSessionId: "old-1",
      sessionFile: "session.jsonl",
    });
    const result = reg.consume("/project");
    expect(result?.images).toEqual(images);
  });

  it("dispose clears all entries and timers", () => {
    const onTimeout = vi.fn();
    const reg = createPendingResumeRegistry({ onTimeout });
    reg.record("/a", { text: "a", oldSessionId: "old-a", sessionFile: "a.jsonl" });
    reg.record("/b", { text: "b", oldSessionId: "old-b", sessionFile: "b.jsonl" });
    reg.dispose();
    expect(reg.consume("/a")).toBeUndefined();
    expect(reg.consume("/b")).toBeUndefined();
    // Timers should not fire after dispose
    vi.advanceTimersByTime(31_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("overwrite clears previous timer", () => {
    const onTimeout = vi.fn();
    const reg = createPendingResumeRegistry({ onTimeout });
    reg.record("/project", { text: "first", oldSessionId: "old-1", sessionFile: "s.jsonl" });
    vi.advanceTimersByTime(20_000);
    reg.record("/project", { text: "second", oldSessionId: "old-2", sessionFile: "s.jsonl" });
    vi.advanceTimersByTime(15_000); // 35s from first, 15s from second
    // First timer would have fired at 30s, but was cleared by overwrite
    expect(onTimeout).not.toHaveBeenCalled();
    expect(reg.consume("/project")?.text).toBe("second");
  });
});
