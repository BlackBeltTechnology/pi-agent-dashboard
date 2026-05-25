/**
 * Pin the Windows-only `appVersion` override in `forge.config.ts`.
 *
 * Background: @electron/packager's `dist/win32.js` wires the PE
 * VERSIONINFO fields like this:
 *
 *   productVersion: this.opts.appVersion              // ← no override path
 *   fileVersion:    this.opts.buildVersion || appVersion
 *
 * Both run through `parseVersionString`, which requires
 * MAJOR.MINOR.BUILD[.REVISION] integer components and rejects SemVer
 * prereleases like the slug ci-electron.yml produces. Setting
 * `packagerConfig.buildVersion` alone only fixes FileVersion;
 * ProductVersion still throws on the SemVer slug because the only
 * source path is `opts.appVersion`.
 *
 * The fix in forge.config.ts:
 *   ...(isWindowsBuildHost ? { appVersion: buildVersion } : {}),
 *
 * This test parses forge.config.ts as text (the file evaluates env
 * + process.platform at import time, so we keep this textual-pin
 * pattern consistent with the existing forge-config-dmg-naming
 * test). The regex must continue to match so a future refactor
 * doesn't silently drop the Windows override.
 *
 * See change: fix-ci-electron-windows-resedit.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORGE_CONFIG_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "forge.config.ts",
);

describe("forge.config.ts Windows VERSIONINFO override", () => {
  const source = fs.readFileSync(FORGE_CONFIG_PATH, "utf8");

  it("imports deriveWindowsBuildVersion from src/lib/build-version.js", () => {
    expect(source).toMatch(
      /import\s+\{\s*deriveWindowsBuildVersion\s*\}\s+from\s+["']\.\/src\/lib\/build-version\.js["']/,
    );
  });

  it("computes buildVersion from pkgVersion + GITHUB_RUN_NUMBER", () => {
    // Trailing comma after the last arg is allowed (matches the
    // multi-line, comma-suffixed Prettier style of the actual call).
    expect(source).toMatch(
      /deriveWindowsBuildVersion\s*\(\s*pkgVersion\s*,\s*process\.env\.GITHUB_RUN_NUMBER\s*,?\s*\)/,
    );
  });

  it("declares isWindowsBuildHost from process.platform === 'win32'", () => {
    expect(source).toMatch(
      /isWindowsBuildHost\s*=\s*process\.platform\s*===\s*["']win32["']/,
    );
  });

  it("sets packagerConfig.buildVersion unconditionally", () => {
    // Match `buildVersion,` inside packagerConfig (shorthand for buildVersion: buildVersion).
    expect(source).toMatch(/^\s*buildVersion\s*,/m);
  });

  it("sets packagerConfig.appVersion only on Windows build host", () => {
    expect(source).toMatch(
      /\.\.\.\s*\(\s*isWindowsBuildHost\s*\?\s*\{\s*appVersion\s*:\s*buildVersion\s*\}\s*:\s*\{\}\s*\)/,
    );
  });

  it("documents why the override is Windows-only (productVersion has no other escape hatch)", () => {
    // The comment must mention productVersion and the win32.js source
    // so future readers don't undo this without context.
    expect(source).toMatch(/productVersion/i);
    expect(source).toMatch(/win32\.js|VERSIONINFO|parseVersionString/);
  });

  it("sets appCopyright to a BlackBelt-branded string", () => {
    // Without this override, @electron/packager copies the Electron
    // framework's default "Copyright (C) 2015 GitHub, Inc." string into
    // Windows VERSIONINFO `LegalCopyright` and macOS
    // `NSHumanReadableCopyright`. The pin is a regex (year-tolerant) so a
    // future year bump doesn't break the test, but the BlackBelt token
    // must remain.
    expect(source).toMatch(
      /appCopyright\s*:\s*["']Copyright\s+\u00a9\s+\d{4}\s+BlackBelt Technology["']/,
    );
  });
});
