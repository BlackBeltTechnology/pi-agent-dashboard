/**
 * macos-alias native-module doctor predicate. Darwin-only DMG-maker
 * prerequisite: file present → ok, absent → warn, non-darwin / not-installed
 * → row omitted. See change: fix-darwin-dmg-maker-macos-alias.
 */
import { describe, it, expect } from "vitest";
import { checkMacosAliasVolume } from "../doctor-core.js";

const FAKE_DIR = "/fake/.pnpm/macos-alias@0.2.12/node_modules/macos-alias";

describe("checkMacosAliasVolume", () => {
  it("omits the row on non-darwin hosts", () => {
    for (const platform of ["linux", "win32"]) {
      const row = checkMacosAliasVolume({
        platform,
        resolveMacosAliasDir: () => FAKE_DIR,
        fileExists: () => true,
      });
      expect(row).toBeNull();
    }
  });

  it("omits the row when macos-alias is not installed", () => {
    const row = checkMacosAliasVolume({
      platform: "darwin",
      resolveMacosAliasDir: () => null,
      fileExists: () => true,
    });
    expect(row).toBeNull();
  });

  it("returns ok when volume.node is present", () => {
    const row = checkMacosAliasVolume({
      platform: "darwin",
      resolveMacosAliasDir: () => FAKE_DIR,
      fileExists: (p) => p === `${FAKE_DIR}/build/Release/volume.node`,
    });
    expect(row).not.toBeNull();
    expect(row?.name).toBe("macos-alias native module");
    expect(row?.status).toBe("ok");
    expect(row?.section).toBe("diagnostics");
  });

  it("returns warning + non-empty suggestion when volume.node is absent", () => {
    const row = checkMacosAliasVolume({
      platform: "darwin",
      resolveMacosAliasDir: () => FAKE_DIR,
      fileExists: () => false,
    });
    expect(row).not.toBeNull();
    expect(row?.status).toBe("warning");
    expect(row?.suggestion && row.suggestion.length > 0).toBe(true);
    expect(row?.detail).toContain("volume.node");
  });
});
