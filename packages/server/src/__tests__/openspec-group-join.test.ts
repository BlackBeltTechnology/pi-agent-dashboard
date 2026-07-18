/**
 * Tests for the pure `joinGroupIdsToOpenSpecData` helper that injects
 * `groupId` into every `OpenSpecChange` from a per-cwd assignments map.
 *
 * See change: add-openspec-change-grouping (tasks 4.1–4.2).
 */
import { describe, it, expect } from "vitest";
import { joinGroupIdsToOpenSpecData } from "../openspec/openspec-group-store.js";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function mkData(changes: Array<{ name: string }>): OpenSpecData {
  return {
    initialized: true,
    changes: changes.map((c) => ({
      name: c.name,
      status: "in-progress" as const,
      completedTasks: 0,
      totalTasks: 0,
      artifacts: [],
    })),
  };
}

describe("joinGroupIdsToOpenSpecData", () => {
  it("populates groupId from the assignments map", () => {
    const data = mkData([{ name: "add-foo" }, { name: "fix-bar" }]);
    const enriched = joinGroupIdsToOpenSpecData(data, { "add-foo": "ui" });
    expect(enriched.changes[0]?.groupId).toBe("ui");
    expect(enriched.changes[1]?.groupId).toBe(null);
  });

  it("emits null groupId when no assignment exists", () => {
    const data = mkData([{ name: "add-foo" }]);
    const enriched = joinGroupIdsToOpenSpecData(data, {});
    expect(enriched.changes[0]?.groupId).toBe(null);
  });

  it("ignores assignments for changes that aren't in the live data set", () => {
    const data = mkData([{ name: "add-foo" }]);
    const enriched = joinGroupIdsToOpenSpecData(data, {
      "add-foo": "ui",
      "never-existed": "server",
    });
    expect(enriched.changes).toHaveLength(1);
    expect(enriched.changes[0]?.groupId).toBe("ui");
  });

  it("preserves all other OpenSpecData fields verbatim", () => {
    const data: OpenSpecData = {
      initialized: true,
      pending: false,
      changes: [
        {
          name: "add-foo",
          status: "complete",
          completedTasks: 7,
          totalTasks: 7,
          artifacts: [{ id: "proposal", status: "done" }],
          isComplete: true,
        },
      ],
    };
    const enriched = joinGroupIdsToOpenSpecData(data, { "add-foo": "ui" });
    expect(enriched.initialized).toBe(true);
    expect(enriched.pending).toBe(false);
    const change = enriched.changes[0];
    expect(change?.completedTasks).toBe(7);
    expect(change?.totalTasks).toBe(7);
    expect(change?.artifacts).toEqual([{ id: "proposal", status: "done" }]);
    expect(change?.isComplete).toBe(true);
    expect(change?.groupId).toBe("ui");
  });

  it("does not mutate the original data object", () => {
    const data = mkData([{ name: "add-foo" }]);
    const original = JSON.parse(JSON.stringify(data));
    joinGroupIdsToOpenSpecData(data, { "add-foo": "ui" });
    expect(data).toEqual(original);
  });
});
