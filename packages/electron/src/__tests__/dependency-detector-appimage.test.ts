/**
 * AppImage self-recursion guard unit tests for the registry-backed
 * detectors `detectPi` and `detectSystemNode`. The guard is applied
 * AFTER the registry resolves a path so future registry edits or
 * override-pinned bogus paths cannot slip an AppImage launcher
 * through.
 *
 * See change: fix-electron-appimage-cli-self-detection (D3, Tasks 3.2/3.4).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockResolve, mockHas, mockExecSync, mockExecFileSync, mockExistsSync, mockReaddirSync } = vi.hoisted(() => ({
  mockResolve: vi.fn(),
  mockHas: vi.fn(),
  mockExecSync: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockReaddirSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
}));

// node:fs is mocked so scanForUsableNodeOnDisk fallback cannot find
// real-host node binaries (~/.nvm, /usr/bin/node etc.) when the AppImage
// guard rejects the registry hit.
vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js", () => ({
  getDefaultRegistry: () => ({
    has: mockHas,
    resolve: mockResolve,
  }),
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/exec.js", () => ({
  execSync: mockExecSync,
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/npm.js", () => ({
  rootGlobalOr: () => "",
}));

import { detectPi, detectSystemNode } from "../lib/dependency-detector.js";

function makeResolution(over: Partial<{ ok: boolean; path: string | null; source: string }>) {
  return {
    name: "stub",
    ok: over.ok ?? true,
    path: over.path ?? "/usr/local/bin/stub",
    source: over.source ?? "system",
    tried: [],
    resolvedAt: 0,
  };
}

describe("detectPi AppImage symmetry guard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockHas.mockReturnValue(true);
  });

  it("rejects an APPDIR-mount candidate from the registry", () => {
    const savedAppDir = process.env.APPDIR;
    const fakeAppDir = "/tmp/.mount_PI-DET-PI";
    process.env.APPDIR = fakeAppDir;
    try {
      mockResolve.mockReturnValue(makeResolution({
        ok: true,
        path: fakeAppDir + "/pi",
        source: "system",
      }));

      const result = detectPi();
      expect(result.found).toBe(false);
    } finally {
      if (savedAppDir === undefined) delete process.env.APPDIR;
      else process.env.APPDIR = savedAppDir;
    }
  });

  it("returns ok for unrelated registry hits when APPDIR is unset", () => {
    const savedAppDir = process.env.APPDIR;
    delete process.env.APPDIR;
    try {
      mockResolve.mockReturnValue(makeResolution({
        ok: true,
        path: "/usr/local/bin/pi",
        source: "system",
      }));

      const result = detectPi();
      expect(result.found).toBe(true);
      expect(result.path).toBe("/usr/local/bin/pi");
    } finally {
      if (savedAppDir !== undefined) process.env.APPDIR = savedAppDir;
    }
  });
});

describe("detectSystemNode AppImage symmetry guard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockHas.mockReturnValue(true);
    // v22.19.0 is the engines floor — usable per isUsableNodeVersion. Both the
    // registry-result version check (execSync) and the scanForUsableNodeOnDisk
    // fallback (execFileSync) receive a passing version so the resolver chain is
    // deterministic and the APPDIR rejection is attributable to the guard, not
    // a version reject.
    mockExecSync.mockReturnValue("v22.19.0\n");
    mockExecFileSync.mockReturnValue("v22.19.0\n");
    // Fail-closed defaults for the fs probes used by
    // scanForUsableNodeOnDisk: no candidate exists on disk.
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
  });

  it("rejects an APPDIR-mount node candidate", () => {
    const savedAppDir = process.env.APPDIR;
    const fakeAppDir = "/tmp/.mount_PI-DET-NODE";
    process.env.APPDIR = fakeAppDir;
    try {
      mockResolve.mockReturnValue(makeResolution({
        ok: true,
        path: fakeAppDir + "/node",
        source: "system",
      }));

      const result = detectSystemNode();
      // .toMatchObject so the new `resolution` field (added by
      // consolidate-tool-resolution) does not break the assertion.
      expect(result).toMatchObject({ found: false });
    } finally {
      if (savedAppDir === undefined) delete process.env.APPDIR;
      else process.env.APPDIR = savedAppDir;
    }
  });

  it("returns ok for unrelated node hits with sufficient version", () => {
    const savedAppDir = process.env.APPDIR;
    delete process.env.APPDIR;
    try {
      mockResolve.mockReturnValue(makeResolution({
        ok: true,
        path: "/usr/local/bin/node",
        source: "system",
      }));

      const result = detectSystemNode();
      expect(result.found).toBe(true);
      expect(result.path).toBe("/usr/local/bin/node");
    } finally {
      if (savedAppDir !== undefined) process.env.APPDIR = savedAppDir;
    }
  });
});
