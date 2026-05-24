/**
 * Unit tests for selectLaunchSource() and parsePreferOverride().
 *
 * Under the immutable-bundle architecture (see change:
 * eliminate-electron-runtime-install), the resolver has three branches:
 *   - attach       (running server detected via health probe)
 *   - devMonorepo  (ELECTRON_DEV; bridge.ts + cli.ts under cwd)
 *   - bundled      (resourcesPath/server/.../cli.ts exists)
 *
 * All I/O probes are injected as mocks — no real filesystem, network, or
 * child processes.
 */
import { describe, it, expect, vi } from "vitest";
import {
  selectLaunchSource,
  parsePreferOverride,
  PinnedSourceUnavailableError,
  BundledServerMissingError,
  getBundledCliPath,
  type LaunchSourceOpts,
  type LaunchSourceProbes,
} from "../launch-source.js";

function makeProbes(overrides: Partial<LaunchSourceProbes> = {}): Partial<LaunchSourceProbes> {
  return {
    healthProbe: vi.fn().mockResolvedValue({ running: false }),
    existsSync: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

function baseOpts(overrides: Partial<LaunchSourceOpts> = {}): LaunchSourceOpts {
  return {
    isPackaged: true,
    cwd: "/fake/cwd",
    preferOverride: null,
    resourcesPath: "/fake/resources",
    port: 8000,
    ...overrides,
  };
}

// ── attach ────────────────────────────────────────────────────────────────────

describe("selectLaunchSource — attach", () => {
  it("returns attach when health probe reports running", async () => {
    const probes = makeProbes({
      healthProbe: vi.fn().mockResolvedValue({
        running: true,
        starter: "Bridge",
        url: "http://localhost:8000",
      }),
    });
    const result = await selectLaunchSource(baseOpts({ probes }));
    expect(result).toEqual({
      kind: "attach",
      url: "http://localhost:8000",
      starter: "Bridge",
    });
  });

  it("defaults starter to Standalone when health response omits it", async () => {
    const probes = makeProbes({
      healthProbe: vi.fn().mockResolvedValue({
        running: true,
        url: "http://localhost:8000",
      }),
    });
    const result = await selectLaunchSource(baseOpts({ probes }));
    expect(result.kind).toBe("attach");
    if (result.kind === "attach") expect(result.starter).toBe("Standalone");
  });
});

// ── devMonorepo ───────────────────────────────────────────────────────────────

describe("selectLaunchSource — devMonorepo", () => {
  it("returns devMonorepo when isPackaged=false and both files exist", async () => {
    const probes = makeProbes({
      existsSync: vi
        .fn()
        .mockImplementation(
          (p: string) => p.endsWith("cli.ts") || p.endsWith("bridge.ts"),
        ),
    });
    const result = await selectLaunchSource(
      baseOpts({ isPackaged: false, cwd: "/repo", probes }),
    );
    expect(result.kind).toBe("devMonorepo");
    if (result.kind === "devMonorepo") {
      expect(result.cliPath).toBe("/repo/packages/server/src/cli.ts");
      expect(result.cwd).toBe("/repo");
    }
  });

  it("does NOT return devMonorepo when isPackaged=true", async () => {
    // Even if cli.ts + bridge.ts exist, packaged builds skip dev probe.
    const probes = makeProbes({
      existsSync: vi.fn().mockReturnValue(true),
    });
    const result = await selectLaunchSource(
      baseOpts({ isPackaged: true, cwd: "/repo", probes }),
    );
    expect(result.kind).toBe("bundled");
  });
});

// ── bundled ───────────────────────────────────────────────────────────────────

describe("selectLaunchSource — bundled", () => {
  it("returns bundled when resourcesPath/server/.../cli.ts exists", async () => {
    const cliPath = getBundledCliPath("/fake/resources");
    const probes = makeProbes({
      existsSync: vi.fn().mockImplementation((p: string) => p === cliPath),
    });
    const result = await selectLaunchSource(baseOpts({ probes }));
    expect(result).toEqual({
      kind: "bundled",
      cliPath,
      cwd: "/fake/resources/server",
    });
  });

  it("throws BundledServerMissingError when no source resolves", async () => {
    const probes = makeProbes(); // existsSync always false
    await expect(selectLaunchSource(baseOpts({ probes }))).rejects.toBeInstanceOf(
      BundledServerMissingError,
    );
  });
});

// ── preferOverride ────────────────────────────────────────────────────────────

describe("selectLaunchSource — preferOverride", () => {
  it("throws PinnedSourceUnavailableError when pinned source can't resolve", async () => {
    const probes = makeProbes();
    await expect(
      selectLaunchSource(baseOpts({ preferOverride: "bundled", probes })),
    ).rejects.toBeInstanceOf(PinnedSourceUnavailableError);
  });

  it("uses pinned bundled source when available", async () => {
    const cliPath = getBundledCliPath("/fake/resources");
    const probes = makeProbes({
      existsSync: vi.fn().mockImplementation((p: string) => p === cliPath),
    });
    const result = await selectLaunchSource(
      baseOpts({ preferOverride: "bundled", probes }),
    );
    expect(result.kind).toBe("bundled");
  });
});

// ── parsePreferOverride ───────────────────────────────────────────────────────

describe("parsePreferOverride", () => {
  it("returns null when env var is unset", () => {
    expect(parsePreferOverride({})).toBeNull();
  });

  it("returns null when env var is empty", () => {
    expect(parsePreferOverride({ DASHBOARD_PREFER_SOURCE: "" })).toBeNull();
  });

  it.each(["attach", "bundled", "devMonorepo"] as const)(
    "accepts known source kind '%s'",
    (kind) => {
      expect(parsePreferOverride({ DASHBOARD_PREFER_SOURCE: kind })).toBe(kind);
    },
  );

  it("rejects unknown source kinds and logs a warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      parsePreferOverride({ DASHBOARD_PREFER_SOURCE: "extracted" }),
    ).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("rejects pre-R3 source kinds (piExtension, npmGlobal, extracted)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const removed of ["piExtension", "npmGlobal", "extracted"]) {
      expect(
        parsePreferOverride({ DASHBOARD_PREFER_SOURCE: removed }),
      ).toBeNull();
    }
    warnSpy.mockRestore();
  });
});
