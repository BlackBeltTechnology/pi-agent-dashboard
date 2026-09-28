/**
 * /api/restart under Electron hands the restart to the app (exit code 75)
 * so the new server keeps the Electron starter + runtime identity.
 * See change: electron-runtime-overlay-updates (X13 restart leg).
 */
import { describe, expect, it } from "vitest";
import { ELECTRON_RESTART_EXIT_CODE, restartsViaElectron } from "../electron-restart.js";

describe("restartsViaElectron", () => {
  it("true only for an Electron-owned server (starter + owner token)", () => {
    expect(restartsViaElectron({ DASHBOARD_STARTER: "Electron", PI_DASHBOARD_ELECTRON_INSTANCE: "tok" })).toBe(true);
  });
  it.each([
    [{ DASHBOARD_STARTER: "Electron" }],
    [{ PI_DASHBOARD_ELECTRON_INSTANCE: "tok" }],
    [{ DASHBOARD_STARTER: "Standalone", PI_DASHBOARD_ELECTRON_INSTANCE: "tok" }],
    [{}],
  ])("false otherwise (%j)", (env) => {
    expect(restartsViaElectron(env)).toBe(false);
  });
  it("uses a dedicated, non-zero exit code", () => {
    expect(ELECTRON_RESTART_EXIT_CODE).toBe(75);
  });
});
