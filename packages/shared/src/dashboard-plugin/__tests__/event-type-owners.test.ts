import { describe, expect, it } from "vitest";
import { isValidEventTypePattern, matchEventTypeOwner, matchesEventTypePattern } from "../event-type-owners.js";

describe("matchesEventTypePattern", () => {
  it("trailing * is a prefix glob", () => {
    expect(matchesEventTypePattern("flow_*", "flow_step")).toBe(true);
    expect(matchesEventTypePattern("subagent_*", "subagent_entry")).toBe(true);
    expect(matchesEventTypePattern("subagent_*", "subagentx")).toBe(false);
  });
  it("otherwise exact", () => {
    expect(matchesEventTypePattern("quota_tick", "quota_tick")).toBe(true);
    expect(matchesEventTypePattern("quota_tick", "quota_tick2")).toBe(false);
  });
});

describe("isValidEventTypePattern", () => {
  it("accepts exact names and trailing-star prefixes only", () => {
    expect(isValidEventTypePattern("quota_tick")).toBe(true);
    expect(isValidEventTypePattern("flow_*")).toBe(true);
    for (const bad of ["", "*", "a*b", "*_x", "a b", "a**"]) expect(isValidEventTypePattern(bad)).toBe(false);
  });
});

describe("matchEventTypeOwner", () => {
  const owners = [
    { ownerId: "flows", displayName: "Flows", eventTypes: ["flow_*"] },
    { ownerId: "quota", displayName: "Quota", eventTypes: ["quota_tick"] },
    { ownerId: "subagents", displayName: "Subagents", eventTypes: ["subagent_*"] },
  ];
  it("returns the owner of a matching type", () => {
    expect(matchEventTypeOwner(owners, "flow_step")?.ownerId).toBe("flows");
    expect(matchEventTypeOwner(owners, "quota_tick")?.ownerId).toBe("quota");
  });
  it("returns undefined for unowned types", () => {
    for (const t of ["quota_tick2", "subagentx", "mystery_evt"]) expect(matchEventTypeOwner(owners, t)).toBeUndefined();
  });
  it("an exact declaration beats a prefix glob", () => {
    const o = [
      { ownerId: "a", displayName: "A", eventTypes: ["x_*"] },
      { ownerId: "b", displayName: "B", eventTypes: ["x_one"] },
    ];
    expect(matchEventTypeOwner(o, "x_one")?.ownerId).toBe("b");
    expect(matchEventTypeOwner(o, "x_two")?.ownerId).toBe("a");
  });
});
