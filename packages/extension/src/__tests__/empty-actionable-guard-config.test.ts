import { describe, expect, it } from "vitest";
import { resolveGuardConfig } from "../empty-actionable-guard-config.js";

describe("resolveGuardConfig", () => {
  it("defaults to auto-continue with cap 2", () => {
    expect(resolveGuardConfig({})).toEqual({ mode: "auto-continue", retryCap: 2 });
  });

  it("honors surface-only mode", () => {
    expect(resolveGuardConfig({ PI_DASHBOARD_EMPTY_TURN_GUARD: "surface-only" })).toEqual({
      mode: "surface-only",
      retryCap: 2,
    });
  });

  it("falls back to auto-continue for an unknown mode value", () => {
    expect(resolveGuardConfig({ PI_DASHBOARD_EMPTY_TURN_GUARD: "nonsense" }).mode).toBe("auto-continue");
  });

  it("parses a custom retry cap", () => {
    expect(resolveGuardConfig({ PI_DASHBOARD_EMPTY_TURN_RETRY_CAP: "5" }).retryCap).toBe(5);
  });

  it("accepts a cap of 0", () => {
    expect(resolveGuardConfig({ PI_DASHBOARD_EMPTY_TURN_RETRY_CAP: "0" }).retryCap).toBe(0);
  });

  it("ignores a non-integer / negative cap and uses the default", () => {
    expect(resolveGuardConfig({ PI_DASHBOARD_EMPTY_TURN_RETRY_CAP: "abc" }).retryCap).toBe(2);
    expect(resolveGuardConfig({ PI_DASHBOARD_EMPTY_TURN_RETRY_CAP: "-3" }).retryCap).toBe(2);
  });
});
