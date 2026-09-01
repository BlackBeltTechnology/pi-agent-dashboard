import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { hasMovedAway, isRemoteOrigin } from "../session/session-origin-view.js";

/**
 * Transport/identity view helpers.
 * See change: add-pi-gateway-transport-identity.
 */
function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/tmp",
    source: "tui",
    status: "active",
    startedAt: 1_000,
    ...overrides,
  } as DashboardSession;
}

describe("isRemoteOrigin", () => {
  it("is false when originDeviceId is absent (absent means LOCAL)", () => {
    expect(isRemoteOrigin(makeSession())).toBe(false);
  });

  it("is false for an empty originDeviceId", () => {
    expect(isRemoteOrigin(makeSession({ originDeviceId: "" }))).toBe(false);
  });

  it("is true when originDeviceId is set", () => {
    expect(isRemoteOrigin(makeSession({ originDeviceId: "device-42" }))).toBe(true);
  });
});

describe("hasMovedAway", () => {
  it("is false when movedTo is absent", () => {
    expect(hasMovedAway(makeSession())).toBe(false);
  });

  it("is true when movedTo is set, regardless of status staying ended", () => {
    const s = makeSession({
      status: "ended",
      movedTo: { instanceId: "inst-2", endpoint: "ws://host:8000", at: 5_000 },
    });
    expect(hasMovedAway(s)).toBe(true);
    expect(s.status).toBe("ended");
  });
});
