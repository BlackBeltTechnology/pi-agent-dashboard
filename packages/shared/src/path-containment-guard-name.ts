/**
 * Extension name of the opt-in path-containment guard, as used in
 * `scope.extensionConfig` and (normalised) in its `PI_EXT_PATH_CONTAINMENT_GUARD_*`
 * env namespace. One constant so the guard (env names), the spawn-scope helper and
 * the server's spawn-env strip (`buildSpawnEnv`) can never disagree on the spelling.
 * See change: add-path-containment-guard-extension (D7).
 */
export const PATH_CONTAINMENT_GUARD_EXT_NAME = "path-containment-guard";
