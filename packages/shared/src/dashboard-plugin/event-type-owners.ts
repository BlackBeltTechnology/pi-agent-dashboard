/**
 * Plugin event-type ownership — pure pattern matching.
 *
 * A plugin manifest declares `eventTypes`: exact names or `prefix_*` (a single
 * trailing `*`). The shell reads ownership from every registered plugin's
 * manifest (enabled or not) and never hard-codes a plugin prefix.
 * See change: decouple-plugins-from-core (design D5 item 2).
 */

/** One plugin's declared event types, as read from its manifest summary. */
export interface EventTypeOwner {
  ownerId: string;
  displayName: string;
  eventTypes: readonly string[];
}

const PATTERN = /^[A-Za-z0-9_.:-]+\*?$/;

/** An exact event name, or a name followed by a single trailing `*`. */
export function isValidEventTypePattern(pattern: string): boolean {
  return PATTERN.test(pattern);
}

/** Trailing `*` = prefix glob; otherwise exact equality. */
export function matchesEventTypePattern(pattern: string, eventType: string): boolean {
  return pattern.endsWith("*") ? eventType.startsWith(pattern.slice(0, -1)) : pattern === eventType;
}

/**
 * Owner of `eventType`, or undefined. An exact declaration beats a prefix glob;
 * among globs the longest prefix wins; ties keep the earlier owner.
 */
export function matchEventTypeOwner(
  owners: readonly EventTypeOwner[],
  eventType: string,
): EventTypeOwner | undefined {
  let best: EventTypeOwner | undefined;
  let bestScore = -1;
  for (const owner of owners) {
    for (const pattern of owner.eventTypes) {
      if (!matchesEventTypePattern(pattern, eventType)) continue;
      const score = pattern.endsWith("*") ? pattern.length - 1 : Number.MAX_SAFE_INTEGER;
      if (score > bestScore) {
        best = owner;
        bestScore = score;
      }
    }
  }
  return best;
}
