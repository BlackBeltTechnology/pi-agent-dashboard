/**
 * Semver helpers for `PluginRequirements.piExtensionVersions`. Thin wrapper so
 * the validator and requirement probe share one `semver` dependency (shared
 * already declares it).
 * See change: move-subagents-to-plugin (D9).
 */
import semver from "semver";

/** True when `range` is a valid semver range string. */
export function isValidVersionRange(range: unknown): range is string {
  return typeof range === "string" && range.trim() !== "" && semver.validRange(range) !== null;
}

/** `true`/`false` for a parseable version, `undefined` when `version` is not semver. */
export function versionSatisfies(version: string | undefined, range: string): boolean | undefined {
  if (typeof version !== "string" || !semver.valid(version)) return undefined;
  return semver.satisfies(version, range, { includePrerelease: true });
}
