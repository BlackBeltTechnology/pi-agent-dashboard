/**
 * Unit tests for the pure ownership + zombie classifiers.
 * See change: electron-attach-ownership-fixes.
 */
import { describe, expect, it } from "vitest";
import { type AttachHealth, decideAttachAction, decideIsZombie, decideOwnership } from "../server-lifecycle.js";

describe("decideOwnership", () => {
  it("electron + pid match → electron", () => {
    expect(
      decideOwnership({ healthLaunchSource: "electron", healthPid: 1234, storedSpawnedPid: 1234 }),
    ).toBe("electron");
  });

  it("electron + pid mismatch → foreign", () => {
    expect(
      decideOwnership({ healthLaunchSource: "electron", healthPid: 9999, storedSpawnedPid: 1234 }),
    ).toBe("foreign");
  });

  it("bridge-orphaned launchSource → foreign", () => {
    expect(
      decideOwnership({ healthLaunchSource: "bridge-orphaned", healthPid: 1234, storedSpawnedPid: 1234 }),
    ).toBe("foreign");
  });

  it("standalone launchSource → foreign", () => {
    expect(
      decideOwnership({ healthLaunchSource: "standalone", healthPid: 1234, storedSpawnedPid: 1234 }),
    ).toBe("foreign");
  });

  it("no stored pid (didn't spawn) → foreign", () => {
    expect(
      decideOwnership({ healthLaunchSource: "electron", healthPid: 1234, storedSpawnedPid: null }),
    ).toBe("foreign");
  });

  it("null health (unreachable) → none", () => {
    expect(
      decideOwnership({ healthLaunchSource: null, healthPid: undefined, storedSpawnedPid: 1234 }),
    ).toBe("none");
  });
});

describe("decideIsZombie — POSIX", () => {
  const base = {
    healthLaunchSourceEffective: "electron" as const,
    healthPid: 5000,
    healthPpid: 42, // reparented (subreaper), != bootParentPid
    healthBootParentPid: 1234,
    healthBootParentAlive: false,
    storedSpawnedPid: null,
    platform: "darwin" as NodeJS.Platform,
  };

  it("reparented + dead boot parent + no stored pid → true", () => {
    expect(decideIsZombie(base)).toBe(true);
  });

  it("boot parent still alive → false", () => {
    expect(decideIsZombie({ ...base, healthBootParentAlive: true })).toBe(false);
  });

  it("not reparented (ppid === bootParentPid) → false", () => {
    expect(decideIsZombie({ ...base, healthPpid: 1234 })).toBe(false);
  });

  it("we own it (stored pid set) → false", () => {
    expect(decideIsZombie({ ...base, storedSpawnedPid: 5000 })).toBe(false);
  });

  it("standalone launchSource → false", () => {
    expect(decideIsZombie({ ...base, healthLaunchSourceEffective: "standalone" })).toBe(false);
  });

  it("bridge launchSource → false", () => {
    expect(decideIsZombie({ ...base, healthLaunchSourceEffective: "bridge" })).toBe(false);
  });
});

describe("decideIsZombie — Windows", () => {
  const base = {
    healthLaunchSourceEffective: "electron" as const,
    healthPid: 5000,
    healthPpid: 1234, // Windows never reparents; ppid irrelevant
    healthBootParentPid: 1234,
    healthBootParentAlive: false,
    storedSpawnedPid: null,
    platform: "win32" as NodeJS.Platform,
  };

  it("dead boot parent + electron + no stored pid → true (regardless of ppid)", () => {
    expect(decideIsZombie(base)).toBe(true);
    expect(decideIsZombie({ ...base, healthPpid: 9999 })).toBe(true);
  });

  it("boot parent alive → false", () => {
    expect(decideIsZombie({ ...base, healthBootParentAlive: true })).toBe(false);
  });

  it("we own it (stored pid set) → false", () => {
    expect(decideIsZombie({ ...base, storedSpawnedPid: 5000 })).toBe(false);
  });

  it("non-electron launchSource → false", () => {
    expect(decideIsZombie({ ...base, healthLaunchSourceEffective: "bridge-orphaned" })).toBe(false);
  });
});

// ── decideAttachAction (E1–E11) — See change: electron-attach-version-skew ──

describe("decideAttachAction", () => {
  const base = { expectedVersion: "0.10.0", isZombie: false, isPackaged: true, isDismissed: () => false };
  const electron: AttachHealth = { version: "0.10.0", launchSourceEffective: "electron", launchSource: "electron", bootParentAlive: false };
  const act = (health: AttachHealth, over: Partial<Parameters<typeof decideAttachAction>[0]> = {}) =>
    decideAttachAction({ ...base, health, ...over });

  it("E1: matching versions → none", () => expect(act(electron).action).toBe("none"));
  it("E2: cosmetic difference → none", () => expect(act({ ...electron, version: " v0.10.0 " }).action).toBe("none"));
  it("E3: unknown server version → none", () => {
    for (const version of ["unknown", "", undefined]) expect(act({ ...electron, version: version as string }, {}).action).toBe("none");
  });
  it("E4: unknown expected version → none", () =>
    expect(act({ ...electron, version: "0.9.0" }, { expectedVersion: null }).action).toBe("none"));
  it("E5: unpackaged → none", () => expect(act({ ...electron, version: "0.9.0" }, { isPackaged: false }).action).toBe("none"));
  it("E6: skew with dead owner → restart, default restart", () =>
    expect(act({ ...electron, version: "0.9.0" })).toEqual({ action: "skew-restart", restartIsDefault: true }));
  it("E7: live or unknown owner → Leave running default", () => {
    const live = { ...electron, version: "0.9.0", bootParentAlive: true };
    expect(act(live)).toEqual({ action: "skew-restart", restartIsDefault: false });
    const { bootParentAlive: _omit, ...unknown } = live;
    expect(act(unknown)).toEqual({ action: "skew-restart", restartIsDefault: false });
  });
  it("E8: skewed zombie → merged", () =>
    expect(act({ ...electron, version: "0.9.0" }, { isZombie: true }).action).toBe("skew-zombie-merged"));
  it("E9: zombie with match or unknown → zombie", () => {
    expect(act(electron, { isZombie: true }).action).toBe("zombie");
    expect(act({ ...electron, version: "0.9.0" }, { isZombie: true, expectedVersion: null }).action).toBe("zombie");
  });
  it("E10: non-electron skew → info only", () => {
    for (const src of ["standalone", "bridge", "bridge-orphaned", undefined, "weird"]) {
      const r = act({ version: "0.9.0", launchSourceEffective: src, launchSource: src });
      expect(r.action).toBe("skew-info");
    }
  });
  it("E11: dismissal key includes the launch source and both versions", () => {
    const dismissed = [{ server: "0.9.0", expected: "0.10.0", launchSource: "standalone" }];
    const isDismissed = (p: { server: string; expected: string; launchSource: string }) =>
      dismissed.some((d) => d.server === p.server && d.expected === p.expected && d.launchSource === p.launchSource);
    const standalone = { launchSourceEffective: "standalone", launchSource: "standalone" };
    expect(act({ ...standalone, version: "0.9.0" }, { isDismissed }).action).toBe("none");
    expect(act({ version: "0.9.0", launchSourceEffective: "bridge", launchSource: "bridge" }, { isDismissed }).action).toBe("skew-info");
    expect(act({ ...standalone, version: "0.9.0" }, { isDismissed, expectedVersion: "0.10.1" }).action).toBe("skew-info");
  });
});
