/**
 * Module-level relay store (change: add-browser-relay, task 4.3 / design D3).
 *
 * The relay protocol is GLOBAL — `browser_relay_status` carries every live
 * instance and is not tied to a pi session. The `content-view` slot's
 * predicate (`isLiveViewActive`) is a PURE function with no hook access, so it
 * cannot subscribe to the shell WebSocket itself. This store is the bridge:
 *
 *  1. an always-mounted claim (`BrowserRelayBadge`, one per sidebar session
 *     card) is the WebSocket subscriber — it feeds every `browser_relay_status`
 *     here via `setRelayStatus`;
 *  2. `isLiveViewActive()` reads `hasLiveInstance()` synchronously;
 *  3. when the instance/tab set MATERIALly changes, `setRelayStatus` calls
 *     `bumpSlotClaimsVersion()`, which re-renders the content-view slot's gate
 *     wrapper so the predicate is re-evaluated without any session broadcast.
 *
 * The store also backs the React read path (`useRelayStatus`) for the tile
 * list and the badge pill.
 *
 * See change: add-browser-relay (task 4.3).
 */
import { bumpSlotClaimsVersion } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { BrowserRelayStatusMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { useSyncExternalStore } from "react";

let status: BrowserRelayStatusMessage | null = null;
const subscribers = new Set<() => void>();

/**
 * The material shape of a status snapshot — which instances exist, which tabs
 * each has, and each tab's state/reason. `auditSeq` is deliberately EXCLUDED:
 * an audit append must not invalidate the content-view gate.
 */
function signature(msg: BrowserRelayStatusMessage | null): string {
  if (!msg) return "";
  return msg.instances
    .map(
      (instance) =>
        `${instance.instanceId}:${instance.tabs
          .map((tab) => `${tab.tabId}/${tab.state}/${tab.reason ?? ""}`)
          .join(",")}`,
    )
    .join("|");
}

/** Store the latest snapshot; bump the slot-claims gate on a material change. */
export function setRelayStatus(msg: BrowserRelayStatusMessage): void {
  const previous = signature(status);
  status = msg;
  if (signature(msg) !== previous) bumpSlotClaimsVersion();
  for (const listener of subscribers) listener();
}

/** The current snapshot, or `null` before the first status message. */
export function getRelayStatus(): BrowserRelayStatusMessage | null {
  return status;
}

/** True when ≥1 live instance has ≥1 tab — the content-view gate. */
export function hasLiveInstance(): boolean {
  return (status?.instances ?? []).some((instance) => instance.tabs.length > 0);
}

/** Subscribe to store changes. Returns the unsubscribe fn. */
function subscribeRelayStore(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

/** Reactive read of the whole snapshot (tile list / badge). */
export function useRelayStatus(): BrowserRelayStatusMessage | null {
  return useSyncExternalStore(subscribeRelayStore, getRelayStatus, getRelayStatus);
}

/** Test-only: reset the store between cases. */
export function __resetRelayStoreForTests(): void {
  status = null;
  subscribers.clear();
}
