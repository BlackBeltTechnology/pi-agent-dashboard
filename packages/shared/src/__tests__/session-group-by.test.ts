import { describe, expect, it } from "vitest";
import {
  isGroupByMode,
  isLaneId,
  laneCollapseKey,
  parseLaneCollapseKey,
  STATUS_LANE_ORDER,
} from "../session-group-by.js";

describe("session-group-by guards", () => {
  it("accepts the three modes and rejects anything else", () => {
    for (const m of ["none", "status", "location"]) expect(isGroupByMode(m)).toBe(true);
    for (const m of ["", "None", "change", null, undefined, 1, {}]) expect(isGroupByMode(m)).toBe(false);
  });

  it("accepts every lane id and rejects unknown ones", () => {
    for (const l of ["needs-you", "error", "working", "review", "idle", "main", "worktrees"]) {
      expect(isLaneId(l)).toBe(true);
    }
    for (const l of ["ended", "Working", "", null, 3]) expect(isLaneId(l)).toBe(false);
  });

  it("orders status lanes needs-you, error, working, review, idle", () => {
    expect(STATUS_LANE_ORDER).toEqual(["needs-you", "error", "working", "review", "idle"]);
  });

  it("round-trips lane collapse keys, incl. windows drive colons", () => {
    expect(laneCollapseKey("/repo", "idle")).toBe("/repo::idle");
    expect(parseLaneCollapseKey("/repo::idle")).toEqual({ folderKey: "/repo", lane: "idle" });
    expect(parseLaneCollapseKey("c:\\repo::working")).toEqual({ folderKey: "c:\\repo", lane: "working" });
    expect(parseLaneCollapseKey("/repo::bogus")).toBeNull();
    expect(parseLaneCollapseKey("::idle")).toBeNull();
    expect(parseLaneCollapseKey("/repo")).toBeNull();
  });
});
