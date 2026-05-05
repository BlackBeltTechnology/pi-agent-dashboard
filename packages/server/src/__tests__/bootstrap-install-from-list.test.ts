/**
 * Integration tests for bootstrapInstallFromList.
 *
 * All file I/O and install calls are injected via opts so no real
 * filesystem or subprocesses are touched.
 *
 * See change: simplify-electron-bootstrap-derived-state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBootstrapState } from "../bootstrap-state.js";
import {
  bootstrapInstallFromList,
  type PackageInstaller,
} from "../bootstrap-install-from-list.js";
import type { InstallablePackage, InstallableList } from "@blackbelt-technology/pi-dashboard-shared/installable-list.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makePackage(overrides: Partial<InstallablePackage> = {}): InstallablePackage {
  return {
    name: "test-pkg",
    version: "1.0.0",
    required: true,
    kind: "npm",
    ...overrides,
  };
}

function makeList(packages: InstallablePackage[]): InstallableList {
  return { version: "1", packages };
}

/**
 * Build a `bootstrapInstallFromList` opts object that bypasses all real I/O.
 * - `listResult`: the installable list (null = file absent).
 * - `installedNames`: package names that are already installed.
 * - `npmInstall`/`piInstall`: injectable install fns (default: succeed).
 */
interface FakeOpts {
  listResult: InstallableList | null;
  installedNames?: string[];
  npmInstall?: PackageInstaller;
  piInstall?: PackageInstaller;
}

function buildOpts(fake: FakeOpts, extra?: object) {
  const installedSet = new Set(fake.installedNames ?? []);
  return {
    configDir: "/fake/config",
    managedDir: "/fake/managed",
    isInstalled: (pkg: InstallablePackage) => installedSet.has(pkg.name),
    npmInstall: fake.npmInstall ?? (async () => { /* succeed */ }),
    piInstall: fake.piInstall ?? (async () => { /* succeed */ }),
    // Override readInstallableList via module mock — done per test via vi.mock
    // (see below). We instead inject listResult via a wrapping helper.
    ...extra,
  };
}

// We cannot easily mock `readInstallableList` without vi.mock at module level.
// Instead we factor out a testable inner function and re-export it.
// Since we cannot easily mock the module import inside bootstrapInstallFromList,
// we use a different approach: inject a `_readList` seam via opts.
//
// However, the current public API doesn't expose that seam. We'll test via
// the observable side effects (bootstrap state + thrown errors) and fake the
// injectable installers. For the list itself, we monkey-patch the module.
//
// Pragmatic solution: use vi.mock to replace readInstallableList.

vi.mock("@blackbelt-technology/pi-dashboard-shared/installable-list.js", () => ({
  readInstallableList: vi.fn(),
}));

import { readInstallableList } from "@blackbelt-technology/pi-dashboard-shared/installable-list.js";
const mockReadList = vi.mocked(readInstallableList);

// ── Tests ──────────────────────────────────────────────────────────────────

