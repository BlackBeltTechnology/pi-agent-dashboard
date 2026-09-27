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
  getOverlayCliPath,
  getLocalCliPath,
  getServerReadyDeadlineMs,
  type LaunchSourceOpts,
  type LaunchSourceProbes,
  type RuntimeLaunchInputs,
  runtimeIdentityEnv,
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

  it.each(["attach", "bundled", "devMonorepo", "localLink", "overlay"] as const)(
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

  it("rejects pre-R3 source kinds (piExtension, npmGlobal, extracted) + the runtime-overlay non-kinds", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of ["local", "npm", "github"]) {
      expect(parsePreferOverride({ DASHBOARD_PREFER_SOURCE: bad })).toBeNull();
    }
    warnSpy.mockRestore();
  });

  it("rejects pre-R3 source kinds (piExtension, npmGlobal, extracted) individually", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const removed of ["piExtension", "npmGlobal", "extracted"]) {
      expect(
        parsePreferOverride({ DASHBOARD_PREFER_SOURCE: removed }),
      ).toBeNull();
    }
    warnSpy.mockRestore();
  });
});

// ── runtime overlay + local link (E4) ─────────────────────────────────────────
// See change: electron-runtime-overlay-updates (D4).

describe("selectLaunchSource — runtime-overlay precedence (E4)", () => {
  const LOCAL_ROOT = "/r/co";
  const OVERLAY_ROOT = "/home/u/.pi/dashboard/runtime/versions/0.9.1";
  type Src = "bundled" | "npm" | "github" | "local";

  const rows: Array<[boolean, boolean, Src, boolean, boolean]> = [];
  for (const health of [true, false])
    for (const devMono of [true, false])
      for (const src of ["bundled", "npm", "github", "local"] as const)
        for (const gateOk of [true, false])
          for (const skipAttach of [false, true]) rows.push([health, devMono, src, gateOk, skipAttach]);

  function expected(health: boolean, devMono: boolean, src: Src, gateOk: boolean, skipAttach: boolean) {
    if (health && !skipAttach) return "attach";
    if (devMono) return "devMonorepo";
    if (src === "local" && gateOk) return "localLink";
    if ((src === "npm" || src === "github") && gateOk) return "overlay";
    return "bundled";
  }

  function assertRuntimeShape(result: Awaited<ReturnType<typeof selectLaunchSource>>) {
    if (result.kind === "localLink") {
      expect(result).toEqual({
        kind: "localLink",
        cliPath: getLocalCliPath(LOCAL_ROOT),
        cwd: LOCAL_ROOT,
        runtimeId: `local:${LOCAL_ROOT}`,
      });
    }
    if (result.kind === "overlay") {
      expect(result).toEqual({
        kind: "overlay",
        cliPath: getOverlayCliPath(OVERLAY_ROOT),
        cwd: OVERLAY_ROOT,
        runtimeId: "0.9.1",
      });
    }
  }

  function assertFallThrough(onFallThrough: ReturnType<typeof vi.fn>, considered: boolean, src: Src) {
    if (!considered) {
      expect(onFallThrough).not.toHaveBeenCalled();
      return;
    }
    expect(onFallThrough).toHaveBeenCalledTimes(1);
    expect(onFallThrough).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeId: src === "local" ? `local:${LOCAL_ROOT}` : "0.9.1",
        reason: "requires_app >=1.0.0",
      }),
    );
  }

  it.each(rows)(
    "health=%s devMonorepo=%s source=%s gateOk=%s skipAttach=%s",
    async (health, devMono, src, gateOk, skipAttach) => {
      const probes = makeProbes({
        healthProbe: vi.fn().mockResolvedValue(
          health ? { running: true, starter: "Electron", url: "http://localhost:8000" } : { running: false },
        ),
        existsSync: vi.fn().mockReturnValue(true),
      });
      const onFallThrough = vi.fn();
      const runtime: RuntimeLaunchInputs = {
        effectiveSource: src,
        local: { runtimeId: `local:${LOCAL_ROOT}`, root: LOCAL_ROOT },
        overlays: [{ runtimeId: "0.9.1", root: OVERLAY_ROOT }],
        gate: () => (gateOk ? { ok: true } : { ok: false, code: "requires_app", message: "requires_app >=1.0.0" }),
        onFallThrough,
      };
      const result = await selectLaunchSource(
        baseOpts({ isPackaged: !devMono, cwd: "/repo", probes, runtime, skipAttach }),
      );
      const want = expected(health, devMono, src, gateOk, skipAttach);
      expect(result.kind).toBe(want);
      if (skipAttach) {
        expect(result.kind).not.toBe("attach");
        expect(probes.healthProbe).not.toHaveBeenCalled();
      }
      assertRuntimeShape(result);
      // A gate failure on a considered candidate falls through AND records lastFailure.
      assertFallThrough(onFallThrough, want === "bundled" && src !== "bundled" && !gateOk, src);
    },
  );

  it("tries overlays in the given order (pending before current) and falls through per candidate", async () => {
    const onFallThrough = vi.fn();
    const result = await selectLaunchSource(
      baseOpts({
        probes: makeProbes({ existsSync: vi.fn().mockReturnValue(true) }),
        runtime: {
          effectiveSource: "npm",
          overlays: [
            { runtimeId: "0.9.2", root: "/rt/versions/0.9.2" },
            { runtimeId: "0.9.1", root: "/rt/versions/0.9.1" },
          ],
          gate: (c) =>
            c.runtimeId === "0.9.2"
              ? { ok: false, code: "node_engines", message: "node_engines ^26" }
              : { ok: true },
          onFallThrough,
        },
      }),
    );
    expect(result).toMatchObject({ kind: "overlay", runtimeId: "0.9.1" });
    expect(onFallThrough).toHaveBeenCalledTimes(1);
    expect(onFallThrough).toHaveBeenCalledWith({ kind: "overlay", runtimeId: "0.9.2", reason: "node_engines ^26" });
  });

  it("an overlay whose server entry is missing falls through with missing_file", async () => {
    const onFallThrough = vi.fn();
    const bundledCli = getBundledCliPath("/fake/resources");
    const result = await selectLaunchSource(
      baseOpts({
        probes: makeProbes({ existsSync: vi.fn().mockImplementation((p: string) => p === bundledCli) }),
        runtime: {
          effectiveSource: "github",
          overlays: [{ runtimeId: "0.9.1", root: "/rt/versions/0.9.1" }],
          gate: () => ({ ok: true }),
          onFallThrough,
        },
      }),
    );
    expect(result.kind).toBe("bundled");
    expect(onFallThrough).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeId: "0.9.1", reason: expect.stringContaining("missing_file") }),
    );
  });

  it("a linked checkout whose server entry is missing falls through with missing_file", async () => {
    const onFallThrough = vi.fn();
    const bundledCli = getBundledCliPath("/fake/resources");
    const result = await selectLaunchSource(
      baseOpts({
        probes: makeProbes({ existsSync: vi.fn().mockImplementation((p: string) => p === bundledCli) }),
        runtime: {
          effectiveSource: "local",
          local: { runtimeId: "local:/r/co", root: "/r/co" },
          overlays: [{ runtimeId: "0.9.1", root: "/rt/versions/0.9.1" }],
          gate: () => ({ ok: true }),
          onFallThrough,
        },
      }),
    );
    expect(result.kind).toBe("bundled");
    expect(onFallThrough).toHaveBeenCalledTimes(1);
    expect(onFallThrough).toHaveBeenCalledWith({
      kind: "localLink",
      runtimeId: "local:/r/co",
      reason: `missing_file ${getLocalCliPath("/r/co")}`,
    });
  });

  it("no runtime inputs → today's behaviour (bundled)", async () => {
    const cliPath = getBundledCliPath("/fake/resources");
    const result = await selectLaunchSource(
      baseOpts({ probes: makeProbes({ existsSync: vi.fn().mockImplementation((p: string) => p === cliPath) }) }),
    );
    expect(result.kind).toBe("bundled");
  });

  it("pinned localLink throws when the effective source is not local", async () => {
    await expect(
      selectLaunchSource(
        baseOpts({
          preferOverride: "localLink",
          probes: makeProbes({ existsSync: vi.fn().mockReturnValue(true) }),
          runtime: { effectiveSource: "npm", local: { runtimeId: "local:/r/co", root: "/r/co" } },
        }),
      ),
    ).rejects.toBeInstanceOf(PinnedSourceUnavailableError);
  });
});

