/**
 * Process-lifetime holder for the ladder-resolved pi spawn runtime.
 *
 * `resolveAndPublishRuntime` (server startup) resolves the runtime via
 * `resolveSpawnRuntime`, publishes `runtime.resolved`, and stores it here;
 * every pi-session spawn surface (buildSpawnEnv, Windows argv assembly,
 * shared-tree mutations) reads it through `currentSpawnRuntime()` and
 * re-validates at spawn time (`ensureFreshRuntime`) rather than trusting a
 * boot-time value.
 *
 * Deliberately tiny: the seam contract between startup resolution and the
 * spawn paths. See change: unify-pi-runtime-identity (design D1/D3).
 */
import type {
  ResolvedRuntime,
  ResolveSpawnRuntimeOpts,
} from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-runtime.js";
import { resolveSpawnRuntime } from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-runtime.js";

let current: ResolvedRuntime | null = null;

/** Store the startup resolution (called by the startup publisher). */
export function setCurrentSpawnRuntime(rt: ResolvedRuntime): void {
  current = rt;
}

/** The boot-time resolution, or null before startup resolution ran. */
export function currentSpawnRuntime(): ResolvedRuntime | null {
  return current;
}

/**
 * Resolve live (ladder re-run). Used by startup and by spawn-time
 * re-validation when the stored resolution fails validation.
 */
export function resolveLiveSpawnRuntime(
  opts: ResolveSpawnRuntimeOpts = {},
): ResolvedRuntime {
  const rt = resolveSpawnRuntime(opts);
  setCurrentSpawnRuntime(rt);
  return rt;
}
