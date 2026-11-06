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
 * A plugin-declared entry type (`hidden`, from the plugin's
 * `replayEntryTypes`) returns null: the owning plugin renders it through its
 * own live events, so forwarding would double-render beside its card. Core
 * names no plugin type. Non-`custom` entry types are likewise not ours to
 * forward. See change: update-flows-plugin (D3).
 */

const NONE: ReadonlySet<string> = new Set();

export interface CustomEntryForwardData {
  customType: string;
  data: unknown;
  entryId: string;
  /**
   * Server-stamped custom event group id (design D1,
   * add-custom-event-group-filters). The extension never sets it: resolution
   * + stamping happen in the dashboard server before browser ingest.
   */
  groupId?: string;
}

/**
 * Map one pi entry to the custom_entry payload, or null when the entry must
 * NOT be forwarded (non-custom type, missing/empty customType, declared type).
 */
export function toCustomEntryForward(
  entry: unknown,
  hidden: ReadonlySet<string> = NONE,
): CustomEntryForwardData | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  if (e.type !== "custom") return null;
  if (typeof e.customType !== "string" || e.customType === "") return null;
  if (hidden.has(e.customType)) return null;
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
    /** Server-stamped (design D1); never set by the extension. */
    groupId?: string;
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
export function toCustomMessageForward(
  m: {
    customType: unknown;
    content: unknown;
    display?: unknown;
    details?: unknown;
    entryId?: unknown;
  },
  hidden: ReadonlySet<string> = NONE,
): CustomMessageForwardData | null {
  if (!m || typeof m.customType !== "string" || m.customType === "") return null;
  if (m.display === false) return null;
  // Declared-type parity with the entry path: a plugin does not send custom
  // MESSAGES of its entry type, but a spoofing customType must not lease the
  // generic card either. See change: render-inline-reasoning-and-custom-entries.
  if (hidden.has(m.customType)) return null;
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
