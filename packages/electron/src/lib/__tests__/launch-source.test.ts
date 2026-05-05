/**
 * Unit tests for selectLaunchSource() and parsePreferOverride().
 *
 * All I/O probes are injected as mocks — no real filesystem, network, or
 * child processes. The extracted source always succeeds (fallback of last resort).
 */
import { describe, it, expect, vi } from "vitest";
import path from "node:path";

// Stub dependency-installer BEFORE importing launch-source so the runtime
// baseline install (`installStandalone()`) doesn't run real npm/fs work
// during tests. The production code calls it after extractBundle in the
// `extracted` source path; tests only need to verify the wiring.
vi.mock("../dependency-installer.js", () => ({
  installStandalone: vi.fn().mockResolvedValue(undefined),
}));

import {
  selectLaunchSource,
  parsePreferOverride,
  PinnedSourceUnavailableError,
  extractedSourceIsHealthy,
  type LaunchSourceOpts,
  type LaunchSourceProbes,
} from "../launch-source.js";
import * as bundleExtract from "../bundle-extract.js";
import * as depInstaller from "../dependency-installer.js";

// ── Probe factory ─────────────────────────────────────────────────────────────

/** Build a probe set where every probe returns "not found" / "not running". */
function makeProbes(overrides: Partial<LaunchSourceProbes> = {}): Partial<LaunchSourceProbes> {
  return {
    healthProbe: vi.fn().mockResolvedValue({ running: false }),
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }),
    which: vi.fn().mockResolvedValue(null),
    spawnVersion: vi.fn().mockResolvedValue(null),
    realpathSync: vi.fn().mockImplementation((p: string) => p),
    requireResolve: vi.fn().mockImplementation(() => {
      throw new Error("Cannot resolve");
    }),
    ...overrides,
  };
}

/** Common base opts (packaged=true so devMonorepo never fires by default). */
function baseOpts(overrides: Partial<LaunchSourceOpts> = {}): LaunchSourceOpts {
  return {
    isPackaged: true,
    cwd: "/fake/cwd",
    preferOverride: null,
    bundledMinVersion: "0.1.0",
    resourcesPath: "/fake/resources",
    port: 8000,
    ...overrides,
  };
}

// ── 1. attach ─────────────────────────────────────────────────────────────────

it("1. returns attach when health probe reports running", async () => {
  const probes = makeProbes({
    healthProbe: vi.fn().mockResolvedValue({
      running: true,
      starter: "Bridge",
      url: "http://localhost:8000",
    }),
  });
  const result = await selectLaunchSource(baseOpts({ probes }));
  expect(result).toEqual({ kind: "attach", url: "http://localhost:8000", starter: "Bridge" });
});

// ── 2. devMonorepo ────────────────────────────────────────────────────────────

it("2. returns devMonorepo when not packaged and both files exist", async () => {
  const probes = makeProbes({
    existsSync: vi.fn().mockImplementation((p: string) => {
      return p.includes("cli.ts") || p.includes("bridge.ts");
    }),
  });
  const result = await selectLaunchSource(
    baseOpts({ isPackaged: false, cwd: "/repo", probes }),
  );
  expect(result.kind).toBe("devMonorepo");
  expect((result as any).cliPath).toContain("cli.ts");
  expect((result as any).cwd).toBe("/repo");
});

// ── 3. piExtension ────────────────────────────────────────────────────────────

it("3. returns piExtension when settings.json has a valid bridge entry with resolvable server", async () => {
  const settings = JSON.stringify({
    extensions: [
      { path: "/home/user/.pi/extensions/pi-agent-dashboard/src/bridge.ts" },
    ],
  });
  const serverPkg = JSON.stringify({ version: "1.0.0" });

  const probes = makeProbes({
    readFileSync: vi.fn().mockImplementation((p: string) => {
      if (p.includes("settings.json")) return settings;
      if (p.includes("pi-dashboard-server") && p.endsWith("package.json")) return serverPkg;
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }),
    existsSync: vi.fn().mockImplementation((p: string) => {
      return p.includes("bridge.ts");
    }),
    requireResolve: vi.fn().mockReturnValue(
      "/home/user/.pi/extensions/node_modules/@blackbelt-technology/pi-dashboard-server/package.json",
    ),
    spawnVersion: vi.fn().mockResolvedValue("1.0.0"),
  });

  const result = await selectLaunchSource(baseOpts({ probes }));
  expect(result.kind).toBe("piExtension");
  expect((result as any).cliPath).toContain("cli.ts");
});

// ── 4. npmGlobal ──────────────────────────────────────────────────────────────

