import { describe, it, expect } from "vitest";
import { getSessionDisplayName } from "../lib/session/session-display-name.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "test-session-id-1234",
    cwd: "/home/user/my-project",
    source: "tui",
    status: "active",
    startedAt: Date.now(),
    ...overrides,
  };
}

describe("getSessionDisplayName", () => {
  it("should use name when set", () => {
    const session = makeSession({ name: "Fix auth bug" });
    expect(getSessionDisplayName(session)).toBe("Fix auth bug");
  });

  it("should trim whitespace from name", () => {
    const session = makeSession({ name: "  My Session  " });
    expect(getSessionDisplayName(session)).toBe("My Session");
  });

  it("should use firstMessage when name is not set", () => {
    const session = makeSession({ firstMessage: "Help me fix the authentication module" });
    expect(getSessionDisplayName(session)).toBe("Help me fix the authentication module");
  });

  it("should truncate firstMessage to 50 chars with ellipsis", () => {
    const longMessage = "Help me refactor the authentication module to use JWT tokens instead of session cookies";
    const session = makeSession({ firstMessage: longMessage });
    const result = getSessionDisplayName(session);
    expect(result.length).toBe(53); // 50 chars + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  it("should not truncate firstMessage at exactly 50 chars", () => {
    const exactMessage = "a".repeat(50);
    const session = makeSession({ firstMessage: exactMessage });
    expect(getSessionDisplayName(session)).toBe(exactMessage);
  });

  it("should prefer name over firstMessage", () => {
    const session = makeSession({ name: "My Name", firstMessage: "First msg" });
    expect(getSessionDisplayName(session)).toBe("My Name");
  });

  it("should fall back to cwd last segment when neither name nor firstMessage", () => {
    const session = makeSession({});
    expect(getSessionDisplayName(session)).toBe("my-project");
  });

  it("should fall back to ID prefix when cwd has no segments", () => {
    const session = makeSession({ cwd: "/" });
    // "/" split by "/" gives ["", ""], pop() gives ""
    expect(getSessionDisplayName(session)).toBe("test-ses");
  });

  it("should ignore empty/whitespace-only name", () => {
    const session = makeSession({ name: "   ", firstMessage: "First msg" });
    expect(getSessionDisplayName(session)).toBe("First msg");
  });

  it("should ignore empty/whitespace-only firstMessage", () => {
    const session = makeSession({ name: undefined, firstMessage: "   " });
    expect(getSessionDisplayName(session)).toBe("my-project");
  });
});
