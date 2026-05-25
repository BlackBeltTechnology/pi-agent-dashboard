/**
 * Windows-safe build version derivation.
 *
 * `@electron/packager`'s `resedit.js` writes the Windows PE
 * VERSIONINFO resource (FileVersion + ProductVersion fields) by
 * calling `parseVersionString`, which only accepts
 *   MAJOR.MINOR.BUILD[.REVISION]
 * with integer components. SemVer prereleases like
 *   "0.5.3-ci.20260525-141712.feat-enable-standalo.2206c1e"
 * — the slug shape `ci-electron.yml` produces — are rejected and
 * the Windows leg of the matrix fails with
 *   Error: Incorrectly formatted version string: "..."
 *
 * This helper produces a Windows-safe 4-integer string from the base
 * SemVer triple + GITHUB_RUN_NUMBER. It is plugged into
 * `packagerConfig.buildVersion` in forge.config.ts, which maps to
 * Windows FileVersion / ProductVersion. The wider `appVersion`
 * default (= package.json#version, i.e. the full SemVer slug) is
 * preserved for `app.getVersion()` and macOS CFBundle* strings, so
 * users still see the full version inside the app.
 *
 * Pure function: imports nothing from electron / forge / fs / env;
 * env reads live in the caller (forge.config.ts) so this module is
 * unit-testable in isolation.
 */

/**
 * Returns a 4-integer dot-separated build version safe for the
 * Windows PE VERSIONINFO resource.
 *
 * @param pkgVersion   Any string; the first three integer components
 *                     (`MAJOR.MINOR.PATCH`) are extracted. Components
 *                     missing or non-integer default to 0.
 * @param runNumber    `process.env.GITHUB_RUN_NUMBER` or equivalent;
 *                     becomes the 4th component. Falls back to 0 when
 *                     undefined / empty / non-integer.
 */
export function deriveWindowsBuildVersion(
  pkgVersion: string,
  runNumber: string | undefined,
): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(pkgVersion);
  const major = match?.[1] ?? "0";
  const minor = match?.[2] ?? "0";
  const patch = match?.[3] ?? "0";
  const parsedRun = Number.parseInt(runNumber ?? "", 10);
  const build = Number.isFinite(parsedRun) ? parsedRun : 0;
  return `${major}.${minor}.${patch}.${build}`;
}
