/**
 * Server-only semver comparison for `PluginRequirements.piExtensionVersions`
 * (requirement probe). Lives here, not in shared, so shared's dashboard-plugin area
 * stays dependency-free; the manifest validator uses the in-house
 * `../version-range-syntax.ts` instead (it runs in the Vite build, no `semver`).
 * See change: move-subagents-to-plugin (D9).
 */
import { createRequire } from "node:module";

type Semver = typeof import("semver");
let semver: Semver | undefined;
/**
 * Resolved lazily at probe time (server only): a static import would be pulled into the
 * plugin Vite build graph, where `semver` is not resolvable from a node_modules copy.
 */
const loadSemver = (): Semver => (semver ??= createRequire(import.meta.url)("semver") as Semver);

/** `true`/`false` for a parseable version, `undefined` when `version` is not semver. */
export function versionSatisfies(version: string | undefined, range: string): boolean | undefined {
  const sv = loadSemver();
  if (typeof version !== "string" || !sv.valid(version)) return undefined;
  return sv.satisfies(version, range, { includePrerelease: true });
}
