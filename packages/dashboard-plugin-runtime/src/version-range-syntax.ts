/**
 * Dependency-free syntax check for a semver range string (node-semver grammar subset:
 * `||` sets, space-joined comparators, `^ ~ ~> < <= > >= =`, x-ranges, `a - b`, prerelease/build).
 * Used by the manifest validator for `requires.piExtensionVersions`, which also runs in
 * the Vite build where `semver` is not resolvable. Comparison lives in `./server/version-range.ts`.
 * See change: move-subagents-to-plugin (D9).
 */
const NUM = "(?:0|[1-9]\\d*|x|X|\\*)";
const TAIL = "(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?";
const PARTIAL = `v?${NUM}(?:\\.${NUM}(?:\\.${NUM}${TAIL})?)?`;
const COMPARATOR = new RegExp(`^(?:(?:<=|>=|<|>|=|~>|~|\\^)\\s*)?${PARTIAL}$`);
const HYPHEN = new RegExp(`^${PARTIAL}\\s+-\\s+${PARTIAL}$`);

/** True when `range` is a syntactically valid semver range string. */
export function isValidVersionRange(range: unknown): range is string {
  if (typeof range !== "string" || range.trim() === "") return false;
  return range.split("||").every((set) => {
    const s = set.trim();
    if (s === "") return true; // node-semver: an empty set matches anything
    if (HYPHEN.test(s)) return true;
    // Re-join an operator separated from its version by spaces, then check each comparator.
    return s
      .replace(/(<=|>=|<|>|=|~>|~|\^)\s+/g, "$1")
      .split(/\s+/)
      .every((c) => COMPARATOR.test(c));
  });
}
