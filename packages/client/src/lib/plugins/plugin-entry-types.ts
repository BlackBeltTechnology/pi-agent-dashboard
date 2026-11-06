/**
 * Module store for plugin-declared persisted entry types — a reducer INPUT.
 *
 * Every bundled plugin manifest's `replayEntryTypes` (enabled or not): the
 * reducer never renders a generic custom row for such a type, because the
 * owning plugin renders it (or, when disabled, it stays hidden). Static per
 * registry, so the pure reducer may read it. Core names no plugin type.
 * `App.tsx` seeds it once; tests seed it directly.
 * See change: update-flows-plugin (D3, G5).
 */
let types: ReadonlySet<string> = new Set();

/** Replace the declared set (copy; the caller's iterable is never aliased). */
export function setPluginEntryTypes(next: Iterable<string>): void {
  types = new Set(next);
}

/** True when `customType` is declared by any registered plugin. */
export function isPluginEntryType(customType: string): boolean {
  return types.has(customType);
}
