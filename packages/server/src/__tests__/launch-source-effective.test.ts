/**
 * Unit tests for computeEffectiveLaunchSource — the bridge-orphan promotion
 * rule for /api/health.launchSourceEffective.
 * See change: electron-attach-ownership-fixes.
 */
import { describe, it, expect } from "vitest";
import { computeEffectiveLaunchSource } from "../lifecycle/launch-source-effective.js";

describe("computeEffectiveLaunchSource", () => {
  it("bridge + 0 bridges + uptime past grace → bridge-orphaned", () => {
    expect(
      computeEffectiveLaunchSource({ raw: "bridge", activeBridgeCount: 0, uptimeMs: 31_000 }),
    ).toBe("bridge-orphaned");
  });

  it("bridge + 0 bridges + uptime inside grace → bridge", () => {
    expect(
      computeEffectiveLaunchSource({ raw: "bridge", activeBridgeCount: 0, uptimeMs: 29_000 }),
    ).toBe("bridge");
  });

  it("bridge + 1 bridge + uptime past grace → bridge (live session)", () => {
    expect(
      computeEffectiveLaunchSource({ raw: "bridge", activeBridgeCount: 1, uptimeMs: 31_000 }),
    ).toBe("bridge");
  });

  it("electron + 0 bridges + any uptime → electron (never promoted)", () => {
    expect(
      computeEffectiveLaunchSource({ raw: "electron", activeBridgeCount: 0, uptimeMs: 999_000 }),
    ).toBe("electron");
  });

  it("standalone + 0 bridges + any uptime → standalone (never promoted)", () => {
    expect(
      computeEffectiveLaunchSource({ raw: "standalone", activeBridgeCount: 0, uptimeMs: 999_000 }),
    ).toBe("standalone");
  });
});
