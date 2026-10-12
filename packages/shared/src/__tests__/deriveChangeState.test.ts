import { describe, it, expect } from "vitest";
import { ChangeState, deriveChangeState, type OpenSpecChange } from "../types.js";

function makeChange(overrides: Partial<OpenSpecChange> = {}): OpenSpecChange {
  return {
    name: "test-change",
    status: "no-tasks",
    completedTasks: 0,
    totalTasks: 0,
    artifacts: [],
    ...overrides,
  };
}

// ChangeState is an erasable `as const` object + same-named type (not an enum),
// with the same string values. See change: strip-only-native-ts-loader (#E12).
describe("ChangeState values", () => {
  it("has the 4 string values in order", () => {
    expect(Object.values(ChangeState)).toEqual(["PLANNING", "READY", "IMPLEMENTING", "COMPLETE"]);
    expect(Object.keys(ChangeState)).toEqual(["PLANNING", "READY", "IMPLEMENTING", "COMPLETE"]);
  });

  it("each member equals its own name", () => {
    expect(ChangeState.READY).toBe("READY");
    expect(ChangeState.PLANNING).toBe("PLANNING");
    expect(ChangeState.IMPLEMENTING).toBe("IMPLEMENTING");
    expect(ChangeState.COMPLETE).toBe("COMPLETE");
  });
});

describe("deriveChangeState", () => {
  it("returns PLANNING when no artifacts", () => {
    expect(deriveChangeState(makeChange())).toBe(ChangeState.PLANNING);
  });

  it("returns PLANNING when some artifacts not done", () => {
    expect(
      deriveChangeState(
        makeChange({
          artifacts: [
            { id: "proposal", status: "done" },
            { id: "design", status: "ready" },
          ],
        }),
      ),
    ).toBe(ChangeState.PLANNING);
  });

  it("returns PLANNING when artifacts have blocked status", () => {
    expect(
      deriveChangeState(
        makeChange({
          artifacts: [
            { id: "proposal", status: "done" },
            { id: "tasks", status: "blocked" },
          ],
        }),
      ),
    ).toBe(ChangeState.PLANNING);
  });

  it("treats skipped artifacts as done when deriving state", () => {
    expect(
      deriveChangeState(
        makeChange({
          status: "no-tasks",
          artifacts: [
            { id: "proposal", status: "done" },
            { id: "specs", status: "skipped" },
            { id: "design", status: "done" },
            { id: "tasks", status: "done" },
          ],
        }),
      ),
    ).toBe(ChangeState.READY);
  });

  it("returns READY when all artifacts done and status is no-tasks", () => {
    expect(
      deriveChangeState(
        makeChange({
          status: "no-tasks",
          artifacts: [
            { id: "proposal", status: "done" },
            { id: "design", status: "done" },
          ],
        }),
      ),
    ).toBe(ChangeState.READY);
  });

  it("returns IMPLEMENTING when all artifacts done and status is in-progress", () => {
    expect(
      deriveChangeState(
        makeChange({
          status: "in-progress",
          completedTasks: 2,
          totalTasks: 5,
          artifacts: [
            { id: "proposal", status: "done" },
            { id: "design", status: "done" },
            { id: "specs", status: "done" },
            { id: "tasks", status: "done" },
          ],
        }),
      ),
    ).toBe(ChangeState.IMPLEMENTING);
  });

  it("returns COMPLETE when all artifacts done and status is complete", () => {
    expect(
      deriveChangeState(
        makeChange({
          status: "complete",
          completedTasks: 5,
          totalTasks: 5,
          artifacts: [
            { id: "proposal", status: "done" },
            { id: "design", status: "done" },
            { id: "specs", status: "done" },
            { id: "tasks", status: "done" },
          ],
        }),
      ),
    ).toBe(ChangeState.COMPLETE);
  });
});