describe("bootstrapInstallFromList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: no installable.json (Bridge/Standalone parity) ──────────────

  describe("file-absent path", () => {
    it("returns immediately without setting installable state or calling any installer", async () => {
      mockReadList.mockResolvedValue(null);
      const state = createBootstrapState();
      const npmInstall = vi.fn();
      const piInstall = vi.fn();

      await bootstrapInstallFromList(state, {
        configDir: "/fake/config",
        managedDir: "/fake/managed",
        npmInstall,
        piInstall,
        isInstalled: () => false,
      });

      // No installer calls.
      expect(npmInstall).not.toHaveBeenCalled();
      expect(piInstall).not.toHaveBeenCalled();

      // installable field NOT set (file was absent — no tracking started).
      expect(state.get().installable).toBeUndefined();

      // Status remains ready.
      expect(state.get().status).toBe("ready");
    });
  });

  // ── Test 2: synthetic installable.json ──────────────────────────────────

  describe("with installable.json present", () => {
    it("skips already-installed npm package, installs missing required + optional, final state is correct", async () => {
      const alreadyInstalled = makePackage({ name: "already-installed-pkg", required: false });
      const missingRequired = makePackage({ name: "missing-required-pkg", required: true });
      const missingOptional = makePackage({ name: "missing-optional-pkg", required: false });

      mockReadList.mockResolvedValue(
        makeList([alreadyInstalled, missingRequired, missingOptional]),
      );

      const state = createBootstrapState();
      const npmInstall = vi.fn().mockResolvedValue(undefined);

      await bootstrapInstallFromList(state, {
        configDir: "/fake/config",
        managedDir: "/fake/managed",
        npmInstall,
        piInstall: vi.fn(),
        isInstalled: (pkg) => pkg.name === "already-installed-pkg",
      });

      // Two install calls (already-installed skipped).
      expect(npmInstall).toHaveBeenCalledTimes(2);
      expect(npmInstall.mock.calls[0][0].name).toBe("missing-required-pkg");
      expect(npmInstall.mock.calls[1][0].name).toBe("missing-optional-pkg");

      // Final state: installed=3 (1 pre-installed + 2 freshly installed), failed=0.
      const installable = state.get().installable;
      expect(installable).toBeDefined();
      expect(installable!.total).toBe(3);
      expect(installable!.installed).toBe(3);
      expect(installable!.failed).toHaveLength(0);

      // Status remains ready (no error).
      expect(state.get().status).toBe("ready");
    });

    it("installs pi-extension packages via piInstall", async () => {
      const pkg = makePackage({ name: "my-extension", kind: "pi-extension", required: true });
      mockReadList.mockResolvedValue(makeList([pkg]));

      const state = createBootstrapState();
      const piInstall = vi.fn().mockResolvedValue(undefined);
      const npmInstall = vi.fn();

      await bootstrapInstallFromList(state, {
        configDir: "/fake/config",
        managedDir: "/fake/managed",
        npmInstall,
        piInstall,
        isInstalled: () => false,
      });

      expect(piInstall).toHaveBeenCalledOnce();
      expect(npmInstall).not.toHaveBeenCalled();
      expect(piInstall.mock.calls[0][0].name).toBe("my-extension");
    });

    it("optional package failure is recorded in failed[] but does not throw", async () => {
      const optionalFail = makePackage({ name: "optional-bad", required: false });
      mockReadList.mockResolvedValue(makeList([optionalFail]));

      const state = createBootstrapState();
      const npmInstall = vi.fn().mockRejectedValue(new Error("network error"));

      await expect(
        bootstrapInstallFromList(state, {
          configDir: "/fake/config",
          managedDir: "/fake/managed",
          npmInstall,
          piInstall: vi.fn(),
          isInstalled: () => false,
        }),
      ).resolves.toBeUndefined();

      const installable = state.get().installable;
      expect(installable!.failed).toEqual(["optional-bad"]);
      expect(installable!.installed).toBe(0);
      expect(state.get().status).toBe("ready");
    });

    it("required package failure sets status=failed and throws", async () => {
      const requiredFail = makePackage({ name: "required-bad", required: true });
      mockReadList.mockResolvedValue(makeList([requiredFail]));

      const state = createBootstrapState();
      const npmInstall = vi.fn().mockRejectedValue(new Error("disk full"));

      await expect(
        bootstrapInstallFromList(state, {
          configDir: "/fake/config",
          managedDir: "/fake/managed",
          npmInstall,
          piInstall: vi.fn(),
          isInstalled: () => false,
        }),
      ).rejects.toThrow('Required package "required-bad" failed to install');

      expect(state.get().status).toBe("failed");
      expect(state.get().error?.message).toContain("required-bad");
    });

    it("deprecated and defaultOff packages are skipped entirely", async () => {
      const deprecated = makePackage({ name: "old-pkg", deprecated: true });
      const defaultOff = makePackage({ name: "opt-pkg", defaultOff: true });
      const normal = makePackage({ name: "normal-pkg", required: true });
      mockReadList.mockResolvedValue(makeList([deprecated, defaultOff, normal]));

      const state = createBootstrapState();
      const npmInstall = vi.fn().mockResolvedValue(undefined);

      await bootstrapInstallFromList(state, {
        configDir: "/fake/config",
        managedDir: "/fake/managed",
        npmInstall,
        piInstall: vi.fn(),
        isInstalled: () => false,
      });

      // Only "normal-pkg" is processed (total=1, not 3).
      expect(npmInstall).toHaveBeenCalledOnce();
      expect(state.get().installable!.total).toBe(1);
    });

    it("emits progress steps during install", async () => {
      const pkg = makePackage({ name: "tracked-pkg" });
      mockReadList.mockResolvedValue(makeList([pkg]));

      const state = createBootstrapState();
      const progressSteps: string[] = [];
      state.subscribe((s) => {
        if (s.progress) progressSteps.push(s.progress.step);
      });

      const npmInstall = vi.fn().mockResolvedValue(undefined);

      await bootstrapInstallFromList(state, {
        configDir: "/fake/config",
        managedDir: "/fake/managed",
        npmInstall,
        piInstall: vi.fn(),
        isInstalled: () => false,
      });

      expect(progressSteps).toContain("tracked-pkg");
    });
  });
});