it("4. returns npmGlobal when which returns a path not under resourcesPath with good version", async () => {
  const probes = makeProbes({
    which: vi.fn().mockResolvedValue("/usr/local/bin/pi-dashboard"),
    realpathSync: vi.fn().mockReturnValue("/usr/local/bin/pi-dashboard"),
    spawnVersion: vi.fn().mockResolvedValue("1.0.0"),
    requireResolve: vi.fn().mockReturnValue(
      "/usr/local/lib/node_modules/@blackbelt-technology/pi-dashboard-server/package.json",
    ),
  });

  const result = await selectLaunchSource(baseOpts({ probes }));
  expect(result.kind).toBe("npmGlobal");
  expect((result as any).cliPath).toContain("cli.ts");
});

// ── 5. extracted (fallback) ───────────────────────────────────────────────────

it("5. falls back to extracted when all other probes fail", async () => {
  const probes = makeProbes();
  const result = await selectLaunchSource(baseOpts({ probes }));
  expect(result.kind).toBe("extracted");
});

// ── 6. override pin success ───────────────────────────────────────────────────

it("6. override pin success: uses npmGlobal when DASHBOARD_PREFER_SOURCE=npmGlobal and probe passes", async () => {
  const probes = makeProbes({
    which: vi.fn().mockResolvedValue("/usr/local/bin/pi-dashboard"),
    realpathSync: vi.fn().mockReturnValue("/usr/local/bin/pi-dashboard"),
    spawnVersion: vi.fn().mockResolvedValue("1.0.0"),
    requireResolve: vi.fn().mockReturnValue(
      "/usr/local/lib/node_modules/@blackbelt-technology/pi-dashboard-server/package.json",
    ),
  });

  const result = await selectLaunchSource(
    baseOpts({ preferOverride: "npmGlobal", probes }),
  );
  expect(result.kind).toBe("npmGlobal");
});

// ── 7. override pin fail ──────────────────────────────────────────────────────

it("7. override pin fail: throws PinnedSourceUnavailableError when pinned source unavailable", async () => {
  const probes = makeProbes({
    which: vi.fn().mockResolvedValue(null), // npmGlobal unavailable
  });

  await expect(
    selectLaunchSource(baseOpts({ preferOverride: "npmGlobal", probes })),
  ).rejects.toBeInstanceOf(PinnedSourceUnavailableError);
});

// ── 8. default precedence walk ────────────────────────────────────────────────

it("8. walks full chain to extracted when all real probes fail", async () => {
  // Same as test 5, but explicitly verifying no earlier source is chosen.
  const probes = makeProbes();
  const result = await selectLaunchSource(
    baseOpts({ isPackaged: true, probes }),
  );
  expect(result.kind).toBe("extracted");
});

// ── 9. version gate ───────────────────────────────────────────────────────────

it("9. version gate: piExtension skipped when server version below bundledMinVersion", async () => {
  const settings = JSON.stringify({
    extensions: [
      { path: "/home/user/.pi/extensions/pi-agent-dashboard/src/bridge.ts" },
    ],
  });
  const serverPkg = JSON.stringify({ version: "0.0.1" }); // below "1.0.0"

  const probes = makeProbes({
    readFileSync: vi.fn().mockImplementation((p: string) => {
      if (p.includes("settings.json")) return settings;
      if (p.includes("pi-dashboard-server") && p.endsWith("package.json")) return serverPkg;
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }),
    existsSync: vi.fn().mockImplementation((p: string) => p.includes("bridge.ts")),
    requireResolve: vi.fn().mockReturnValue(
      "/home/user/.pi/extensions/node_modules/@blackbelt-technology/pi-dashboard-server/package.json",
    ),
    spawnVersion: vi.fn().mockResolvedValue("0.0.1"),
  });

  // With bundledMinVersion=1.0.0 and server at 0.0.1, piExtension should be skipped.
  const result = await selectLaunchSource(
    baseOpts({ bundledMinVersion: "1.0.0", probes }),
  );
  // Should fall through to extracted.
  expect(result.kind).toBe("extracted");
});

// ── 10. invalid override ──────────────────────────────────────────────────────

describe("parsePreferOverride", () => {
  it("10. returns null and warns on invalid DASHBOARD_PREFER_SOURCE value", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = parsePreferOverride({ DASHBOARD_PREFER_SOURCE: "bogus" });
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain("bogus");
    warnSpy.mockRestore();
  });

  it("returns null when DASHBOARD_PREFER_SOURCE is unset", () => {
    expect(parsePreferOverride({})).toBeNull();
  });

  it("returns valid SourceKind for known values", () => {
    expect(parsePreferOverride({ DASHBOARD_PREFER_SOURCE: "npmGlobal" })).toBe("npmGlobal");
    expect(parsePreferOverride({ DASHBOARD_PREFER_SOURCE: "extracted" })).toBe("extracted");
  });
});

