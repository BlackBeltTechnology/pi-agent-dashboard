import { describe, it, expect } from "vitest";
import { getSessionDisplayName } from "../session/session-display-name.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "test-id",
    cwd: "/home/user/my-project",
    source: "tui",
    status: "active",
    startedAt: Date.now(),
    ...overrides,
  };
}

describe("getSessionDisplayName", () => {
  it("returns name when set", () => {
    expect(getSessionDisplayName(makeSession({ name: "My Session" }))).toBe("My Session");
  });

  it("returns cwd last segment when name is undefined", () => {
    expect(getSessionDisplayName(makeSession({ name: undefined }))).toBe("my-project");
  });

  it("returns cwd last segment when name is empty string", () => {
    expect(getSessionDisplayName(makeSession({ name: "" }))).toBe("my-project");
  });

  it("returns cwd last segment when name is whitespace only", () => {
    expect(getSessionDisplayName(makeSession({ name: "   " }))).toBe("my-project");
  });

  it("trims name whitespace", () => {
    expect(getSessionDisplayName(makeSession({ name: "  Hello  " }))).toBe("Hello");
  });

  it("falls back to session id when cwd has no slash", () => {
    expect(getSessionDisplayName(makeSession({ cwd: "" }))).toBe("test-id".slice(0, 8));
  });
});
