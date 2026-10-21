/**
 * Module store for plugin event-type ownership — a reducer INPUT.
 *
 * Ownership is static per registry (every bundled plugin's manifest, plus
 * runtime plugins once registered), so the pure event reducer may read it.
 * Availability (enabled / loaded / refused) changes at runtime and lives in
 * `plugin-availability.ts`; the reducer never reads it.
 *
 * `App.tsx` seeds this from `registry.getEventTypeOwners()` once the registry
 * is populated; tests seed it directly.
 * See change: decouple-plugins-from-core (design D5 item 4, R8).
 */
import {
  type EventTypeOwner,
  matchEventTypeOwner,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/event-type-owners.js";

let owners: readonly EventTypeOwner[] = [];

/** Replace the owner list (copy; the caller's array is never aliased). */
export function setEventTypeOwners(next: readonly EventTypeOwner[]): void {
  owners = [...next];
}

/** Current owner list. */
export function getEventTypeOwners(): readonly EventTypeOwner[] {
  return owners;
}

/** Owner of `eventType` under the current list, or undefined when unowned. */
export function ownerOfEventType(eventType: string): EventTypeOwner | undefined {
  return matchEventTypeOwner(owners, eventType);
}

/** Display name of the owner with `ownerId` (the id itself when unknown). */
export function ownerDisplayName(ownerId: string): string {
  return owners.find((o) => o.ownerId === ownerId)?.displayName ?? ownerId;
}
