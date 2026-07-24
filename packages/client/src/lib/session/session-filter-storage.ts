const LEGACY_HIDDEN_KEY = "dashboard:hiddenSessions";
const ACTIVE_ONLY_KEY = "dashboard:activeOnly";
const COLLAPSED_GROUPS_KEY = "dashboard:collapsedGroups";
const TAG_AREA_OPEN_KEY = "sidebar.tagArea.open";

function getStorage(): Storage {
  return window.localStorage;
}

/** Remove legacy client-side hidden sessions key (server-side hidden is now source of truth) */
export function removeLegacyHiddenSessions(): void {
  try {
    getStorage().removeItem(LEGACY_HIDDEN_KEY);
  } catch { /* ignore */ }
}

export function getActiveOnly(): boolean {
  try {
    const raw = getStorage().getItem(ACTIVE_ONLY_KEY);
    if (raw === null) return true; // Default to ON
    return raw === "true";
  } catch {
    return true;
  }
}

export function setActiveOnly(value: boolean): void {
  getStorage().setItem(ACTIVE_ONLY_KEY, String(value));
}

export function getCollapsedGroups(): Set<string> {
  try {
    const raw = getStorage().getItem(COLLAPSED_GROUPS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id: unknown) => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function setCollapsedGroups(cwds: Set<string>): void {
  getStorage().setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...cwds]));
}

/**
 * Sidebar tag-area master-collapse state. Absent ⇒ collapsed (default).
 * See change: sidebar-tag-collapse-and-delete.
 */
export function getTagAreaOpen(): boolean {
  try {
    return getStorage().getItem(TAG_AREA_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function setTagAreaOpen(open: boolean): void {
  try {
    getStorage().setItem(TAG_AREA_OPEN_KEY, String(open));
  } catch { /* ignore */ }
}

/**
 * Remove collapsed group keys that don't match any current session cwds.
 * Returns the pruned set.
 */
export function pruneStaleCollapsedGroups(knownCwds: Set<string>): Set<string> {
  const collapsed = getCollapsedGroups();
  const pruned = new Set<string>();
  for (const cwd of collapsed) {
    if (knownCwds.has(cwd)) {
      pruned.add(cwd);
    }
  }
  setCollapsedGroups(pruned);
  return pruned;
}
