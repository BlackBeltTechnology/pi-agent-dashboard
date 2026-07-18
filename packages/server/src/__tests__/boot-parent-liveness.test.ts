/**
 * Unit tests for boot-parent-liveness.
 *
 * Tier 1 (all platforms) is exercised by mocking the shared `isProcessAlive`.
 * On CI (macOS/Linux) the win32 Tier-2 koffi branch never runs, so
 * `computeBootParentAlive()` always resolves via Tier 1 — which is exactly the
 * fallback path we assert here. Tier-2 happy-path is Windows-manual-QA only
 * (koffi/kernel32 cannot be faithfully mocked cross-platform).
 *
 * See change: electron-attach-ownership-fixes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const isProcessAlive = vi.fn<(pid: number) => boolean>();

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", () => ({
  isProcessAlive: (pid: number) => isProcessAlive(pid),
}));

describe("computeBootParentAlive (Tier 1)", () => {
  beforeEach(() => {
    isProcessAlive.mockReset();
  });

  it("returns true when isProcessAlive(bootParentPid) is true", async () => {
    isProcessAlive.mockReturnValue(true);
    const { computeBootParentAlive } = await import("../lifecycle/boot-parent-liveness.js");
    expect(computeBootParentAlive()).toBe(true);
  });

  it("returns false when isProcessAlive(bootParentPid) is false", async () => {
    isProcessAlive.mockReturnValue(false);
    const { computeBootParentAlive } = await import("../lifecycle/boot-parent-liveness.js");
    expect(computeBootParentAlive()).toBe(false);
  });

  it("does not throw and returns a boolean", async () => {
    isProcessAlive.mockReturnValue(true);
    const { computeBootParentAlive } = await import("../lifecycle/boot-parent-liveness.js");
    expect(typeof computeBootParentAlive()).toBe("boolean");
  });

  it("bootParentPid is a number and readLivePpid returns a number", async () => {
    const mod = await import("../lifecycle/boot-parent-liveness.js");
    expect(typeof mod.bootParentPid).toBe("number");
    expect(typeof mod.readLivePpid()).toBe("number");
  });
});
