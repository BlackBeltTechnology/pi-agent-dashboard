/**
 * Which `hostId` THIS window's `OperatorHostCarrier` is registered as. Own module
 * (not `relay-store`) so the always-loaded shell chunk does not carry it: only the
 * lazy carrier and pane chunks use it.
 * See change: add-operator-browser-relay (D1/D10).
 */
import { useSyncExternalStore } from "react";

let operatorHostId: string | null = null;
const operatorHostSubscribers = new Set<() => void>();

export function getOperatorHostId(): string | null {
  return operatorHostId;
}

export function setOperatorHostId(hostId: string | null): void {
  if (operatorHostId === hostId) return;
  operatorHostId = hostId;
  for (const listener of operatorHostSubscribers) listener();
}

function subscribeOperatorHost(listener: () => void): () => void {
  operatorHostSubscribers.add(listener);
  return () => {
    operatorHostSubscribers.delete(listener);
  };
}

/** Reactive read of "registered as <hostId>" for this window. */
export function useOperatorHostId(): string | null {
  return useSyncExternalStore(subscribeOperatorHost, getOperatorHostId, getOperatorHostId);
}

/** Test seam. */
export function __resetOperatorHostForTests(): void {
  operatorHostId = null;
  operatorHostSubscribers.clear();
}
