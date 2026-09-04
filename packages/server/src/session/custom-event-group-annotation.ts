/**
 * Server-side stamping of the resolved custom-event group onto forwarded
 * events (design D1, see change: add-custom-event-group-filters).
 *
 * The server resolves `customType → groupId` (worker-guarded matcher) and
 * stamps it BEFORE the event is stored/broadcast, so:
 *   - the persisted event carries the group (browser replay-from-store is
 *     automatically annotated), and
 *   - untrusted regexes never ship to any browser (patterns are a
 *     server-side concern).
 *
 * Two event shapes carry custom content:
 *   - `custom_entry`          → data: CustomEntryEventPayload
 *   - `message_end` (custom)  → data.message: CustomMessageEndPayload
 *
 * A row arriving WITHOUT `groupId` (older server, un-annotated path) is
 * treated as `other` by the client — fail-visible.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** The `customType` a groupable event carries, or undefined. */
export function customEventTypeOfEvent(event: DashboardEvent): string | undefined {
  if (event.eventType === "custom_entry") {
    const t = event.data?.customType;
    return typeof t === "string" ? t : undefined;
  }
  if (event.eventType === "message_end") {
    const msg = event.data?.message as Record<string, unknown> | undefined;
    const t = msg?.customType;
    if (msg?.role !== "custom") return undefined;
    return typeof t === "string" ? t : undefined;
  }
  return undefined;
}

/** True when the event is a custom row the group gate applies to. */
export function isGroupableCustomEvent(event: DashboardEvent): boolean {
  return customEventTypeOfEvent(event) !== undefined;
}

/**
 * Stamp the resolved group onto the event, in place, BEFORE ingest. Absent
 * (undefined) resolution — flow-event's dedicated path — leaves the event
 * unannotated; the client then treats the row as `other`, which the gate
 * never reaches for flow cards anyway.
 */
export function stampEventGroup(event: DashboardEvent, groupId: string | undefined): void {
  if (typeof groupId !== "string") return;
  if (!event.data || typeof event.data !== "object") return;
  if (event.eventType === "custom_entry") {
    event.data.groupId = groupId;
    return;
  }
  if (event.eventType === "message_end") {
    const msg = event.data.message;
    if (msg && typeof msg === "object") (msg as Record<string, unknown>).groupId = groupId;
  }
}
