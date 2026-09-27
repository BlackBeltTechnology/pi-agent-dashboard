/**
 * One-shot retirement of the per-folder "Float blocked sessions to top"
 * localStorage toggle (design D8). After the first `group_by_prefs_updated`
 * arrives, every legacy folder WITHOUT an explicit server-side mode gets
 * `status`; folders that already have one keep it. The legacy key is then
 * removed. Runs before the snapshot never (prefs unknown ⇒ no decision).
 * See change: session-list-group-by.
 */
import type { GroupByPrefs } from "@blackbelt-technology/pi-dashboard-shared/session-group-by.js";
import { inferPlatform } from "@blackbelt-technology/pi-dashboard-shared/session-group-path.js";
import { explicitGroupBy } from "./session-lanes.js";

/** Legacy key of the retired urgency-sort toggle (a JSON string[] of folder cwds). */
export const LEGACY_FOLDER_URGENCY_SORT_KEY = "dashboard:folder-urgency-sort";

/** `null` when the key is absent (nothing to migrate); `[]` when present but empty/corrupt. */
function readLegacyUrgencyFolders(): string[] | null {
  try {
    const raw = localStorage.getItem(LEGACY_FOLDER_URGENCY_SORT_KEY);
    if (raw === null) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function clearLegacyUrgencyFolders(): void {
  try {
    localStorage.removeItem(LEGACY_FOLDER_URGENCY_SORT_KEY);
  } catch {
    /* noop */
  }
}

/** Folders to set to `status`: legacy entries with no explicit per-folder mode. */
export function decideUrgencyMigration(legacy: string[], prefs: GroupByPrefs): string[] {
  const platform = inferPlatform([...legacy, ...Object.keys(prefs.folderGroupBy)]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cwd of legacy) {
    if (seen.has(cwd)) continue;
    seen.add(cwd);
    if (explicitGroupBy(cwd, prefs, platform) === undefined) out.push(cwd);
  }
  return out;
}

/**
 * Run the migration once `prefs` (the server snapshot) is known. Returns the
 * folders it migrated. Idempotent: the legacy key is gone after the first run.
 */
export function runUrgencyMigration(
  prefs: GroupByPrefs | undefined,
  setFolderGroupBy: (path: string, mode: "status") => void,
): string[] {
  if (!prefs) return [];
  const legacy = readLegacyUrgencyFolders();
  if (legacy === null) return [];
  const toSet = decideUrgencyMigration(legacy, prefs);
  for (const path of toSet) setFolderGroupBy(path, "status");
  clearLegacyUrgencyFolders();
  return toSet;
}