// ── 12. extracted source triggers runtime baseline install ─────────────────
//
// Phase C bring-up gap: the bundled `resources/server/` does NOT include
// pi-coding-agent / jiti (by design — see bundle-server.mjs). The spawned
// server cannot resolve jiti to load TS source unless `installStandalone()`
// has populated `~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent`
// from the offline cacache before the spawn. Pin the call site here so a
// future refactor cannot silently drop the install step.
it("12. extracted: installStandalone is called after extractBundle when didExtract=true", async () => {
  const extractSpy = vi
    .spyOn(bundleExtract, "extractBundle")
    .mockImplementation(() => {});
  const installMock = vi.mocked(depInstaller.installStandalone);
  installMock.mockClear();
  const probes = makeProbes({
    // existsSync(managedDir) === false → needsExtraction returns true
    existsSync: vi.fn().mockReturnValue(false),
  });

  const result = await selectLaunchSource(
    baseOpts({ resourcesPath: "/fake/resources", probes }),
  );

  expect(result.kind).toBe("extracted");
  expect(extractSpy).toHaveBeenCalledOnce();
  expect(installMock).toHaveBeenCalledOnce();
  // Order matters: extractBundle must run BEFORE installStandalone (npm needs
  // managedDir to exist to write into).
  const extractOrder = extractSpy.mock.invocationCallOrder[0];
  const installOrder = installMock.mock.invocationCallOrder[0];
  expect(extractOrder).toBeLessThan(installOrder!);
  extractSpy.mockRestore();
});

// ── 11. extracted source path is <resourcesPath>/server ──────────────────────
//
// Regression for the Windows ZIP launch failure: passing the entire Electron
// resourcesPath (which contains app.asar — a file) to extractBundle causes
// `cpSync(…, { recursive: true })` to opendir(app.asar) and fail with ENOTDIR.
// The bundle layout produced by bundle-server.mjs lives at <resourcesPath>/server,
// and the cliPath under managedDir/node_modules/…/cli.ts only resolves when
// that subdir is the source.
it("11. extracted: extractBundle is called with <resourcesPath>/server as sourceDir", async () => {
  const spy = vi
    .spyOn(bundleExtract, "extractBundle")
    .mockImplementation(() => {});
  const probes = makeProbes({
    // existsSync(managedDir) === false → needsExtraction returns true
    existsSync: vi.fn().mockReturnValue(false),
  });
  const opts = baseOpts({ resourcesPath: "/fake/resources", probes });

  const result = await selectLaunchSource(opts);

  expect(result.kind).toBe("extracted");
  expect(spy).toHaveBeenCalledOnce();
  // Args: (managedDir, sourceDir, currentVersion, migrateDir, fs)
  const sourceArg = spy.mock.calls[0]![1] as string;
  expect(sourceArg).toBe(path.join("/fake/resources", "server"));
  // Defensive: never the bare resourcesPath (regression against ENOTDIR bug).
  expect(sourceArg).not.toBe("/fake/resources");
  spy.mockRestore();
});

// ── extractedSourceIsHealthy ───────────────────────────────────────────────

describe("extractedSourceIsHealthy", () => {
  it("returns false when cliPath does not exist", () => {
    const result = extractedSourceIsHealthy("/missing/cli.ts", {
      existsSync: () => false,
      resolveJitiFromAnchor: () => "file:///should-not-be-called",
    });
    expect(result).toBe(false);
  });

  it("returns true when cliPath exists and jiti is reachable", () => {
    const result = extractedSourceIsHealthy("/managed/cli.ts", {
      existsSync: () => true,
      resolveJitiFromAnchor: () => "file:///jiti/lib/jiti-register.mjs",
    });
    expect(result).toBe(true);
  });

  it("returns false when cliPath exists but jiti cannot be resolved", () => {
    const result = extractedSourceIsHealthy("/managed/cli.ts", {
      existsSync: () => true,
      resolveJitiFromAnchor: () => null,
    });
    expect(result).toBe(false);
  });

  it("returns false when existsSync throws", () => {
    const result = extractedSourceIsHealthy("/managed/cli.ts", {
      existsSync: () => { throw new Error("EACCES"); },
      resolveJitiFromAnchor: () => "file:///jiti/lib/jiti-register.mjs",
    });
    expect(result).toBe(false);
  });

  it("returns false when resolveJitiFromAnchor throws", () => {
    const result = extractedSourceIsHealthy("/managed/cli.ts", {
      existsSync: () => true,
      resolveJitiFromAnchor: () => { throw new Error("createRequire failed"); },
    });
    expect(result).toBe(false);
  });

  it("returns false when resolveJitiFromAnchor returns empty string", () => {
    const result = extractedSourceIsHealthy("/managed/cli.ts", {
      existsSync: () => true,
      resolveJitiFromAnchor: () => "",
    });
    expect(result).toBe(false);
  });
});
