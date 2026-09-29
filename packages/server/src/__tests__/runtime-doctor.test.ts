/** 9.2 Doctor row "Dashboard runtime". See change: electron-runtime-overlay-updates. */
import { describe, expect, it } from "vitest";
import { bundledFallbackIntact, buildRuntimeDoctorCheck } from "../runtime-overlay/runtime-doctor.js";

const overlay = { origin: "overlay" as const, id: "0.9.1", version: "0.9.1", updatable: true, source: "npm" as const };

describe("buildRuntimeDoctorCheck", () => {
  it("healthy overlay → ok, reports origin/version/source/pi version", () => {
    const c = buildRuntimeDoctorCheck({ health: overlay, piVersion: "0.86.1", mismatches: [], bundledIntact: true });
    expect(c).toMatchObject({ name: "Dashboard runtime", section: "runtime", status: "ok" });
    expect(c.message).toContain("overlay 0.9.1");
    expect(c.message).toContain("source npm");
    expect(c.message).toContain("pi 0.86.1");
  });

  it("last failure → warning with id + reason in detail", () => {
    const c = buildRuntimeDoctorCheck({
      health: { ...overlay, lastFailure: { id: "0.9.2", reason: "health timeout" } },
      mismatches: [],
      bundledIntact: true,
    });
    expect(c.status).toBe("warning");
    expect(c.detail).toContain("0.9.2: health timeout");
  });

  it("extension_mismatch sessions → warning listing them", () => {
    const c = buildRuntimeDoctorCheck({
      health: overlay,
      mismatches: [{ sessionId: "s1", runtimeId: "0.9.1", expected: "/a", reported: "/b" }],
      bundledIntact: true,
    });
    expect(c.status).toBe("warning");
    expect(c.detail).toContain("extension_mismatch s1");
  });

  it("bundled fallback missing → error", () => {
    const c = buildRuntimeDoctorCheck({ health: overlay, mismatches: [], bundledIntact: false });
    expect(c.status).toBe("error");
    expect(c.detail).toContain("bundled fallback missing");
  });

  it("bundledFallbackIntact: null outside Electron and for devMonorepo; false when the bundle is absent", () => {
    const base = { PI_DASHBOARD_ELECTRON_INSTANCE: "t", PI_DASHBOARD_RESOURCES_PATH: "/nope" };
    expect(bundledFallbackIntact({})).toBeNull();
    expect(bundledFallbackIntact({ ...base, PI_DASHBOARD_RUNTIME_ORIGIN: "devMonorepo" })).toBeNull();
    expect(bundledFallbackIntact({ ...base, PI_DASHBOARD_RUNTIME_ORIGIN: "overlay" })).toBe(false);
  });

  it("bundledIntact null (not Electron) is not an error", () => {
    const c = buildRuntimeDoctorCheck({
      health: { origin: "npmGlobal", id: "npmGlobal", version: "0.9.1", updatable: false },
      mismatches: [],
      bundledIntact: null,
    });
    expect(c.status).toBe("ok");
  });
});
