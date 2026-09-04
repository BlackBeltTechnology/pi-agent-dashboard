/**
 * Client access to the custom event group DEFINITIONS (id, label, default
 * visibility, resolution order — never patterns). Fetched once from
 * `GET /api/custom-event-groups` and cached module-wide; both display
 * surfaces (SettingsPanel + ChatViewMenu) render one toggle per group.
 *
 * The reflect-the-user's-file contract: the payload lists every configured
 * group including the catch-all `other`, in configured order. Restart-to-apply
 * (design D6) means the list changes only across server restarts.
 *
 * See change: add-custom-event-group-filters (task 4.4).
 */
import { useEffect, useState } from "react";
import type { ClientCustomEventGroup } from "@blackbelt-technology/pi-dashboard-shared/custom-event-groups.js";

let cache: ClientCustomEventGroup[] | null = null;
let inflight: Promise<ClientCustomEventGroup[]> | null = null;

/** Fetch (once) the group definitions; failures resolve to an empty list —
 *  a surface that cannot read the file still renders, just without rows. */
export function fetchCustomEventGroups(): Promise<ClientCustomEventGroup[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch("/api/custom-event-groups", { credentials: "include" })
      .then(async (r) => (r.ok ? ((await r.json()) as { groups?: ClientCustomEventGroup[] }) : {}))
      .then((b) => (cache = b.groups ?? []))
      .catch(() => (cache = []))
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** React hook: the group list, or `null` while the first fetch is in flight. */
export function useCustomEventGroups(): ClientCustomEventGroup[] | null {
  const [groups, setGroups] = useState<ClientCustomEventGroup[] | null>(cache);
  useEffect(() => {
    if (cache) return;
    let alive = true;
    void fetchCustomEventGroups().then((g) => {
      if (alive) setGroups(g);
    });
    return () => {
      alive = false;
    };
  }, []);
  return groups;
}
