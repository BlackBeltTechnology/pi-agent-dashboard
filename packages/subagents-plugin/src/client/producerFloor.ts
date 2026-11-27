/**
 * Producer version floor — client side. The loader's requirement probe lists an
 * unmet `requires.piExtensionVersions` range as `<name> <range>` in the plugin's
 * `missingRequirements` (served by `GET /api/plugins`). `useProducerBelowFloor`
 * reads that so the dock can show an update notice instead of rows.
 * Fetch failure ⇒ not below the floor (never blocks rows). 30 s module cache.
 *
 * See change: move-subagents-to-plugin (D9, task 11.1).
 */
import { useEffect, useState } from "react";

const PRODUCER_PACKAGE = "@blackbelt-technology/pi-dashboard-subagents";
const TTL_MS = 30_000;
let cached: { at: number; promise: Promise<string | undefined> } | undefined;

/** The unmet range (e.g. `>=0.7.0`) when the installed producer is below the floor. */
async function fetchUnmetRange(): Promise<string | undefined> {
  try {
    const res = await fetch("/api/plugins", { credentials: "include" });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { plugins?: { id?: string; missingRequirements?: string[] }[] };
    const row = body.plugins?.find((p) => p.id === "subagents");
    const hit = row?.missingRequirements?.find((m) => m.startsWith(`${PRODUCER_PACKAGE} `));
    return hit?.slice(PRODUCER_PACKAGE.length + 1);
  } catch {
    return undefined;
  }
}

function unmetRange(): Promise<string | undefined> {
  const now = Date.now();
  if (!cached || now - cached.at > TTL_MS) cached = { at: now, promise: fetchUnmetRange() };
  return cached.promise;
}

/** Test seam: drop the 30 s cache. */
export function resetProducerFloorCache(): void {
  cached = undefined;
}

/** The unmet producer range while the installed producer is below the floor, else `undefined`. */
export function useProducerBelowFloor(): string | undefined {
  const [range, setRange] = useState<string | undefined>();
  useEffect(() => {
    let live = true;
    void unmetRange().then((r) => {
      if (live) setRange(r);
    });
    return () => {
      live = false;
    };
  }, []);
  return range;
}
