import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the shared npm module (update-checker now delegates all npm work to it).
const { outdatedOr, outdatedGlobalOr } = vi.hoisted(() => ({
  outdatedOr: vi.fn(),
  outdatedGlobalOr: vi.fn(),
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/npm.js", () => ({
  outdatedOr,
  outdatedGlobalOr,
  install: vi.fn(() => ({ ok: true, value: "" })),
  installGlobal: vi.fn(() => ({ ok: true, value: "" })),
}));

vi.mock("../lib/wizard-state.js", () => ({
  readModeFile: () => ({ mode: "standalone" }),
}));

import { checkOutdated, startUpdateChecker } from "../lib/update-checker.js";

describe("update-checker", () => {
  beforeEach(() => {
    outdatedOr.mockReset();
    outdatedGlobalOr.mockReset();
  });

  it("returns empty when all packages are current", () => {
    // Returning null or {} from npm.outdatedOr means no updates available.
    outdatedOr.mockReturnValue({});
    outdatedGlobalOr.mockReturnValue({});
    expect(checkOutdated()).toEqual([]);
  });

  it("returns empty when npm returns null (binary missing, etc.)", () => {
    outdatedOr.mockReturnValue(null);
    outdatedGlobalOr.mockReturnValue(null);
    expect(checkOutdated()).toEqual([]);
  });

  it("detects outdated package (standalone/managed mode)", () => {
    outdatedOr.mockImplementation(({ pkg }: { pkg?: string }) => {
      if (pkg === "@earendil-works/pi-coding-agent") {
        return {
          "@earendil-works/pi-coding-agent": { current: "0.64.0", latest: "0.65.0" },
        };
      }
      return null;
    });

    const result = checkOutdated();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("@earendil-works/pi-coding-agent");
    expect(result[0].current).toBe("0.64.0");
    expect(result[0].latest).toBe("0.65.0");
  });

  it("skips entries where current === latest", () => {
    outdatedOr.mockReturnValue({
      "@earendil-works/pi-coding-agent": { current: "0.65.0", latest: "0.65.0" },
    });
    expect(checkOutdated()).toEqual([]);
  });

  it("tolerates npm errors (returns partial results)", () => {
    // One package returns outdated, the other returns null (error/missing).
    outdatedOr.mockImplementation(({ pkg }: { pkg?: string }) => {
      if (pkg === "@fission-ai/openspec") {
        return { "@fission-ai/openspec": { current: "1.0.0", latest: "1.1.0" } };
      }
      return null;
    });

    const result = checkOutdated();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("@fission-ai/openspec");
  });

  // E19 — the legacy fork is never checked, for either starter.
  // See change: drop-mariozechner-pi-fork (test-plan #E19).
  for (const starter of ["Standalone", "Electron"] as const) {
    it(`E19: ${starter} checks only earendil pi + openspec`, () => {
      outdatedOr.mockReturnValue({});
      outdatedGlobalOr.mockReturnValue({});
      checkOutdated(starter);
      const spy = starter === "Standalone" ? outdatedGlobalOr : outdatedOr;
      const pkgs = spy.mock.calls.map(([arg]) => (arg as { pkg?: string }).pkg);
      expect(pkgs).toEqual(["@earendil-works/pi-coding-agent", "@fission-ai/openspec"]);
    });
  }
});

// See change: fix-cli-control-electron-server (test-plan #E10, design D6): the
// strategy is derived from the published `launchSource`, not the removed `starter`.
describe("update-checker strategy from /api/health", () => {
  beforeEach(() => {
    outdatedOr.mockReset().mockReturnValue(null);
    outdatedGlobalOr.mockReset().mockReturnValue(null);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function runWith(health: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, pid: 1, ...health }), { status: 200 })),
    );
    const stop = startUpdateChecker(() => {});
    await vi.advanceTimersByTimeAsync(31_000);
    stop();
  }

  it("(a) launchSource electron → managed check", async () => {
    await runWith({ launchSource: "electron" });
    expect(outdatedOr).toHaveBeenCalled();
    expect(outdatedGlobalOr).not.toHaveBeenCalled();
  });

  it("(b) launchSource standalone → global npm check", async () => {
    await runWith({ launchSource: "standalone" });
    expect(outdatedGlobalOr).toHaveBeenCalled();
    expect(outdatedOr).not.toHaveBeenCalled();
  });

  it("(c) launchSource bridge → no update mechanism", async () => {
    await runWith({ launchSource: "bridge" });
    expect(outdatedGlobalOr).not.toHaveBeenCalled();
    expect(outdatedOr).not.toHaveBeenCalled();
  });

  it("(d) legacy starter Standalone only → global npm check", async () => {
    await runWith({ starter: "Standalone" });
    expect(outdatedGlobalOr).toHaveBeenCalled();
    expect(outdatedOr).not.toHaveBeenCalled();
  });

  it("(e) neither field → today's unknown path (managed check)", async () => {
    await runWith({});
    expect(outdatedOr).toHaveBeenCalled();
    expect(outdatedGlobalOr).not.toHaveBeenCalled();
  });
});
