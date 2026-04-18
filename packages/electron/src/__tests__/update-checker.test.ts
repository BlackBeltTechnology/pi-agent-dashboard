import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { checkOutdated } from "../lib/update-checker.js";

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
      if (pkg === "@mariozechner/pi-coding-agent") {
        return {
          "@mariozechner/pi-coding-agent": { current: "0.64.0", latest: "0.65.0" },
        };
      }
      return null;
    });

    const result = checkOutdated();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("@mariozechner/pi-coding-agent");
    expect(result[0].current).toBe("0.64.0");
    expect(result[0].latest).toBe("0.65.0");
  });

  it("skips entries where current === latest", () => {
    outdatedOr.mockReturnValue({
      "@mariozechner/pi-coding-agent": { current: "0.65.0", latest: "0.65.0" },
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
});
