/**
 * Pure child-resolution tests: single/legacy, count expansion, truncation
 * order, and effective-bound resolution.
 * See change: add-automation-concurrent-spawn.
 */
import { describe, expect, it } from "vitest";
import { effectiveBound, resolveChildren } from "../server/resolve-children.js";
import type { AutomationConfig, DiscoveredAutomation } from "../shared/automation-types.js";

function automation(config: Partial<AutomationConfig>): DiscoveredAutomation {
  return {
    name: "a",
    scope: "folder",
    dir: "/x/.pi/automation/a",
    valid: true,
    config: {
      on: { kind: "schedule", cron: "* * * * *" },
      model: "x",
      mode: "local",
      sandbox: "workspace-write",
      concurrency: "skip",
      ...config,
    } as AutomationConfig,
  };
}

describe("resolveChildren", () => {
  it("E9: a legacy single action with no count resolves to exactly one child", () => {
    const { specs, truncated } = resolveChildren(
      automation({ action: { kind: "flows.run" } }),
      4,
    );
    expect(specs).toHaveLength(1);
    expect(truncated).toBe(0);
    expect(specs[0]!.action.kind).toBe("flows.run");
  });

  it("E10: over-bound resolution truncates to the bound and reports the count dropped", () => {
    const { specs, truncated } = resolveChildren(
      automation({ action: { kind: "flows.run", count: 10 } }),
      4,
    );
    expect(specs).toHaveLength(4);
    expect(truncated).toBe(6);
  });

  it("E11: truncation keeps declaration order (entries then ascending count index)", () => {
    const { specs } = resolveChildren(
      automation({
        actions: [
          { kind: "flows.run", payload: { flow: "A" }, count: 3 },
          { kind: "core.skill", payload: { skill: "B" }, count: 3 },
        ],
      }),
      4,
    );
    expect(specs).toHaveLength(4);
    // A#0, A#1, A#2, B#0
    expect(specs.map((s) => s.action.payload?.flow ?? s.action.payload?.skill)).toEqual([
      "A",
      "A",
      "A",
      "B",
    ]);
  });

  it("E12: an under-bound fire records no truncation", () => {
    const { specs, truncated } = resolveChildren(
      automation({ actions: [{ kind: "flows.run" }, { kind: "core.skill" }] }),
      4,
    );
    expect(specs).toHaveLength(2);
    expect(truncated).toBe(0);
  });

  it("E13: a per-automation bound overrides the settings default", () => {
    const a = automation({ action: { kind: "flows.run", count: 10 }, maxConcurrentSpawns: 2 });
    expect(effectiveBound(a, 4)).toBe(2);
    expect(resolveChildren(a, effectiveBound(a, 4)).specs).toHaveLength(2);
  });

  it("effectiveBound falls back to the settings default when unset", () => {
    expect(effectiveBound(automation({ action: { kind: "flows.run" } }), 4)).toBe(4);
  });
});
