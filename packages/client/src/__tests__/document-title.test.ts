import { describe, it, expect } from "vitest";
import { buildDocumentTitle } from "../lib/nav/document-title.js";
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

describe("buildDocumentTitle", () => {
  it("should return fallback when no session", () => {
    expect(buildDocumentTitle(undefined)).toBe("PI Dashboard");
  });

  it("should show directory for unnamed session", () => {
    const session = makeSession({});
    expect(buildDocumentTitle(session)).toBe("my-project — PI Dashboard");
  });

  it("should show named session with directory in parens", () => {
    const session = makeSession({ name: "Fix auth bug" });
    expect(buildDocumentTitle(session)).toBe("Fix auth bug (my-project) — PI Dashboard");
  });

  it("should dedup when session name equals directory name", () => {
    const session = makeSession({ name: "my-project" });
    expect(buildDocumentTitle(session)).toBe("my-project — PI Dashboard");
  });

  it("should dedup case-insensitively", () => {
    const session = makeSession({ name: "My-Project", cwd: "/home/user/my-project" });
    expect(buildDocumentTitle(session)).toBe("My-Project — PI Dashboard");
  });

  it("should fall back to id prefix when cwd has no segments", () => {
    const session = makeSession({ cwd: "/" });
    expect(buildDocumentTitle(session)).toBe("test-ses — PI Dashboard");
  });

  it("should show directory name for folder cwd when no session", () => {
    expect(buildDocumentTitle(undefined, "/home/user/my-project")).toBe("my-project — PI Dashboard");
  });

  it("should fallback when neither session nor folderCwd is provided", () => {
    expect(buildDocumentTitle(undefined, "")).toBe("PI Dashboard");
  });
});
