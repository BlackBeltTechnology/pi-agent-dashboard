/**
 * One-shot migration: `customEntryFallback` → `customEventGroups.other`.
 *
 * Covers the per-session half (design D7): every `.meta.json` in the pi
 * sessions dir whose `displayPrefsOverride` still carries the legacy field is
 * migrated in place (atomic write via `writeSessionMeta`). The global-prefs
 * half runs inside `createPreferencesStore` at load.
 *
 * Idempotent (task 6.2): the legacy field is dropped on write, so a second
 * boot finds nothing to do; an explicit `customEventGroups.other` is never
 * overwritten. See change: add-custom-event-group-filters.
 */
import fs from "node:fs";
import path from "node:path";

import {
  migrateLegacyCustomEntryFallback,
} from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { readSessionMeta, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { resolvePiSessionsDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

export interface CustomEntryFallbackMigrationResult {
  /** `.meta.json` files whose `displayPrefsOverride` carried the legacy field. */
  migratedOverrides: string[];
}

export function migrateCustomEntryFallbackOverrides(
  sessionsDir: string = resolvePiSessionsDir(),
  log: (message: string) => void = (m) => console.log(m),
): CustomEntryFallbackMigrationResult {
  const migratedOverrides: string[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(sessionsDir);
  } catch {
    // No sessions dir yet — nothing to migrate.
    return { migratedOverrides };
  }
  for (const name of entries) {
    if (!name.endsWith(".meta.json")) continue;
    const metaFile = path.join(sessionsDir, name);
    const meta = readSessionMeta(metaFile.replace(/\.meta\.json$/, ".jsonl"));
    const override = meta?.displayPrefsOverride as Record<string, unknown> | undefined;
    if (!override || typeof override !== "object") continue;
    if (typeof override.customEntryFallback !== "boolean") continue;
    const migrated = migrateLegacyCustomEntryFallback(override);
    writeSessionMeta(metaFile.replace(/\.meta\.json$/, ".jsonl"), {
      ...meta,
      displayPrefsOverride: migrated,
    } as Parameters<typeof writeSessionMeta>[1]);
    migratedOverrides.push(name);
  }
  if (migratedOverrides.length > 0) {
    log(
      `[custom-event-groups] migrated customEntryFallback → customEventGroups.other in ${migratedOverrides.length} session override(s)`,
    );
  }
  return { migratedOverrides };
}
