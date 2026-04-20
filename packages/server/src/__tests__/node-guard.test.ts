import { describe, expect, it } from "vitest";
import { buildNodeUpgradeMessage, isAffectedNode } from "../node-guard.js";

describe("isAffectedNode", () => {
  it("returns true for v22.0.0 (lower bound of 22.x affected)", () => {
    expect(isAffectedNode("v22.0.0")).toBe(true);
  });

  it("returns true for v22.17.999 (upper bound of 22.x affected)", () => {
    expect(isAffectedNode("v22.17.999")).toBe(true);
  });

  it("returns false for v22.18.0 (first 22.x fixed)", () => {
    expect(isAffectedNode("v22.18.0")).toBe(false);
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
    expect(isAffectedNode("22.17.0")).toBe(true);
    expect(isAffectedNode("22.18.0")).toBe(false);
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
    expect(msg).toMatch(/22\.18/);
    expect(msg).toMatch(/24\.3/);
  });

  it("suggests nvm, brew, and Windows installer paths", () => {
    const msg = buildNodeUpgradeMessage("v22.17.1");
    expect(msg).toMatch(/nvm/);
    expect(msg).toMatch(/brew/);
    expect(msg).toMatch(/nodejs\.org/);
  });
});
