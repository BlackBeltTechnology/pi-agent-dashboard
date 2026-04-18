/**
 * Tests for openspec-poller.ts — the higher-level aggregator that combines
 * `openspec list` + per-change `openspec status` into the dashboard's
 * `OpenSpecData` shape.
 *
 * The file now delegates to `platform/openspec.ts` for the subprocess work.
 * We mock that module so the tests focus on the aggregation logic
 * (empty results, artifact mapping, per-change status failures) without
 * spawning openspec.
 *
 * See change: platform-command-executor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { listOr, statusOr } = vi.hoisted(() => ({
  listOr: vi.fn(),
  statusOr: vi.fn(),
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/openspec.js", () => ({
  listOr,
  statusOr,
}));

import { pollOpenSpec } from "@blackbelt-technology/pi-dashboard-shared/openspec-poller.js";

describe("pollOpenSpec", () => {
  beforeEach(() => {
    listOr.mockReset();
    statusOr.mockReset();
  });

  it("returns initialized=false when list fails", () => {
    listOr.mockReturnValue(null);
    expect(pollOpenSpec("/test")).toEqual({ initialized: false, changes: [] });
  });

  it("returns initialized=false when list returns non-array changes", () => {
    listOr.mockReturnValue({ changes: "not an array" });
    expect(pollOpenSpec("/test")).toEqual({ initialized: false, changes: [] });
  });

  it("returns initialized=true with changes on success", () => {
    listOr.mockReturnValue({
      changes: [
        { name: "add-auth", status: "in-progress", completedTasks: 3, totalTasks: 10 },
      ],
    });
    statusOr.mockReturnValue({
      artifacts: [
        { id: "proposal", status: "done" },
        { id: "tasks", status: "ready" },
      ],
    });

    const result = pollOpenSpec("/test");
    expect(result.initialized).toBe(true);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      name: "add-auth",
      status: "in-progress",
      completedTasks: 3,
      totalTasks: 10,
    });
    expect(result.changes[0].artifacts).toEqual([
      { id: "proposal", status: "done" },
      { id: "tasks", status: "ready" },
    ]);
  });

  it("handles status call failure gracefully (empty artifacts)", () => {
    listOr.mockReturnValue({
      changes: [
        { name: "x", status: "complete", completedTasks: 5, totalTasks: 5 },
      ],
    });
    statusOr.mockReturnValue(null); // status failed

    const result = pollOpenSpec("/test");
    expect(result.initialized).toBe(true);
    expect(result.changes[0].artifacts).toEqual([]);
  });

  it("normalizes unknown status values to 'no-tasks'", () => {
    listOr.mockReturnValue({
      changes: [
        { name: "x", status: "weird-future-status", completedTasks: 0, totalTasks: 0 },
      ],
    });
    statusOr.mockReturnValue(null);

    const result = pollOpenSpec("/test");
    expect(result.changes[0].status).toBe("no-tasks");
  });

  it("normalizes unknown artifact statuses to 'blocked'", () => {
    listOr.mockReturnValue({
      changes: [
        { name: "x", status: "in-progress", completedTasks: 0, totalTasks: 1 },
      ],
    });
    statusOr.mockReturnValue({
      artifacts: [{ id: "proposal", status: "some-new-state" }],
    });

    const result = pollOpenSpec("/test");
    expect(result.changes[0].artifacts[0].status).toBe("blocked");
  });

  it("calls statusOr once per change, with the change name", () => {
    listOr.mockReturnValue({
      changes: [
        { name: "a", status: "in-progress", completedTasks: 0, totalTasks: 1 },
        { name: "b", status: "complete", completedTasks: 2, totalTasks: 2 },
      ],
    });
    statusOr.mockReturnValue({ artifacts: [] });

    pollOpenSpec("/test");
    expect(statusOr).toHaveBeenCalledTimes(2);
    expect(statusOr).toHaveBeenNthCalledWith(1, { cwd: "/test", change: "a" });
    expect(statusOr).toHaveBeenNthCalledWith(2, { cwd: "/test", change: "b" });
  });
});
