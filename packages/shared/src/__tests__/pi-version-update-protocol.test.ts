/**
 * Round-trip serialization for the pi_version_update extension→server message
 * + the piVersion field on DashboardSession.
 *
 * See change: restore-pi-version-skew-surface.
 */
import { describe, it, expect } from "vitest";
import type { PiVersionUpdateMessage, ExtensionToServerMessage } from "../protocol.js";
import type { DashboardSession } from "../types.js";

describe("PiVersionUpdateMessage", () => {
  it("round-trips via JSON", () => {
    const msg: PiVersionUpdateMessage = { type: "pi_version_update", sessionId: "abc-123", version: "0.80.2" };
    const back = JSON.parse(JSON.stringify(msg)) as PiVersionUpdateMessage;
    expect(back).toEqual(msg);
  });

  it("is assignable to ExtensionToServerMessage union", () => {
    const msg: ExtensionToServerMessage = { type: "pi_version_update", sessionId: "x", version: "1.2.3" };
    expect(msg.type).toBe("pi_version_update");
  });
});

describe("DashboardSession.piVersion", () => {
  it("accepts a version string or undefined and survives round-trip", () => {
    const s: Partial<DashboardSession> = { id: "s1", cwd: "/p", piVersion: "0.80.2" } as DashboardSession;
    expect(JSON.parse(JSON.stringify(s)).piVersion).toBe("0.80.2");
    expect(({} as Partial<DashboardSession>).piVersion).toBeUndefined();
  });
});
