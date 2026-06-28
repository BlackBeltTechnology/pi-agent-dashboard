import * as sharedNodeVersion from "@blackbelt-technology/pi-dashboard-shared/node-version.js";
import { describe, expect, it } from "vitest";
import {
  buildEnginesRangeMessage,
  buildNodeUpgradeMessage,
  isAffectedNode,
  isOutOfEnginesRange,
} from "../node-guard.js";

describe("node-guard re-exports the shared canonical predicates", () => {
  it("isAffectedNode is the same reference as the shared source", () => {
    expect(isAffectedNode).toBe(sharedNodeVersion.isAffectedNode);
  });

  it("isOutOfEnginesRange is the same reference as the shared source", () => {
    expect(isOutOfEnginesRange).toBe(sharedNodeVersion.isOutOfEnginesRange);
  });
});

describe("isAffectedNode", () => {
  it("returns true for v22.0.0 (lower bound of 22.x affected)", () => {
    expect(isAffectedNode("v22.0.0")).toBe(true);
  });

  it("returns true for v22.17.999 (well inside 22.x affected)", () => {
    expect(isAffectedNode("v22.17.999")).toBe(true);
  });

  it("returns true for v22.18.0 (now refused after bump-pi-compat-to-0-75)", () => {
    expect(isAffectedNode("v22.18.0")).toBe(true);
  });

  it("returns true for v22.18.999 (upper bound of 22.x affected)", () => {
    expect(isAffectedNode("v22.18.999")).toBe(true);
  });

  it("returns false for v22.19.0 (first 22.x fixed; new floor)", () => {
    expect(isAffectedNode("v22.19.0")).toBe(false);
  });

  it("returns false for v22.22.2 (current LTS)", () => {
    expect(isAffectedNode("v22.22.2")).toBe(false);
  });

  it("returns true for v24.1.0 (lower bound of 24.x affected)", () => {
    expect(isAffectedNode("v24.1.0")).toBe(true);
  });

  it("returns true for v24.2.999 (upper bound of 24.x affected)", () => {
    expect(isAffectedNode("v24.2.999")).toBe(true);
  });

  it("returns false for v24.3.0 (first 24.x fixed)", () => {
    expect(isAffectedNode("v24.3.0")).toBe(false);
  });

  it("returns false for v24.0.0 (below affected range)", () => {
    expect(isAffectedNode("v24.0.0")).toBe(false);
  });

  it("returns false for v25.0.0 (entire 25.x unaffected)", () => {
    expect(isAffectedNode("v25.0.0")).toBe(false);
  });

  it("returns false for v20.x (pre-bug range)", () => {
    expect(isAffectedNode("v20.15.0")).toBe(false);
  });

  it("returns false for v23.x (odd releases all unaffected)", () => {
    expect(isAffectedNode("v23.5.0")).toBe(false);
  });

  it("accepts versions without the v prefix", () => {
    expect(isAffectedNode("22.18.0")).toBe(true);
    expect(isAffectedNode("22.19.0")).toBe(false);
  });

  it("returns false for malformed input rather than throwing", () => {
    expect(isAffectedNode("")).toBe(false);
    expect(isAffectedNode("not-a-version")).toBe(false);
    expect(isAffectedNode("v22")).toBe(false);
    expect(isAffectedNode("22.17")).toBe(false);
  });
});

describe("buildNodeUpgradeMessage", () => {
  it("interpolates the running version into the message", () => {
    const msg = buildNodeUpgradeMessage("v22.17.1");
    expect(msg).toContain("v22.17.1");
  });

  it("includes the upstream Node issue link", () => {
    const msg = buildNodeUpgradeMessage("v22.17.1");
    expect(msg).toContain("https://github.com/nodejs/node/issues/58515");
  });

  it("names the minimum acceptable versions", () => {
    const msg = buildNodeUpgradeMessage("v22.17.1");
    expect(msg).toMatch(/22\.19/);
    expect(msg).toMatch(/24\.3/);
  });

  it("suggests nvm, brew, and Windows installer paths", () => {
    const msg = buildNodeUpgradeMessage("v22.17.1");
    expect(msg).toMatch(/nvm/);
    expect(msg).toMatch(/brew/);
    expect(msg).toMatch(/nodejs\.org/);
  });
});


describe("isOutOfEnginesRange", () => {
  it("returns true for major < 22 (too old)", () => {
    expect(isOutOfEnginesRange("v20.15.0")).toBe(true);
    expect(isOutOfEnginesRange("v18.0.0")).toBe(true);
  });

  it("returns true for v22.x below 22.19 (below engines floor)", () => {
    expect(isOutOfEnginesRange("v22.0.0")).toBe(true);
    expect(isOutOfEnginesRange("v22.18.0")).toBe(true);
    expect(isOutOfEnginesRange("v22.18.999")).toBe(true);
  });

  it("returns false for v22.19.0 (engines floor exactly)", () => {
    expect(isOutOfEnginesRange("v22.19.0")).toBe(false);
  });

  it("returns false for v22.22.x, v23.x, v24.x, v25.x within range", () => {
    expect(isOutOfEnginesRange("v22.22.2")).toBe(false);
    expect(isOutOfEnginesRange("v23.5.0")).toBe(false);
    expect(isOutOfEnginesRange("v24.15.0")).toBe(false);
    expect(isOutOfEnginesRange("v25.0.0")).toBe(false);
    expect(isOutOfEnginesRange("v25.9.0")).toBe(false);
  });

  it("returns true for v26.x and above (engines cap)", () => {
    expect(isOutOfEnginesRange("v26.0.0")).toBe(true);
    expect(isOutOfEnginesRange("v26.8.1")).toBe(true);
    expect(isOutOfEnginesRange("v27.0.0")).toBe(true);
  });

  it("accepts versions without the v prefix", () => {
    expect(isOutOfEnginesRange("26.0.0")).toBe(true);
    expect(isOutOfEnginesRange("22.19.0")).toBe(false);
    expect(isOutOfEnginesRange("25.0.0")).toBe(false);
  });

  it("returns false for malformed input rather than throwing", () => {
    expect(isOutOfEnginesRange("")).toBe(false);
    expect(isOutOfEnginesRange("not-a-version")).toBe(false);
    expect(isOutOfEnginesRange("v22")).toBe(false);
  });
});

describe("buildEnginesRangeMessage", () => {
  it("interpolates the running version", () => {
    expect(buildEnginesRangeMessage("v26.0.0")).toContain("v26.0.0");
  });

  it("names the engines range", () => {
    expect(buildEnginesRangeMessage("v26.0.0")).toMatch(/>=22\.19\.0 <26/);
  });

  it("explains the EBADENGINE / floor link", () => {
    const msg = buildEnginesRangeMessage("v26.0.0");
    expect(msg).toMatch(/EBADENGINE/);
    expect(msg).toMatch(/floor/);
  });

  it("suggests bundled-node escape hatch", () => {
    const msg = buildEnginesRangeMessage("v26.0.0");
    expect(msg).toMatch(/\.pi-dashboard\/node\/bin/);
  });
});
