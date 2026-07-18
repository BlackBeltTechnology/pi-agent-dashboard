/**
 * Tests for cross-OS path-drift handling in session grouping.
 *
 * See change: platform-path-normalization.
 */
import { describe, it, expect } from "vitest";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { groupSessionsByDirectory, inferPlatform } from "../lib/session/session-grouping.js";

function mk(id: string, cwd: string, startedAt = 1): DashboardSession {
  return {
    id, cwd,
    source: "tui",
    status: "active",
    startedAt,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
  } as DashboardSession;
}

// ── inferPlatform ───────────────────────────────────────────────────────────

describe("inferPlatform", () => {
  it("detects Windows from drive-letter prefix", () => {
    expect(inferPlatform(["B:\\Dev\\BB"])).toBe("win32");
    expect(inferPlatform(["C:/Users/me"])).toBe("win32");
  });

  it("detects Windows from backslash anywhere", () => {
    expect(inferPlatform(["Dev\\BB"])).toBe("win32");
  });

  it("detects POSIX from leading /", () => {
    expect(inferPlatform(["/Users/me"])).toBe("linux");
    expect(inferPlatform(["/home/user/Projects"])).toBe("linux");
  });

  it("falls back to linux when no samples match", () => {
    expect(inferPlatform([])).toBe("linux");
    expect(inferPlatform([undefined])).toBe("linux");
    expect(inferPlatform(["relative"])).toBe("linux");
  });

  it("honors explicit override", () => {
    expect(inferPlatform(["/Users/me"], "win32")).toBe("win32");
    expect(inferPlatform(["B:\\Dev"], "linux")).toBe("linux");
  });
});

// ── groupSessionsByDirectory — cross-OS drift ───────────────────────────────

describe("groupSessionsByDirectory — Windows drift tolerance", () => {
  it("groups session under pinned dir when trailing separator differs", () => {
    const sessions = [mk("s1", "B:\\Dev\\BB\\pi-agent-dashboard")];
    const pinned = ["B:\\Dev\\BB\\pi-agent-dashboard\\"]; // trailing sep
    const { pinned: pg, unpinned: ug } = groupSessionsByDirectory(
      sessions, undefined, pinned, "win32",
    );
    expect(pg).toHaveLength(1);
    expect(pg[0].sessions).toHaveLength(1);
    expect(ug).toHaveLength(0);
  });

  it("groups session under pinned dir when drive-letter case differs", () => {
    const sessions = [mk("s1", "b:\\Dev\\BB\\pi-agent-dashboard")];
    const pinned = ["B:\\Dev\\BB\\pi-agent-dashboard"];
    const { pinned: pg, unpinned: ug } = groupSessionsByDirectory(
      sessions, undefined, pinned, "win32",
    );
    expect(pg).toHaveLength(1);
    expect(pg[0].sessions).toHaveLength(1);
    expect(ug).toHaveLength(0);
  });

  it("groups session under pinned dir when separator style differs", () => {
    const sessions = [mk("s1", "B:/Dev/BB/pi-agent-dashboard")];
    const pinned = ["B:\\Dev\\BB\\pi-agent-dashboard"];
    const { pinned: pg, unpinned: ug } = groupSessionsByDirectory(
      sessions, undefined, pinned, "win32",
    );
    expect(pg).toHaveLength(1);
    expect(pg[0].sessions).toHaveLength(1);
    expect(ug).toHaveLength(0);
  });

  it("does NOT merge sessions across different Windows drives", () => {
    const sessions = [
      mk("s1", "B:\\Dev\\BB", 1),
      mk("s2", "A:\\Dev\\BB", 2),
    ];
    const pinned = ["B:\\Dev\\BB"];
    const { pinned: pg, unpinned: ug } = groupSessionsByDirectory(
      sessions, undefined, pinned, "win32",
    );
    expect(pg).toHaveLength(1);
    expect(pg[0].sessions).toHaveLength(1);
    expect(pg[0].sessions[0].id).toBe("s1");
    expect(ug).toHaveLength(1);
    expect(ug[0].sessions[0].id).toBe("s2");
  });

  it("uses the PINNED path (not the session cwd) for the display header", () => {
    const sessions = [mk("s1", "b:/Dev/BB/pi-agent-dashboard/")]; // drift
    const pinned = ["B:\\Dev\\BB\\pi-agent-dashboard"];
    const { pinned: pg } = groupSessionsByDirectory(
      sessions, undefined, pinned, "win32",
    );
    expect(pg[0].cwd).toBe("B:\\Dev\\BB\\pi-agent-dashboard");
  });
});

describe("groupSessionsByDirectory — macOS case-insensitive", () => {
  it("groups session under pinned dir when case differs", () => {
    const sessions = [mk("s1", "/Users/me/dev/project")];
    const pinned = ["/Users/me/Dev/Project"];
    const { pinned: pg } = groupSessionsByDirectory(
      sessions, undefined, pinned, "darwin",
    );
    expect(pg[0].sessions).toHaveLength(1);
  });
});

describe("groupSessionsByDirectory — Linux case-sensitive", () => {
  it("keeps sessions separate on case drift", () => {
    const sessions = [mk("s1", "/home/user/Project")];
    const pinned = ["/home/user/project"];
    const { pinned: pg, unpinned: ug } = groupSessionsByDirectory(
      sessions, undefined, pinned, "linux",
    );
    expect(pg[0].sessions).toHaveLength(0); // pinned has no sessions under linux casing
    expect(ug).toHaveLength(1); // session lives in its own unpinned group
  });
});
