/**
 * Custom event groups — user-editable grouping of the open `customType`
 * keyspace into named, toggleable categories, persisted at
 * `~/.pi/dashboard/custom-event-groups.json` alongside `config.json`,
 * `preferences.json`, and `tool-overrides.json`.
 *
 * Schema:
 *   { "version": 1, "groups": [{ id, label, pattern, default }...], "seenShippedIds": [...] }
 *
 * Design notes (see change: add-custom-event-group-filters, design D2/D4/D5):
 *   - `id` is identity; `pattern` and `label` are freely editable without
 *     losing toggle state (D2).
 *   - Resolution is first-match-wins over the ordered `groups` array with the
 *     reserved `other` group as catch-all. `other` is synthesized when the
 *     file omits it (D4).
 *   - `seenShippedIds` gates the upgrade-merge so a shipped group a user
 *     deleted is never resurrected (D5).
 *   - Store conventions follow `tool-registry/overrides.ts`: versioned
 *     envelope, lazy load, in-memory cache, atomic tmp+rename persist,
 *     malformed file → fail open rather than throw.
 *   - Restart-to-apply (D6): the file is read once per process; no watcher.
 */
/** One configured group. `pattern` is a regex matched against `customType`. */
export interface CustomEventGroup {
  /** Stable, opaque identity. The pref key and merge-tracking key. */
  id: string;
  /** Human-readable label rendered by both toggle surfaces. */
  label: string;
  /** Regular expression tested against the row's `customType`. */
  pattern: string;
  /** Visibility when no explicit preference exists for this group. */
  default: boolean;
}

/** Client-facing projection — patterns are a server-side concern (design D1). */
export interface ClientCustomEventGroup {
  id: string;
  label: string;
  default: boolean;
}

/** Reserved catch-all group id. Always exists; not removable via the file. */
export const RESERVED_OTHER_GROUP_ID = "other";

/**
 * Shipped default groups, covering the emitters inventoried in the proposal
 * (12 distinct `customType` values across 3901 gated rows; `om.*` alone is
 * 74%). `memory` defaults to HIDDEN — the observable behavior change called
 * out in the CHANGELOG.
 *
 * Order matters: resolution is first-match-wins, and upgrade-merge appends
 * newly shipped groups AFTER user-authored entries, so a later-shipped group
 * never overtakes a broader user rule.
 */
export const SHIPPED_CUSTOM_EVENT_GROUPS: readonly CustomEventGroup[] = [
  { id: "memory", label: "Memory telemetry", pattern: "^om\\.", default: false },
  { id: "search", label: "Web search results", pattern: "^web-search-results$", default: true },
  { id: "subagents", label: "Subagents", pattern: "^subagents:|^subagent-notification$", default: true },
  { id: "flows", label: "Flows help", pattern: "^pi-flows-help$", default: true },
  { id: "goals", label: "Goals", pattern: "^pi-goal-hermes:", default: true },
];

/** The reserved catch-all as a group (synthesized, never shipped). */
export const RESERVED_OTHER_GROUP: CustomEventGroup = {
  id: RESERVED_OTHER_GROUP_ID,
  label: "Other",
  pattern: "",
  default: true,
};

/** `Record<groupId, boolean>` seeding every shipped group plus `other`. */
export function defaultCustomEventGroupPrefs(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const g of [...SHIPPED_CUSTOM_EVENT_GROUPS, RESERVED_OTHER_GROUP]) {
    out[g.id] = g.default;
  }
  return out;
}
