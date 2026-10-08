import { describe, expect, it } from "vitest";
import { automationRoleUsage } from "../server/role-usage.js";
import type { DiscoveredAutomation } from "../shared/automation-types.js";

const d = (name: string, scope: "global" | "folder", model: string | undefined, valid = true): DiscoveredAutomation =>
  ({ name, scope, dir: `/x/${name}`, valid, config: model === undefined ? undefined : ({ model } as any) });

describe("automationRoleUsage", () => {
  it("lists only valid automations whose model is a role ref (global + folder)", () => {
    const out = automationRoleUsage([
      d("a", "global", "@fast"),
      d("b", "folder", "@fast:high"),
      d("c", "folder", "anthropic/claude-sonnet-4-5"),
      d("d", "global", "@fast", false),
      d("e", "global", undefined),
    ]);
    expect(out).toEqual([
      { label: "global:a", ref: "@fast" },
      { label: "folder:b", ref: "@fast:high" },
    ]);
  });
});
