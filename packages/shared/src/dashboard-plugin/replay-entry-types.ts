/**
 * Plugin-owned persisted custom-entry types (`pi-dashboard-plugin.replayEntryTypes`).
 *
 * A plugin declares the `type: "custom"` entry `customType` values it owns.
 * Core replays an ENABLED plugin's types as their recorded protocol events
 * (`state-replay.ts`) and keeps EVERY declared type — enabled or not — out of
 * the generic custom-entry paths (a disabled plugin's entries stay hidden).
 * Core never names a plugin entry type. See change: update-flows-plugin (D3, G5, G6).
 */

/** Same shape as a custom entry type: printable, no whitespace, ≤ 128 chars. */
const ENTRY_TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
/** Max declared entry types per plugin. */
export const MAX_REPLAY_ENTRY_TYPES = 16;

/**
 * Lenient parse of an untrusted manifest value: an array of valid type names,
 * else `[]` (a malformed value contributes nothing and never throws — G6).
 */
export function normalizeReplayEntryTypes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_REPLAY_ENTRY_TYPES) return [];
  if (!value.every((t) => typeof t === "string" && ENTRY_TYPE_RE.test(t))) return [];
  return [...new Set(value as string[])];
}

export interface ReplayEntryTypeSets {
  /** Types replayed as recorded protocol events (enabled plugins only). */
  replay: string[];
  /** Types kept out of the generic custom-entry paths (every declaring plugin). */
  hidden: string[];
}

/** Compute both sets from discovered plugins and their enabled state. */
export function computeReplayEntryTypes(
  plugins: ReadonlyArray<{ replayEntryTypes?: unknown; enabled: boolean }>,
): ReplayEntryTypeSets {
  const replay = new Set<string>();
  const hidden = new Set<string>();
  for (const p of plugins) {
    for (const t of normalizeReplayEntryTypes(p.replayEntryTypes)) {
      hidden.add(t);
      if (p.enabled) replay.add(t);
    }
  }
  return { replay: [...replay], hidden: [...hidden] };
}
