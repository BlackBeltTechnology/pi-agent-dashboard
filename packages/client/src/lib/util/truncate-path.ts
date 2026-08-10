/**
 * Middle-truncate a filesystem path to fit within maxLen characters.
 * Preserves leading segments and the last segment (directory name),
 * replacing omitted middle segments with "…".
 *
 * Example: truncatePathMiddle("/Users/robson/Project/some/deep/judo-meta-esm", 35)
 *        → "/Users/robson/Project…/judo-meta-esm"
 */
export function truncatePathMiddle(path: string, maxLen: number): string {
  if (!path || path.length <= maxLen) return path;

  const segments = path.split("/");
  // segments[0] is "" for absolute paths (leading /)

  // If only root + one segment (e.g., "/judo-ng"), return as-is
  if (segments.length <= 2) return path;

  const last = segments[segments.length - 1];
  const ellipsis = "…";

  // Build prefix by adding segments until we'd exceed budget
  // Budget = maxLen - ellipsis(1) - slash(1) - last segment length
  const budget = maxLen - ellipsis.length - 1 - last.length;
  if (budget <= 0) {
    // Can't even fit prefix + ellipsis + last — return untruncated
    return path;
  }

  let prefix = "";
  for (let i = 0; i < segments.length - 1; i++) {
    const next = i === 0 ? segments[i] : prefix + "/" + segments[i];
    if (next.length > budget) break;
    prefix = next;
  }

  return prefix + ellipsis + "/" + last;
}
