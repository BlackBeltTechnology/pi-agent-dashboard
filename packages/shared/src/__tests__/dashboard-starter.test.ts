import { describe, it, expect, vi, afterEach } from "vitest";
import { parseDashboardStarter } from "../dashboard-starter.js";

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
