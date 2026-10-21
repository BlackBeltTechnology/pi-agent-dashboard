/**
 * Pure helpers of the board's dependency UI: execution order (#F2), its drop
 * rule (#F3), visibility (#F1) and the declare hint predicate (#F6).
 * See change: add-openspec-change-dependencies.
 */
import type { ChangeDependencies, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  executionOrderDrop,
  hasDependencyGraph,
  orderByWave,
  showDeclareHint,
  showDependencyUi,
  sourceOrderAfterMove,
} from "../openspec/openspec-dependencies-view.js";

const deps = (over: Partial<ChangeDependencies> = {}): ChangeDependencies => ({
  hasFile: false,
  blockedBy: [],
  blocks: [],
  related: [],
  overlaps: [],
  wave: 1,
  issues: [],
  ...over,
});
const change = (name: string, dependencies?: ChangeDependencies, over: Partial<OpenSpecChange> = {}): OpenSpecChange => ({
  name,
  status: "no-tasks",
  completedTasks: 0,
  totalTasks: 0,
  artifacts: [],
  ...(dependencies ? { dependencies } : {}),
  ...over,
});

describe("#F2 orderByWave", () => {
  it("renders ascending waves, then cycle members (null), then changes without the field", () => {
    const col = [
      change("c", deps({ wave: 3 })),
      change("a", deps({ wave: 1 })),
      change("x", deps({ wave: null })),
      change("b", deps({ wave: 2 })),
      change("y"),
    ];
    expect(orderByWave(col).map((c) => c.name)).toEqual(["a", "b", "c", "x", "y"]);
  });

  it("ties break by name and the input is never mutated", () => {
    const col = [change("b", deps({ wave: 1 })), change("a", deps({ wave: 1 }))];
    expect(orderByWave(col).map((c) => c.name)).toEqual(["a", "b"]);
    expect(col.map((c) => c.name)).toEqual(["b", "a"]);
  });

  it("hasDependencyGraph is false when no change carries the field", () => {
    expect(hasDependencyGraph([change("a"), change("b")])).toBe(false);
    expect(hasDependencyGraph([change("a"), change("b", deps())])).toBe(true);
  });
});

describe("#F3 executionOrderDrop", () => {
  const base = { movedName: "m", targetManualOrder: ["a", "b"] };
  it("a drop on the own column is a no-op (no persisted change)", () => {
    expect(executionOrderDrop({ ...base, sourceKey: "g1", targetKey: "g1" })).toBeNull();
  });
  it("a drop on another column appends to the target's manual order", () => {
    expect(executionOrderDrop({ ...base, sourceKey: "g1", targetKey: "g2" })).toEqual({ newTargetOrder: ["a", "b", "m"] });
  });
  it("never duplicates an entry already present in the target order", () => {
    expect(executionOrderDrop({ movedName: "a", sourceKey: "g1", targetKey: "g2", targetManualOrder: ["a", "b"] })).toEqual({
      newTargetOrder: ["b", "a"],
    });
  });
});

describe("#F1 showDependencyUi", () => {
  it("shows for pi-spec-driven or when any change has a file; hides otherwise", () => {
    const schema = (configured: string | null) => ({ configured, generated: "current" as const, missing: false, unpinnedChanges: [], affectedChanges: [], projectSchemas: [] });
    expect(showDependencyUi({ changes: [change("a", deps())], workflowSchema: schema("pi-spec-driven") })).toBe(true);
    expect(showDependencyUi({ changes: [change("a", deps({ hasFile: true }))], workflowSchema: schema("spec-driven") })).toBe(true);
    expect(showDependencyUi({ changes: [change("a", deps())], workflowSchema: schema("spec-driven") })).toBe(false);
    expect(showDependencyUi({ changes: [change("a", deps())] })).toBe(false);
  });
});

describe("#F6 showDeclareHint", () => {
  const withArtifact = (status: "blocked" | "done" | "ready", dependencies?: ChangeDependencies) =>
    change("a", dependencies, { artifacts: [{ id: "dependencies", status }] });
  it("hint when the dependencies artifact is ready — regardless of UI visibility", () => {
    expect(showDeclareHint(withArtifact("ready", deps()))).toBe(true);
  });
  it("no hint while it is blocked or done", () => {
    expect(showDeclareHint(withArtifact("blocked", deps()))).toBe(false);
    expect(showDeclareHint(withArtifact("done", deps()))).toBe(false);
  });
  it("no hint on the fallback path (no dependencies field)", () => {
    expect(showDeclareHint(withArtifact("ready"))).toBe(false);
  });
});

describe("review: the source column keeps its MANUAL order after an execution-order drop", () => {
  const col = [change("a"), change("b"), change("c")]; // displayed in wave order a, b, c
  it("persisted manual order c, a, b survives moving a out", () => {
    expect(sourceOrderAfterMove(col, ["c", "a", "b"], "a")).toEqual(["c", "b"]);
  });
  it("with no stored manual order the default order is used, never the wave-ordered display", () => {
    const wave = [change("z", undefined, { status: "complete" }), change("m")]; // wave order z, m
    const out = sourceOrderAfterMove(wave, undefined, "x");
    expect(out.sort()).toEqual(["m", "z"]);
    expect(out).not.toEqual(["z", "m"]); // defaultChangeSort puts the non-complete change first
  });
});
