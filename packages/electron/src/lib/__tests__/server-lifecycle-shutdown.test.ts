/**
 * Unit tests for the lifecycle ownership rule (decideShutdownOnQuit).
 * See change: simplify-electron-bootstrap-derived-state (task 6.9).
 */
import { describe, it, expect } from "vitest";
import { decideShutdownOnQuit } from "../server-lifecycle.js";

describe("decideShutdownOnQuit", () => {
  it("starter=Electron, pid match → stop server", () => {
    expect(decideShutdownOnQuit({ starter: "Electron", healthPid: 1234, storedPid: 1234 })).toBe(true);
  });

  it("starter=Electron, pid mismatch → no stop", () => {
    expect(decideShutdownOnQuit({ starter: "Electron", healthPid: 9999, storedPid: 1234 })).toBe(false);
  });

  it("starter=Bridge → no stop", () => {
    expect(decideShutdownOnQuit({ starter: "Bridge", healthPid: 1234, storedPid: 1234 })).toBe(false);
  });

  it("starter=Standalone → no stop", () => {
    expect(decideShutdownOnQuit({ starter: "Standalone", healthPid: 1234, storedPid: 1234 })).toBe(false);
  });

  it("storedPid=null → no stop (we never spawned a server)", () => {
    expect(decideShutdownOnQuit({ starter: "Electron", healthPid: 1234, storedPid: null })).toBe(false);
  });

  it("healthPid undefined → no stop", () => {
    expect(decideShutdownOnQuit({ starter: "Electron", healthPid: undefined, storedPid: 1234 })).toBe(false);
  });

  it("starter undefined → no stop", () => {
    expect(decideShutdownOnQuit({ starter: undefined, healthPid: 1234, storedPid: 1234 })).toBe(false);
  });
});
