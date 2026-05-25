/**
 * Unit tests for deriveWindowsBuildVersion().
 *
 * Background: `@electron/packager`'s `resedit.js` writes Windows PE
 * VERSIONINFO (FileVersion + ProductVersion) by calling
 * `parseVersionString`, which only accepts MAJOR.MINOR.BUILD[.REVISION]
 * with integer components. SemVer prereleases like
 *   "0.5.3-ci.20260525-141712.feat-enable-standalo.2206c1e"
 * — produced by ci-electron.yml's slug step — are rejected and the
 * Windows leg of the matrix fails.
 *
 * `deriveWindowsBuildVersion` produces a Windows-safe 4-integer string
 * from the base SemVer triple + GITHUB_RUN_NUMBER. Used by
 * forge.config.ts as `packagerConfig.buildVersion`. Defaults to
 * `appVersion` are kept for macOS / app.getVersion() / CFBundle*
 * strings.
 *
 * See change: fix-ci-electron-windows-resedit (this proposal).
 */
import { describe, it, expect } from "vitest";

import { deriveWindowsBuildVersion } from "../build-version.js";

describe("deriveWindowsBuildVersion", () => {
  it("plain release version: appends run number as 4th component", () => {
    expect(deriveWindowsBuildVersion("0.5.3", "42")).toBe("0.5.3.42");
  });

  it("ci-electron prerelease slug: keeps base triple, drops suffix, appends run", () => {
    expect(
      deriveWindowsBuildVersion(
        "0.5.3-ci.20260525-141712.feat-enable-standalo.2206c1e",
        "42",
      ),
    ).toBe("0.5.3.42");
  });

  it("missing run number: 4th component defaults to 0", () => {
    expect(deriveWindowsBuildVersion("1.2.3", undefined)).toBe("1.2.3.0");
  });

  it("empty-string run number: 4th component defaults to 0", () => {
    expect(deriveWindowsBuildVersion("1.2.3", "")).toBe("1.2.3.0");
  });

  it("non-integer run number: 4th component defaults to 0", () => {
    expect(deriveWindowsBuildVersion("1.2.3", "abc")).toBe("1.2.3.0");
  });

  it("malformed pkgVersion: all components default to 0", () => {
    expect(deriveWindowsBuildVersion("not-a-version", "42")).toBe("0.0.0.42");
  });

  it("empty pkgVersion: all components default to 0", () => {
    expect(deriveWindowsBuildVersion("", "42")).toBe("0.0.0.42");
  });

  it("multi-digit components are preserved", () => {
    expect(deriveWindowsBuildVersion("12.34.567", "8901")).toBe(
      "12.34.567.8901",
    );
  });

  it("result is always 4 dot-separated integers (Windows VERSIONINFO contract)", () => {
    const cases: Array<[string, string | undefined]> = [
      ["0.5.3", "42"],
      ["0.5.3-ci.xyz", "1"],
      ["", undefined],
      ["garbage", "abc"],
      ["1.2.3-rc.1+build.7", "999"],
    ];
    for (const [pkg, run] of cases) {
      const result = deriveWindowsBuildVersion(pkg, run);
      expect(result).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    }
  });
});
