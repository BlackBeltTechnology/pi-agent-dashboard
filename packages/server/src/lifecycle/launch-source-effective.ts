/**
 * Derives `launchSourceEffective` for `/api/health` from the static
 * `launchSource` label plus two dynamic signals (active bridge count, uptime).
 *
 * A bridge-spawned server whose pi session has long since quit still reports
 * the static `launchSource: "bridge"` forever (the label is set once from
 * `DASHBOARD_STARTER`). The effective field promotes it to `"bridge-orphaned"`
 * once no bridge is connected AND the 30 s bootstrap-race grace window has
 * elapsed — so consumers (tray ownership, Doctor advisories) can distinguish a
 * live-session bridge server from an abandoned one.
 *
 * The static `launchSource` is left untouched (back-compat with the
 * `decideShutdownOnQuit` "did *this* Electron lifetime spawn it?" rule).
 *
 * See change: electron-attach-ownership-fixes.
 */
import type { LaunchSource } from "@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js";

export type LaunchSourceEffective =
  | "electron"
  | "standalone"
  | "bridge"
  | "bridge-orphaned";

/** Grace window (ms) that absorbs the restart→bridge-reconnect race. */
export const BRIDGE_ORPHAN_GRACE_MS = 30_000;

export function computeEffectiveLaunchSource(params: {
  raw: LaunchSource;
  activeBridgeCount: number;
  uptimeMs: number;
}): LaunchSourceEffective {
  if (
    params.raw === "bridge" &&
    params.activeBridgeCount === 0 &&
    params.uptimeMs > BRIDGE_ORPHAN_GRACE_MS
  ) {
    return "bridge-orphaned";
  }
  return params.raw;
}
