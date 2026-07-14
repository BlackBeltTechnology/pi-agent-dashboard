/**
 * Tests for the commit-draft relay: request/resolve correlation + timeout stub.
 * See change: add-session-uncommitted-indicator-and-commit.
 */
import { describe, it, expect, vi } from "vitest";
import { createCommitDraftRelay } from "../commit-draft-relay.js";
import type { GitCommitDraftResultMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

describe("commit-draft relay", () => {
  it("resolves when the bridge replies with the matching requestId", async () => {
    const relay = createCommitDraftRelay();
    let sentRequestId = "";
    const p = relay.request({
      sessionId: "s1",
      cwd: "/repo",
      files: ["a.ts"],
      send: (msg) => { sentRequestId = msg.requestId; return true; },
    });
    expect(relay.size()).toBe(1);
    relay.resolve({
      type: "git_commit_draft_result",
      sessionId: "s1",
      requestId: sentRequestId,
      message: "feat: x",
      source: "fork-subagent",
    } as GitCommitDraftResultMessage);
    await expect(p).resolves.toEqual({ message: "feat: x", source: "fork-subagent" });
    expect(relay.size()).toBe(0);
  });

  it("returns a stub immediately when the bridge is not connected", async () => {
    const relay = createCommitDraftRelay();
    const res = await relay.request({
      sessionId: "s1", cwd: "/repo", files: ["a.ts", "b.ts"], send: () => false,
    });
    expect(res.source).toBe("stub");
    expect(res.message).toContain("2 files");
  });

  it("returns a stub on timeout", async () => {
    vi.useFakeTimers();
    try {
      const relay = createCommitDraftRelay();
      const p = relay.request({
        sessionId: "s1", cwd: "/repo", files: ["a.ts"], send: () => true, timeoutMs: 100,
      });
      await vi.advanceTimersByTimeAsync(150);
      await expect(p).resolves.toEqual({ message: "chore: update a.ts", source: "stub" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores an unknown requestId", () => {
    const relay = createCommitDraftRelay();
    expect(() => relay.resolve({
      type: "git_commit_draft_result", sessionId: "s1", requestId: "nope",
      message: "x", source: "stub",
    } as GitCommitDraftResultMessage)).not.toThrow();
  });
});
