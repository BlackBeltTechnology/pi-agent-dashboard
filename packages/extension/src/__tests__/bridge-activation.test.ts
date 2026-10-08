import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldActivateBridge } from "../bridge-activation.js";

/**
 * Bridge activation gate (test-plan #E8, #E9, #X1).
 * See change: add-bridge-env-opt-out.
 */

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  consoleSpies = (["log", "info", "warn", "error"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function consoleCalls(): number {
  return consoleSpies.reduce((n, s) => n + s.mock.calls.length, 0);
}

describe("shouldActivateBridge", () => {
  it("#E8 env off short-circuits the config read and stays silent", () => {
    const readConfig = vi.fn(() => ({ enabled: true }));
    expect(shouldActivateBridge({ PI_DASHBOARD_BRIDGE: "off" }, readConfig)).toBe(false);
    expect(readConfig).toHaveBeenCalledTimes(0);
    expect(consoleCalls()).toBe(0);
  });

  it("#E8 env on short-circuits the config read", () => {
    const readConfig = vi.fn(() => ({ enabled: false }));
    expect(shouldActivateBridge({ PI_DASHBOARD_BRIDGE: "on" }, readConfig)).toBe(true);
    expect(readConfig).toHaveBeenCalledTimes(0);
  });

  it("#E9 unset env defers to config exactly once", () => {
    const readConfig = vi.fn(() => ({ enabled: false }));
    expect(shouldActivateBridge({}, readConfig)).toBe(false);
    expect(readConfig).toHaveBeenCalledTimes(1);
  });

  it("#X1 config read failure fails open, silently", () => {
    const readConfig = vi.fn(() => {
      throw new Error("EACCES");
    });
    expect(shouldActivateBridge({}, readConfig)).toBe(true);
    expect(consoleCalls()).toBe(0);
  });
});
