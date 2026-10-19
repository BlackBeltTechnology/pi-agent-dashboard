import { describe, it, expect, vi, afterEach } from "vitest";
import { parseDashboardStarter, starterFromHealth } from "../dashboard-starter.js";

describe("parseDashboardStarter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns Standalone when env is empty object", () => {
    expect(parseDashboardStarter({})).toBe("Standalone");
  });

  it("returns Standalone when DASHBOARD_STARTER is undefined", () => {
    expect(parseDashboardStarter({ DASHBOARD_STARTER: undefined })).toBe("Standalone");
  });

  it("returns Standalone when DASHBOARD_STARTER is empty string", () => {
    expect(parseDashboardStarter({ DASHBOARD_STARTER: "" })).toBe("Standalone");
  });

  it("returns Bridge for valid value", () => {
    expect(parseDashboardStarter({ DASHBOARD_STARTER: "Bridge" })).toBe("Bridge");
  });

  it("returns Standalone for valid value", () => {
    expect(parseDashboardStarter({ DASHBOARD_STARTER: "Standalone" })).toBe("Standalone");
  });

  it("returns Electron for valid value", () => {
    expect(parseDashboardStarter({ DASHBOARD_STARTER: "Electron" })).toBe("Electron");
  });

  it("returns Standalone and warns on invalid value", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = parseDashboardStarter({ DASHBOARD_STARTER: "bogus" });
    expect(result).toBe("Standalone");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain("bogus");
  });
});

// See change: fix-cli-control-electron-server (test-plan #E1, design D6).
describe("starterFromHealth", () => {
  const cases: Array<[string, Record<string, unknown>, string | undefined]> = [
    ["launchSource electron", { launchSource: "electron" }, "Electron"],
    ["launchSource bridge", { launchSource: "bridge" }, "Bridge"],
    ["launchSource standalone", { launchSource: "standalone" }, "Standalone"],
    ["launchSource wins over legacy starter", { launchSource: "electron", starter: "Standalone" }, "Electron"],
    ["legacy starter only", { starter: "Electron" }, "Electron"],
    [
      "orphaned bridge maps by the static launchSource",
      { launchSource: "bridge", launchSourceEffective: "bridge-orphaned" },
      "Bridge",
    ],
    ["effective-only body is not read", { launchSourceEffective: "bridge-orphaned" }, undefined],
    ["unknown launchSource", { launchSource: "cli" }, undefined],
    ["empty body", {}, undefined],
  ];
  for (const [name, body, expected] of cases) {
    it(name, () => {
      expect(starterFromHealth(body)).toBe(expected);
    });
  }
});
