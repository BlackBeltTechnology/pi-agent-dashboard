/**
 * Slot-claims invalidation store (design D3) — the re-render nudge for gates
 * whose signal arrives after first render.
 *
 * A plugin's late-arriving global signal (e.g. the blackhole boot installed-
 * check) resolves AFTER session cards have rendered. Nothing re-renders the
 * gate wrappers of idle/ended sessions that will never broadcast again — the
 * `fix-empty-flows-subcard` scar. When the signal resolves, the plugin calls
 * `bumpSlotClaimsVersion()`; every mounted gate wrapper subscribed via
 * `useSlotHasClaimsVersion` re-renders and re-invokes `shouldRender`
 * synchronously. Until a bump, the store changes nothing (version stays 0,
 * no subscriber fires).
 *
 * This is a GLOBAL signal channel only — no per-session payload rides a bump.
 * The store is meaningful only while host and plugin client entries resolve to
 * ONE `dashboard-plugin-runtime` module instance (true under the hoisted
 * workspace + Vite resolution today).
 *
 * See change: add-blackhole-session-pipeline.
 */
import { useSyncExternalStore } from "react";

let version = 0;
const listeners = new Set<() => void>();

/** Current store version. Snapshots must be primitives (useSyncExternalStore). */
export function getSlotClaimsVersion(): number {
  return version;
}

/** Subscribe a gate wrapper to bumps. Returns the unsubscribe fn. */
export function subscribeSlotClaimsVersion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Invalidate every mounted gate wrapper. Call when a plugin's late-arriving
 * global signal resolves and changes a `shouldRender` answer. Fires each
 * subscriber synchronously.
 */
export function bumpSlotClaimsVersion(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * Subscribe the calling component to bumps. The returned version is only a
 * render cache key — callers re-read their own synchronous gate state on the
 * re-render the bump triggers. Invoked BEFORE any registry-null early return
 * so hook order stays stable whether or not a registry is present.
 */
export function useSlotClaimsVersion(): number {
  return useSyncExternalStore(subscribeSlotClaimsVersion, getSlotClaimsVersion);
}

/** Test-only: reset version + listeners between tests. */
export function __resetSlotClaimsVersionForTests(): void {
  version = 0;
  listeners.clear();
}
