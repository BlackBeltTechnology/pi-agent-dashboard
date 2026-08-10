import { describe, it, expect } from "vitest";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { selectBadgeTimestamp } from "../session/session-card-time.js";

/**
 * Render-precedence helper for the session-card relative-time badge.
 * See change: session-card-last-activity-badge.
 */
function makeSession(overrides: Partial<DashboardSession>): DashboardSession {
  return {
    id: "s1",
    cwd: "/tmp",
    source: "tui",
    status: "active",
    startedAt: 1_000,
    ...overrides,
  } as DashboardSession;
}

describe("selectBadgeTimestamp", () => {
  describe("active sessions", () => {
    it("returns lastActivityAt when set", () => {
      const s = makeSession({ status: "active", startedAt: 1_000, lastActivityAt: 5_000 });
      expect(selectBadgeTimestamp(s)).toBe(5_000);
    });

    it("falls back to startedAt when lastActivityAt is missing", () => {
      const s = makeSession({ status: "active", startedAt: 1_000 });
      expect(selectBadgeTimestamp(s)).toBe(1_000);
    });

    it("returns lastActivityAt for idle status as well", () => {
      const s = makeSession({ status: "idle", startedAt: 1_000, lastActivityAt: 7_000 });
      expect(selectBadgeTimestamp(s)).toBe(7_000);
    });

    it("returns lastActivityAt for streaming status as well", () => {
      const s = makeSession({ status: "streaming", startedAt: 1_000, lastActivityAt: 9_000 });
      expect(selectBadgeTimestamp(s)).toBe(9_000);
    });
  });

  describe("ended sessions", () => {
    it("returns endedAt when set, ignoring lastActivityAt", () => {
      const s = makeSession({
        status: "ended",
        startedAt: 1_000,
        lastActivityAt: 5_000,
        endedAt: 8_000,
      });
      expect(selectBadgeTimestamp(s)).toBe(8_000);
    });

    it("falls back to lastActivityAt when endedAt is missing", () => {
      const s = makeSession({
        status: "ended",
        startedAt: 1_000,
        lastActivityAt: 6_000,
      });
      expect(selectBadgeTimestamp(s)).toBe(6_000);
    });

    it("falls back to startedAt when both endedAt and lastActivityAt are missing", () => {
      const s = makeSession({ status: "ended", startedAt: 1_000 });
      expect(selectBadgeTimestamp(s)).toBe(1_000);
    });
  });
});
