/**
 * Unit tests for isAppImageSelfHit — pure helper that flags candidate
 * binary paths as the running Electron AppImage launcher (self-hit).
 *
 * See change: fix-electron-appimage-cli-self-detection (D1).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isAppImageSelfHit } from "../../platform/binary-lookup.js";

describe("isAppImageSelfHit", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "appimage-self-hit-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it("returns false when no env vars are set and execPath is unrelated", () => {
    const candidate = path.join(tmpDir, "unrelated-binary");
    fs.writeFileSync(candidate, "#!/bin/sh\n");
    const result = isAppImageSelfHit(candidate, {
      execPath: "/totally/different/electron",
      appDir: undefined,
      appImage: undefined,
    });
    expect(result).toBe(false);
  });

  it("matches when candidate lives under APPDIR", () => {
    // Synthesize a fake AppImage mount layout under tmpDir.
    const appDir = path.join(tmpDir, "mount_PI-Das");
    fs.mkdirSync(appDir, { recursive: true });
    const candidate = path.join(appDir, "pi-dashboard");
    fs.writeFileSync(candidate, "#!/bin/sh\n");

    const result = isAppImageSelfHit(candidate, {
      execPath: "/some/other/electron",
      appDir,
      appImage: undefined,
    });
    expect(result).toBe(true);
  });

  it("does NOT match when APPDIR is set but candidate is outside it", () => {
    const appDir = path.join(tmpDir, "mount_PI-Das");
    fs.mkdirSync(appDir, { recursive: true });
    const candidate = path.join(tmpDir, "other-place", "pi-dashboard");
    fs.mkdirSync(path.dirname(candidate), { recursive: true });
    fs.writeFileSync(candidate, "#!/bin/sh\n");

    const result = isAppImageSelfHit(candidate, {
      execPath: "/some/other/electron",
      appDir,
      appImage: undefined,
    });
    expect(result).toBe(false);
  });

  it("matches when realpath of candidate equals realpath of APPIMAGE", () => {
    const appImage = path.join(tmpDir, "PI-Dashboard.AppImage");
    fs.writeFileSync(appImage, "AppImage payload");

    const symlink = path.join(tmpDir, "alias-link");
    fs.symlinkSync(appImage, symlink);

    const result = isAppImageSelfHit(symlink, {
      execPath: "/some/other/electron",
      appDir: undefined,
      appImage,
    });
    expect(result).toBe(true);
  });

  it("matches when realpath of candidate equals realpath of execPath", () => {
    const exec = path.join(tmpDir, "electron-binary");
    fs.writeFileSync(exec, "Electron");

    const symlink = path.join(tmpDir, "fake-pi-dashboard");
    fs.symlinkSync(exec, symlink);

    const result = isAppImageSelfHit(symlink, {
      execPath: exec,
      appDir: undefined,
      appImage: undefined,
    });
    expect(result).toBe(true);
  });

  it("does NOT match when execPath is unrelated to candidate", () => {
    const candidate = path.join(tmpDir, "real-cli");
    fs.writeFileSync(candidate, "#!/bin/sh\n");

    const exec = path.join(tmpDir, "electron-binary");
    fs.writeFileSync(exec, "Electron");

    const result = isAppImageSelfHit(candidate, {
      execPath: exec,
      appDir: undefined,
      appImage: undefined,
    });
    expect(result).toBe(false);
  });

  it("falls back to literal compare for broken-symlink / ENOENT candidates", () => {
    // Candidate path does not exist on disk.
    const candidate = path.join(tmpDir, "ghost");
    const exec = candidate; // exact-string match — should still match

    expect(() =>
      isAppImageSelfHit(candidate, {
        execPath: exec,
        appDir: undefined,
        appImage: undefined,
      }),
    ).not.toThrow();

    const result = isAppImageSelfHit(candidate, {
      execPath: exec,
      appDir: undefined,
      appImage: undefined,
    });
    expect(result).toBe(true);
  });

  it("does not throw when APPDIR points at a non-existent directory", () => {
    const candidate = path.join(tmpDir, "real-cli");
    fs.writeFileSync(candidate, "#!/bin/sh\n");
    const ghostAppDir = path.join(tmpDir, "does-not-exist");

    expect(() =>
      isAppImageSelfHit(candidate, {
        execPath: "/unrelated",
        appDir: ghostAppDir,
        appImage: undefined,
      }),
    ).not.toThrow();
  });

  it("falls back to reading process.env / process.execPath when opts is omitted", () => {
    const savedAppDir = process.env.APPDIR;
    const savedAppImage = process.env.APPIMAGE;
    try {
      // Construct a self-hit relative to the current process.execPath.
      // realpath(candidate) === realpath(process.execPath) → matches.
      const result = isAppImageSelfHit(process.execPath);
      // process.execPath always exists, so this should match.
      expect(result).toBe(true);
    } finally {
      if (savedAppDir === undefined) delete process.env.APPDIR;
      else process.env.APPDIR = savedAppDir;
      if (savedAppImage === undefined) delete process.env.APPIMAGE;
      else process.env.APPIMAGE = savedAppImage;
    }
  });
});
