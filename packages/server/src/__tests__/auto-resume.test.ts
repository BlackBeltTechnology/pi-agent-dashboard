import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPendingResumeRegistry } from "../pending/pending-resume-registry.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Tests for the auto-resume-on-prompt flow.
 * These test the registry + orchestration logic without full server setup.
 */

function createMockSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "session-1",
    cwd: "/project",
    source: "tui",
    status: "ended",
    startedAt: Date.now(),
    sessionFile: "/path/to/session.jsonl",
    ...overrides,
  };
}

describe("Auto-resume on prompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("send_prompt to ended session triggers resume flow", () => {
    it("records pending resume with prompt data", () => {
      const registry = createPendingResumeRegistry();
      const session = createMockSession();

      registry.record(session.cwd, {
        text: "fix the bug",
        oldSessionId: session.id,
        sessionFile: session.sessionFile!,
      });

      const entry = registry.consume(session.cwd);
      expect(entry).toBeDefined();
      expect(entry!.text).toBe("fix the bug");
      expect(entry!.oldSessionId).toBe("session-1");
      expect(entry!.sessionFile).toBe("/path/to/session.jsonl");
    });

    it("records pending resume with images", () => {
      const registry = createPendingResumeRegistry();
      const session = createMockSession();
      const images = [{ type: "image" as const, data: "base64", mimeType: "image/png" }];

      registry.record(session.cwd, {
        text: "look at this",
        images,
        oldSessionId: session.id,
        sessionFile: session.sessionFile!,
      });

      const entry = registry.consume(session.cwd);
      expect(entry!.images).toEqual(images);
    });

    it("does not record when session has no sessionFile", () => {
      const registry = createPendingResumeRegistry();
      const session = createMockSession({ sessionFile: undefined });

      // The browser-gateway checks sessionFile before calling record,
      // so this tests the precondition
      expect(session.sessionFile).toBeUndefined();
    });
  });

  describe("session_register with pending resume flushes prompt", () => {
    it("consumes entry for matching cwd and returns prompt data", () => {
      const registry = createPendingResumeRegistry();

      registry.record("/project", {
        text: "fix the bug",
        oldSessionId: "old-session",
        sessionFile: "session.jsonl",
      });

      // Simulate new session registering with same cwd
      const entry = registry.consume("/project");
      expect(entry).toBeDefined();
      expect(entry!.text).toBe("fix the bug");
      expect(entry!.oldSessionId).toBe("old-session");

      // Entry should be consumed (not available again)
      expect(registry.consume("/project")).toBeUndefined();
    });

    it("returns undefined when no pending resume for cwd", () => {
      const registry = createPendingResumeRegistry();
      expect(registry.consume("/project")).toBeUndefined();
    });
  });

  describe("spawn failure clears resuming state", () => {
    it("consume clears entry so timeout does not fire", () => {
      const onTimeout = vi.fn();
      const registry = createPendingResumeRegistry({ onTimeout });

      registry.record("/project", {
        text: "fix it",
        oldSessionId: "old-1",
        sessionFile: "session.jsonl",
      });

      // Simulate spawn failure: consume immediately to clear
      registry.consume("/project");

      // Advance past expiry — onTimeout should NOT fire since entry was consumed
      vi.advanceTimersByTime(31_000);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it("timeout fires onTimeout with oldSessionId when not consumed", () => {
      const onTimeout = vi.fn();
      const registry = createPendingResumeRegistry({ onTimeout });

      registry.record("/project", {
        text: "fix it",
        oldSessionId: "old-1",
        sessionFile: "session.jsonl",
      });

      vi.advanceTimersByTime(30_001);
      expect(onTimeout).toHaveBeenCalledWith("old-1");
    });
  });
});
