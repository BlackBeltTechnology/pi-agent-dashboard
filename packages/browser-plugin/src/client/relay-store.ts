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
 * Set when the user dismisses the live view. The `content-view` predicate reads
 * it via `hasLiveInstance()`, so the shell's no-op `onClose` is complemented by
 * the CLAIM clearing its own state (the shell contract: "Plugin claim clears its
 * own UI state on dismiss"). Cleared by the next MATERIAL change, so a new
 * instance/tab brings the view back.
 */
let dismissed = false;

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
  if (signature(msg) !== previous) {
    // A material change (new/removed instance or tab) re-arms the live view.
    dismissed = false;
    bumpSlotClaimsVersion();
  }
  for (const listener of subscribers) listener();
}

/** The current snapshot, or `null` before the first status message. */
export function getRelayStatus(): BrowserRelayStatusMessage | null {
  return status;
}

/** True when ≥1 live instance has ≥1 tab AND the user has not dismissed it. */
export function hasLiveInstance(): boolean {
  if (dismissed) return false;
  return (status?.instances ?? []).some((instance) => instance.tabs.length > 0);
}

/** Dismiss the live view (the tile's Close button); re-armed by a material change. */
export function dismissLiveView(): void {
  if (dismissed) return;
  dismissed = true;
  bumpSlotClaimsVersion();
  for (const listener of subscribers) listener();
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
  dismissed = false;
  subscribers.clear();
}
