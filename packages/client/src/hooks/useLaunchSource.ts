/**
 * useLaunchSource — one-shot probe of `/api/health` returning the
 * server's `launchSource` field (`"electron" | "standalone" | "bridge"`).
 *
 * Used by arm-aware UI gates: notably hiding the pi-core update group
 * under Electron, where the bundled `node_modules/` is read-only and
 * pi-version upgrades flow through `electron-updater` whole-app
 * replacement instead of `POST /api/pi-core/update`.
 *
 * Returns `null` while the probe is in flight. Consumers should
 * **fail-open** on `null` (render the UI) — a transient probe miss
 * should not hide the pi-core controls for standalone/bridge users.
 *
 * The value cannot change without a server restart, so the probe runs
 * exactly once per page lifetime and the result is cached at module
 * scope. Server restart implies a new page load (the connection drops),
 * so module-level caching is safe.
 *
 * See change: eliminate-electron-runtime-install (task 3.3).
 */
import { useEffect, useState } from "react";

export type LaunchSource = "electron" | "standalone" | "bridge";

let cached: LaunchSource | null = null;
let inflight: Promise<LaunchSource | null> | null = null;

function probe(): Promise<LaunchSource | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) return null;
      const body = (await res.json()) as { launchSource?: LaunchSource };
      if (body.launchSource === "electron" || body.launchSource === "standalone" || body.launchSource === "bridge") {
        cached = body.launchSource;
        return cached;
      }
      return null;
    } catch {
      return null;
    }
  })();
  return inflight;
}

export function useLaunchSource(): LaunchSource | null {
  const [value, setValue] = useState<LaunchSource | null>(cached);
  useEffect(() => {
    if (cached) {
      setValue(cached);
      return;
    }
    let cancelled = false;
    probe().then((v) => {
      if (!cancelled) setValue(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return value;
}

/**
 * Test-only: reset the module-level cache. Production code never calls this.
 */
export function __resetLaunchSourceCacheForTests(): void {
  cached = null;
  inflight = null;
}
