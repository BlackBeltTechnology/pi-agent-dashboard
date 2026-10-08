/**
 * Module-level relay store (change: add-browser-relay, task 4.3 / design D3;
 * simplified by add-browser-editor-pane-tab D10).
 *
 * `browser_relay_status` is GLOBAL — every live instance, not tied to a pi
 * session. The badge, the pane-tab body and the pane-tab LABEL (mounted for
 * background tabs too) all read the same latest snapshot from here, fed by
 * whichever of them is mounted (`useRelayStatusFeed`, idempotent).
 *
 * There is no `content-view` gate any more: nothing in this store opens or
 * replaces anything — opening is always an explicit user/agent action.
 */
import { usePluginMessage } from "@blackbelt-technology/dashboard-plugin-runtime";
import type {
  BrowserRelayInstanceStatus,
  BrowserRelayStatusMessage,
  BrowserRelayTabStatus,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { useEffect, useSyncExternalStore } from "react";
import { getBrowserProfiles } from "./browser-api.js";

let status: BrowserRelayStatusMessage | null = null;
const subscribers = new Set<() => void>();

/** Store the latest snapshot and notify readers. */
export function setRelayStatus(msg: BrowserRelayStatusMessage): void {
  status = msg;
  for (const listener of subscribers) listener();
}

/** The current snapshot, or `null` before the first status message. */
export function getRelayStatus(): BrowserRelayStatusMessage | null {
  return status;
}

function subscribeRelayStore(listener: () => void): () => void {
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
  const instance = snapshot?.instances.find((i) => i.instanceId === instanceId);
  const tab = instance?.tabs.find((t) => t.tabId === tabId);
  return instance && tab ? { instance, tab } : undefined;
}

/**
 * Keep the store fed while the calling component is mounted: the WS change
 * stream, plus ONE REST seed on mount (`browser_relay_status` has no on-connect
 * replay, so a fresh page load would otherwise see an empty store until the next
 * change). A WS snapshot that landed first is never clobbered by the older seed.
 */
export function useRelayStatusFeed(): void {
  usePluginMessage<BrowserRelayStatusMessage>("browser_relay_status", setRelayStatus);
  useEffect(() => {
    let alive = true;
    getBrowserProfiles()
      .then((res) => {
        if (!alive || getRelayStatus() !== null) return;
        const instances: BrowserRelayInstanceStatus[] = Object.entries(res.profiles).flatMap(([profileDirectory, profile]) =>
          profile.instances.map((inst) => ({ ...inst, profileDirectory })),
        );
        setRelayStatus({ type: "browser_relay_status", instances, auditSeq: 0 });
      })
      .catch(() => {
        /* plugin disabled / offline: the WS path stays authoritative */
      });
    return () => {
      alive = false;
    };
  }, []);
}

/** Test-only: reset the store between cases. */
export function __resetRelayStoreForTests(): void {
  status = null;
  subscribers.clear();
}
