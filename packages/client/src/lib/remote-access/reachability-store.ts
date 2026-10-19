/**
 * Live bind facts from the `reachability_updated` broadcast (replayed on every
 * connect). A module singleton — like `pairingApprovalStore` — so the toolbar
 * button, the dialog and the post-restart resume all read one value without
 * threading the socket through the header.
 *
 * See change: add-remote-access-wizard (design D8).
 */
import type { BindReachability } from "@blackbelt-technology/pi-dashboard-shared/bind-reachability.js";
import { useSyncExternalStore } from "react";

type Live = Pick<BindReachability, "resolvedBindHost" | "pendingBindHost"> & Partial<BindReachability>;

class ReachabilityStore {
  private value: Live | null = null;
  private listeners = new Set<() => void>();
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  get = (): Live | null => this.value;
  set(next: Live): void {
    this.value = next;
    for (const cb of this.listeners) cb();
  }
  /** Test seam. */
  reset(): void {
    this.value = null;
    for (const cb of this.listeners) cb();
  }
}

export const reachabilityStore = new ReachabilityStore();

export const useLiveReachability = (): Live | null =>
  useSyncExternalStore(reachabilityStore.subscribe, reachabilityStore.get);
