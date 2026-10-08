/**
 * `editor-pane-tab` slot path rules, shared by the manifest validator, the
 * registry generator, the client pane and plugin servers.
 *
 * A plugin tab path is `<prefix>:<rest>`; the prefix selects the claim.
 * See change: add-browser-editor-pane-tab (D1).
 */

/** A claimable prefix: lowercase, starts with a letter, 2–32 chars. */
export const PANE_TAB_PREFIX_RE = /^[a-z][a-z0-9-]{1,31}$/;

/** Built-in pseudo-tab prefixes — never claimable, always the built-in viewer. */
export const RESERVED_PANE_TAB_PREFIXES: ReadonlySet<string> = new Set(["diff", "term", "url", "live"]);

/**
 * The prefix of a plugin tab path, or `null` when `path` is not of the form
 * `<valid-prefix>:<non-empty rest>` or names a built-in prefix.
 */
export function paneTabPrefixOf(path: string): string | null {
  if (typeof path !== "string") return null;
  const i = path.indexOf(":");
  if (i <= 0 || i === path.length - 1) return null;
  const prefix = path.slice(0, i);
  if (!PANE_TAB_PREFIX_RE.test(prefix) || RESERVED_PANE_TAB_PREFIXES.has(prefix)) return null;
  return prefix;
}
