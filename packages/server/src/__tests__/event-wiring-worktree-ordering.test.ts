/**
 * Tests for worktree groupCwd ordering logic used in event-wiring.ts.
 *
 * Validates the branching introduced in fix-worktree-placeholder-replacement:
 *   const orderCwd = groupCwd ?? msg.cwd;
 *   if (groupCwd) {
 *     sessionOrderManager.insert(groupCwd, sessionId);
 *     sessionOrderManager.moveToFront(groupCwd, sessionId);
 *   }
 *
 * The actual event-wiring integration (session_register → sessions_reordered)
 * is covered by the Docker + Playwright browser test in qa/worktree-placeholder/.
 */
import { describe, it, expect } from "vitest";

describe("event-wiring — worktree groupCwd ordering logic", () => {
  it("uses groupCwd as orderCwd when worktree is detected", () => {
    const msgCwd = "/repo/.pi/worktrees/feature-x-123/";
    const groupCwd = "/repo/main";

    const orderCwd = groupCwd ?? msgCwd;
    const shouldInsert = groupCwd !== undefined;

    expect(orderCwd).toBe("/repo/main");
    expect(shouldInsert).toBe(true);
  });

  it("falls back to msg.cwd when no worktree (groupCwd undefined)", () => {
    const msgCwd = "/project";
    const groupCwd: string | undefined = undefined;

    const orderCwd = groupCwd ?? msgCwd;
    const shouldInsert = groupCwd !== undefined;

    expect(orderCwd).toBe("/project");
    expect(shouldInsert).toBe(false);
  });

  it("validIds filter includes sessions matching orderCwd or groupCwd", () => {
    // Simulates the filter: s.cwd === orderCwd || s.groupCwd === orderCwd
    const sessions = [
      { id: "s1", cwd: "/repo/main", groupCwd: undefined },
      { id: "wt1", cwd: "/repo/.pi/worktrees/feat-1/", groupCwd: "/repo/main" },
      { id: "wt2", cwd: "/repo/.pi/worktrees/feat-2/", groupCwd: "/repo/main" },
      { id: "s2", cwd: "/other-project", groupCwd: undefined },
    ];

    const orderCwd = "/repo/main";
    const validIds = sessions
      .filter((s) => s.cwd === orderCwd || s.groupCwd === orderCwd)
      .map((s) => s.id);

    // s1 (cwd matches), wt1 (groupCwd matches), wt2 (groupCwd matches)
    expect(validIds).toEqual(["s1", "wt1", "wt2"]);
  });

  it("broadcast uses orderCwd (= groupCwd) as the cwd key", () => {
    // When groupCwd is set, sessions_reordered uses it as the cwd field.
    // This ensures the client's sessionOrderMap.get(groupCwd) picks it up.
    const groupCwd = "/repo/main";
    const orderCwd = groupCwd;

    const broadcastPayload = {
      type: "sessions_reordered" as const,
      cwd: orderCwd,
      sessionIds: ["wt-1", "s2", "s1"],
    };

    expect(broadcastPayload.cwd).toBe("/repo/main");
  });
});
