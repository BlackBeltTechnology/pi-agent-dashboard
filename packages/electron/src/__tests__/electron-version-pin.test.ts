/**
 * Pin the Electron runtime version and the declared macOS floor.
 *
 * Covers test-plan scenarios E1 (literal semver pin), E2 (supported-line
 * major floor) and E3 (declared LSMinimumSystemVersion). Textual assertions
 * against the build config, matching the pattern of
 * `forge-config-windows-version.test.ts` — `forge.config.ts` evaluates env and
 * `process.platform` at import time, so the source text is the stable surface.
 *
 * Each assertion is paired with a fixture case that MUST fail, so the guard is
 * not vacuous.
 *
 * See change: upgrade-electron-runtime.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — plain .mjs module, no type declarations by design.
import { MACOS_FLOOR_MARKETING } from "../../scripts/macos-floor.mjs";

const electronRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const pkg = JSON.parse(
  fs.readFileSync(path.join(electronRoot, "package.json"), "utf8"),
);
const forgeSource = fs.readFileSync(
  path.join(electronRoot, "forge.config.ts"),
  "utf8",
);

/**
 * The literal-semver regex `app-builder-lib`'s `getElectronVersionFromInstalled`
 * effectively requires. A `^`/`~` range fails it and produces
 * `Cannot compute electron version from installed node modules` on the Windows
 * NSIS leg.
 */
const LITERAL_SEMVER = /^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/;

/** The lowest Electron major on a currently-supported release line. */
const MIN_SUPPORTED_MAJOR = 43;

describe("E1: the electron devDependency is a literal version, not a range", () => {
  const pinned: string = pkg.devDependencies.electron;

  it("matches the literal-semver regex", () => {
    expect(pinned).toMatch(LITERAL_SEMVER);
  });

  it.each(["^43.0.0", "~43.0.0", "^43.4.1", "latest", "43.x"])(
    "rejects the range spelling %s",
    (range) => {
      // Without these the regex assertion above would be vacuous.
      expect(range).not.toMatch(LITERAL_SEMVER);
    },
  );

  it("accepts a prerelease literal", () => {
    expect("44.0.0-beta.1").toMatch(LITERAL_SEMVER);
  });
});

describe("E2: the pinned major is on a supported release line", () => {
  const major = Number(String(pkg.devDependencies.electron).split(".")[0]);

  it(`is >= ${MIN_SUPPORTED_MAJOR}`, () => {
    expect(major).toBeGreaterThanOrEqual(MIN_SUPPORTED_MAJOR);
  });

  it.each([
    { version: "43.4.1", ok: true },
    { version: "44.0.0", ok: true },
    { version: "42.9.3", ok: false },
    { version: "32.3.3", ok: false },
  ])("$version → allowed=$ok", ({ version, ok }) => {
    const m = Number(version.split(".")[0]);
    expect(m >= MIN_SUPPORTED_MAJOR).toBe(ok);
  });
});

describe("E3: forge.config.ts declares the macOS floor", () => {
  it("sets extendInfo.LSMinimumSystemVersion to the shared floor constant", () => {
    expect(MACOS_FLOOR_MARKETING).toBe("12.0");
    expect(forgeSource).toMatch(
      new RegExp(
        `LSMinimumSystemVersion\\s*:\\s*["']${MACOS_FLOOR_MARKETING.replace(".", "\\.")}["']`,
      ),
    );
  });

  it("no longer declares the retired 10.15 floor as the live floor", () => {
    // The Catalina fixture value must fail: this is what makes the assertion
    // above non-vacuous.
    expect(forgeSource).not.toMatch(/LSMinimumSystemVersion\s*:\s*["']10\.15["']/);
    // Deliberately NOT a blanket ban on the string "10.15": the rationale
    // comment legitimately records WHY the floor moved (Electron dropped
    // 10.15 at v33), and a decision record must stay readable. What must not
    // survive is 10.15 stated as the CURRENT target.
    expect(forgeSource).not.toMatch(/MACOSX_DEPLOYMENT_TARGET=10\.15/);
    expect(forgeSource).not.toMatch(/support Catalina/i);
  });

  it("names the live floor by OS release, not just by number", () => {
    expect(forgeSource).toMatch(/Monterey/);
  });

  it("documents the three-point floor enforcement it still relies on", () => {
    expect(forgeSource).toMatch(/MACOSX_DEPLOYMENT_TARGET/);
    expect(forgeSource).toMatch(/otool|LC_BUILD_VERSION|minos/);
  });
});
