/**
 * One-shot retirement of the per-folder "Float blocked sessions to top"
 * localStorage toggle (design D8). After the first `group_by_prefs_updated`
 * arrives, every legacy folder WITHOUT an explicit server-side mode gets
 * `status`; folders that already have one keep it. The legacy key is removed
 * only once the server's echoed prefs show an explicit mode for EVERY legacy
 * folder, so a dropped socket leaves it for the next load to retry. Never
 * runs before the snapshot (prefs unknown ⇒ no decision).
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
 * One migration step, run on every grouping snapshot. Sends `status` for each
 * legacy folder still lacking an explicit mode (once per `sent` set, i.e. per
 * page load), and clears the legacy key only when none is left — the server
 * echo is the confirmation. Returns the folders sent in THIS step.
 */
export function runUrgencyMigration(
  prefs: GroupByPrefs | undefined,
  setFolderGroupBy: (path: string, mode: "status") => void,
  sent: Set<string> = new Set(),
): string[] {
  if (!prefs) return [];
  const legacy = readLegacyUrgencyFolders();
  if (legacy === null) return [];
  const pending = decideUrgencyMigration(legacy, prefs);
  if (pending.length === 0) {
    clearLegacyUrgencyFolders();
    return [];
  }
  const toSend = pending.filter((p) => !sent.has(p));
  for (const path of toSend) {
    sent.add(path);
    setFolderGroupBy(path, "status");
  }
  return toSend;
}
