/**
 * Integration-level assertion: when APPDIR is set and the only
 * pi-dashboard hit on PATH is the AppImage launcher, `ensureServer()`
 * MUST NOT take the `launchViaCli()` branch. We verify this by
 * confirming the `detectPiDashboardCli` returns `{ found: false }` for
 * AppImage-only PATH — that's the gate `ensureServer` keys off.
 *
 * A full end-to-end test would require booting an HTTP server and
 * spawning a real child; the chain we care about is purely
 * `detectPiDashboardCli().found === false → fall through`.
 *
 * The structural source-level invariant (ensureServer still wires
 * `launchServer()` after the gated `cli.found && cli.path` branch)
 * lives in `server-lifecycle-spawn-options.test.ts` so it doesn't
 * conflict with the `node:fs` mock used here.
 *
 * See change: fix-electron-appimage-cli-self-detection (Task 5).
 */
import { describe, it, expect, vi } from "vitest";

const { mockExecSync, mockExistsSync, mockReadFileSync, mockNpmRootGlobalOr } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockReadFileSync: vi.fn(),
  mockNpmRootGlobalOr: vi.fn().mockReturnValue(""),
}));

vi.mock("node:child_process", () => ({ execSync: mockExecSync }));
vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/npm.js", () => ({
  rootGlobalOr: mockNpmRootGlobalOr,
}));

import { detectPiDashboardCli } from "../lib/dependency-detector.js";

describe("ensureServer falls through to launchServer when AppImage is the only hit", () => {
  it("detectPiDashboardCli returns {found:false} when APPDIR + AppImage path is the only hit", () => {
    const savedAppDir = process.env.APPDIR;
    const fakeAppDir = "/tmp/.mount_PI-Das-INT";
    process.env.APPDIR = fakeAppDir;
    try {
      mockExecSync.mockReturnValue(fakeAppDir + "/pi-dashboard\n");
      mockExistsSync.mockReturnValue(false);
      const result = detectPiDashboardCli();
      expect(result).toEqual({ found: false });
    } finally {
      if (savedAppDir === undefined) delete process.env.APPDIR;
      else process.env.APPDIR = savedAppDir;
    }
  });

  it("detectPiDashboardCli returns {found:false} when APPIMAGE realpath equals candidate", () => {
    const savedAppImage = process.env.APPIMAGE;
    process.env.APPIMAGE = process.execPath;
    try {
      mockExecSync.mockReturnValue(process.execPath + "\n");
      mockExistsSync.mockReturnValue(false);
      const result = detectPiDashboardCli();
      expect(result).toEqual({ found: false });
    } finally {
      if (savedAppImage === undefined) delete process.env.APPIMAGE;
      else process.env.APPIMAGE = savedAppImage;
    }
  });
});
