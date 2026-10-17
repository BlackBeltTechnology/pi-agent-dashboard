/**
 * Module-level relay store (change: add-browser-relay, task 4.3 / design D3;
 * simplified by add-browser-editor-pane-tab D10; feed ownership moved to
 * `BrowserRelayFeed` by fix-empty-status-subcard).
 *
 * `browser_relay_status` is GLOBAL — every live instance, not tied to a pi
 * session. The badge, the pane-tab body and the pane-tab LABEL (mounted for
 * background tabs too) all READ the same latest snapshot from here. Exactly one
 * component FEEDS it: `BrowserRelayFeed` (a `shell-headless` claim, always
 * mounted), the sole caller of `useRelayStatusFeed`.
 *
 * There is no `content-view` gate any more: nothing in this store opens or
 * replaces anything — opening is always an explicit user/agent action.
 */
import {
  bumpSlotClaimsVersion,
  usePluginMessage,
  useShellConnectionStatus,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type {
  BrowserRelayInstanceStatus,
  BrowserRelayStatusMessage,
  BrowserRelayTabStatus,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { useEffect, useSyncExternalStore } from "react";
import { getBrowserProfiles } from "./browser-api.js";

let status: BrowserRelayStatusMessage | null = null;
/** Incremented by every `setRelayStatus`; lets an in-flight REST seed detect a newer snapshot. */
let snapshotSeq = 0;
const subscribers = new Set<() => void>();

/**
 * The tabs of every instance in a snapshot, flattened. The single primitive
 * behind the STATUS gate AND the badge render, so a malformed frame can never
 * pass the gate and then throw inside the badge: a non-array `instances`, or an
 * instance whose `tabs` is not an array, contributes nothing.
 */
export function relayTabsOf(
  snapshot: BrowserRelayStatusMessage | null,
): Array<{ instanceId: string; tab: BrowserRelayTabStatus }> {
  const instances: unknown = snapshot?.instances;
  if (!Array.isArray(instances)) return [];
  return (instances as BrowserRelayInstanceStatus[]).flatMap((instance) =>
    Array.isArray(instance?.tabs) ? instance.tabs.map((tab) => ({ instanceId: instance.instanceId, tab })) : [],
  );
}

/** `true` iff the snapshot lists at least one tab on any instance (strict boolean). */
export function hasRelayTabs(snapshot: BrowserRelayStatusMessage | null): boolean {
  return relayTabsOf(snapshot).length > 0;
}

/**
 * Store the latest snapshot (`null` = unknown/cleared) and notify readers.
 * Order matters: assign FIRST, then bump the slot-claims version on a tab-count
 * flip (so the STATUS gate re-evaluates against the new snapshot, with no
 * session broadcast), then notify store readers.
 */
export function setRelayStatus(msg: BrowserRelayStatusMessage | null): void {
  const flipped = hasRelayTabs(status) !== hasRelayTabs(msg);
  status = msg;
  snapshotSeq += 1;
  if (flipped) bumpSlotClaimsVersion();
  for (const listener of subscribers) listener();
}

/** The current snapshot, or `null` before the first status message. */
export function getRelayStatus(): BrowserRelayStatusMessage | null {
  return status;
}

export function subscribeRelayStore(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

/** Reactive read of the whole snapshot. */
export function useRelayStatus(): BrowserRelayStatusMessage | null {
  return useSyncExternalStore(subscribeRelayStore, getRelayStatus, getRelayStatus);
}

/** One relay tab (and its instance) from the current snapshot, or `undefined` when gone. */
export function findRelayTab(
  snapshot: BrowserRelayStatusMessage | null,
  instanceId: string,
  tabId: number,
): { instance: BrowserRelayInstanceStatus; tab: BrowserRelayTabStatus } | undefined {
  const instances: unknown = snapshot?.instances;
  const instance = Array.isArray(instances)
    ? (instances as BrowserRelayInstanceStatus[]).find((i) => i.instanceId === instanceId)
    : undefined;
  const tab = Array.isArray(instance?.tabs) ? instance.tabs.find((t) => t.tabId === tabId) : undefined;
  return instance && tab ? { instance, tab } : undefined;
}

/**
 * Keep the store fed while the calling component is mounted — called ONLY by
 * `BrowserRelayFeed`. Two sources: the WS change stream, and a REST seed
 * (`browser_relay_status` has no on-connect replay) taken on mount and on every
 * (re)connect of the shell. A failed seed clears the snapshot (hide a possibly
 * live badge rather than show a stale one); a live push that lands during the
 * fetch wins over the older seed. Unmounting clears the store.
 */
export function useRelayStatusFeed(): void {
  usePluginMessage<BrowserRelayStatusMessage>("browser_relay_status", setRelayStatus);
  const connection = useShellConnectionStatus();
  useEffect(() => {
    if (connection !== "connected") return;
    let alive = true;
    const startSeq = snapshotSeq;
    const fresh = () => alive && snapshotSeq === startSeq;
    getBrowserProfiles()
      .then((res) => {
        if (!fresh()) return;
        const dashboard: BrowserRelayInstanceStatus[] = Object.entries(res.profiles).flatMap(([profileDirectory, profile]) =>
          profile.instances.map((inst) => ({ ...inst, profileDirectory, host: "dashboard" })),
        );
        const operator: BrowserRelayInstanceStatus[] = (res.operatorHosts ?? []).flatMap((h) =>
          h.profiles.flatMap((p) => p.instances.map((inst) => ({ ...inst, profileDirectory: p.profileDirectory, host: h.hostId }))),
        );
        const instances = [...dashboard, ...operator];
        setRelayStatus({ type: "browser_relay_status", instances, auditSeq: 0 });
      })
      .catch(() => {
        if (fresh()) setRelayStatus(null);
      });
    return () => {
      alive = false;
    };
  }, [connection]);
  // Plugin disabled / feed unmounted: never leave a stale snapshot behind.
  useEffect(() => () => setRelayStatus(null), []);
}

/** Test-only: reset the store between cases. */
export function __resetRelayStoreForTests(): void {
  status = null;
  snapshotSeq = 0;
  subscribers.clear();
  bumpSlotClaimsVersion();
}
