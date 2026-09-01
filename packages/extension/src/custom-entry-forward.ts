/**
 * Pure mapping for pi `entry_appended` events → the dashboard `custom_entry`
 * protocol event (change: render-inline-reasoning-and-custom-entries, D2).
 *
 * `pi.appendEntry(customType, data)` persists a `CustomEntry` and fires
 * `entry_appended`; before this module the bridge did not subscribe, so
 * generic custom entries rendered as nothing at all. The mapping forwards
 * ONLY `customType` / `data` / `entryId` — the entry's other fields are
 * transport trivia the renderer never needs.
 *
 * `customType: "flow-event"` returns null: pi-flows appends those entries
 * live itself, so forwarding them would double-render alongside the
 * dedicated flow card. Non-`custom` entry types are likewise not ours to
 * forward.
 */

export interface CustomEntryForwardData {
  customType: string;
  data: unknown;
  entryId: string;
}

/**
 * Map one pi entry to the custom_entry payload, or null when the entry must
 * NOT be forwarded (non-custom type, missing/empty customType, flow-event).
 */
export function toCustomEntryForward(entry: unknown): CustomEntryForwardData | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  if (e.type !== "custom") return null;
  if (typeof e.customType !== "string" || e.customType === "") return null;
  if (e.customType === "flow-event") return null;
  return {
    customType: e.customType,
    data: e.data,
    entryId: typeof e.id === "string" ? e.id : String(e.id ?? ""),
  };
}

export interface CustomMessageForwardData {
  message: {
    role: "custom";
    customType: string;
    content: unknown;
    display: boolean | undefined;
    details: unknown;
  };
  entryId: string | undefined;
}

/**
 * Map one persisted custom MESSAGE (pi.sendMessage) to the `message_end`
 * payload the client reducer's role=custom arm expects, or null when it must
 * NOT be forwarded.
 *
 * EXACT `display === false` exclusion (D5): pi normalizes content but NOT
 * display, so an untyped extension omitting the flag yields undefined — which
 * RENDERS (absent flag = meant to be seen). Mirrors the state-replay arm so
 * live and replay forward identically.
 */
export function toCustomMessageForward(m: {
  customType: unknown;
  content: unknown;
  display?: unknown;
  details?: unknown;
  entryId?: unknown;
}): CustomMessageForwardData | null {
  if (!m || typeof m.customType !== "string" || m.customType === "") return null;
  if (m.display === false) return null;
  // flow-event parity with the entry path: pi-flows does not send custom
  // MESSAGES today, but a spoofing customType must not lease the generic
  // card either. See change: render-inline-reasoning-and-custom-entries.
  if (m.customType === "flow-event") return null;
  return {
    message: {
      role: "custom",
      customType: m.customType,
      content: m.content,
      display: m.display as boolean | undefined,
      details: m.details,
    },
    entryId: typeof m.entryId === "string" ? m.entryId : undefined,
  };
}
