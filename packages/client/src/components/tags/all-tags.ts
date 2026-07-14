/**
 * Flatten every session's `tags` into a deduped, sorted union — the vocabulary
 * that feeds `<TagEditor>` autocomplete and the sidebar "Your tags" filter
 * group. Pure; callers `useMemo` it over the session list so it recomputes only
 * when sessions change. See change: add-session-tags.
 */
export function allTagsInUse(sessions: Array<{ tags?: string[] }>): string[] {
  const set = new Set<string>();
  for (const s of sessions) {
    if (s.tags) for (const t of s.tags) set.add(t);
  }
  return [...set].sort();
}
