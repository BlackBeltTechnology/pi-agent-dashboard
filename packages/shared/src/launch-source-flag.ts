/**
 * Feature flag for the LaunchSource V2 resolver.
 * Default: true (Phase C cutover). Set LAUNCH_SOURCE_V2=false to revert to
 * the legacy wizard + mode.json path for debugging.
 *
 * TODO: remove LAUNCH_SOURCE_V2 flag in follow-up change after Phase C ships
 * without regressions for one release cycle. The flag and its CI matrix
 * entry should be deleted at that point.
 */
export function isLaunchSourceV2Enabled(env: Record<string, string | undefined>): boolean {
  const val = env["LAUNCH_SOURCE_V2"];
  if (val === undefined) return true; // default ON in Phase C
  return val === "true" || val === "1";
}