// ── deadline mapping (E23) ────────────────────────────────────────────────────

describe("getServerReadyDeadlineMs (E23)", () => {
  it.each([
    ["devMonorepo", 60_000],
    ["localLink", 60_000],
    ["overlay", 15_000],
    ["bundled", 15_000],
  ] as const)("%s → %d ms", (kind, ms) => {
    expect(getServerReadyDeadlineMs(kind)).toBe(ms);
  });
});

// ── D8: runtime identity env stamped on the spawned server ───────────────────
// See change: electron-runtime-overlay-updates.

describe("runtimeIdentityEnv (D8 active extension dir)", () => {
  const res = "/res";
  const dir = "/rt";
  it("overlay → the overlay's installed extension package", () => {
    const env = runtimeIdentityEnv({ kind: "overlay", cliPath: "c", cwd: "w", runtimeId: "0.9.1" }, res, dir);
    expect(env.PI_DASHBOARD_RUNTIME_ID).toBe("0.9.1");
    expect(env.PI_DASHBOARD_EXTENSION_DIR).toMatch(/0\.9\.1.*node_modules.*@blackbelt-technology.*pi-dashboard-extension$/);
  });
  it("local link → <checkout>/packages/extension", () => {
    const env = runtimeIdentityEnv({ kind: "localLink", cliPath: "c", cwd: "w", runtimeId: "local:/r/co" }, res, dir);
    expect(env.PI_DASHBOARD_EXTENSION_DIR?.split(/[\\/]/).slice(-4)).toEqual(["r", "co", "packages", "extension"]);
  });
  it("bundled → resources/server/packages/extension", () => {
    const env = runtimeIdentityEnv({ kind: "bundled", cliPath: "c", cwd: "w" }, res, dir);
    expect(env.PI_DASHBOARD_EXTENSION_DIR?.split(/[\\/]/).slice(-4)).toEqual(["res", "server", "packages", "extension"]);
  });
  it("devMonorepo registers no extension → no convergence target", () => {
    const env = runtimeIdentityEnv({ kind: "devMonorepo", cliPath: "c", cwd: "w" }, res, dir);
    expect(env.PI_DASHBOARD_EXTENSION_DIR).toBeUndefined();
    expect(env.PI_DASHBOARD_RUNTIME_ID).toBe("devMonorepo");
  });
});
