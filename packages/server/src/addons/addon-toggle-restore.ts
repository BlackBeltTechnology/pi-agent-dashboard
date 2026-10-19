/**
 * Machine-local restore records for the Add-ons hub toggle.
 *
 * Turning a feature off rewrites each owned global `packages[]` entry in place
 * into the all-empty filter form; the exact previous entry (string or object)
 * and the value written are recorded here so turning it back on is exact.
 * Keyed by settings-file path + package identity. A separate file (not a
 * section of `resource-entry-ownership.json`, whose shape is
 * `projectPath → type → string[]` and cannot hold whole entries).
 *
 * Atomic tmp+rename writes. A missing or malformed file reads as empty and is
 * logged — the enable rule table still recovers (design D12).
 *
 * Callers hold the settings-file write lock; this module takes no lock.
 * See change: addons-hub-feature-catalog (design D4, D12).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RestoreRecord {
  settingsPath: string;
  identity: string;
  /** The entry exactly as it stood before the hub filtered it. */
  original: unknown;
  /** The all-empty filter-form entry the hub wrote. */
  filtered: unknown;
}

export type RestoreStore = Record<string, RestoreRecord>;

export interface RestoreLog {
  warn: (msg: string) => void;
}

export function restoreFilePath(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "addon-toggle-restore.json");
}

function restoreKey(settingsPath: string, identity: string): string {
  return `${settingsPath}\u0000${identity}`;
}

/** Read the whole store; malformed or unreadable → empty + warning. */
export function readRestoreStore(log?: RestoreLog): RestoreStore {
  const file = restoreFilePath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.warn(`[addons] cannot read ${file}: ${(err as Error).message}; treating as empty`);
    }
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as { records?: unknown };
    const records = parsed?.records;
    if (!records || typeof records !== "object" || Array.isArray(records)) throw new Error("no records object");
    return records as RestoreStore;
  } catch (err) {
    log?.warn(`[addons] ${file} is malformed (${(err as Error).message}); treating as empty`);
    return {};
  }
}

/** Atomically replace the whole store (tmp + rename). */
export function writeRestoreStore(store: RestoreStore): void {
  const file = restoreFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, records: store }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function getRestore(store: RestoreStore, settingsPath: string, identity: string): RestoreRecord | undefined {
  return store[restoreKey(settingsPath, identity)];
}

export function setRestore(store: RestoreStore, record: RestoreRecord): void {
  store[restoreKey(record.settingsPath, record.identity)] = record;
}

export function deleteRestore(store: RestoreStore, settingsPath: string, identity: string): void {
  delete store[restoreKey(settingsPath, identity)];
}

/** Would `gcRestore` drop anything? Read-only, so a catalog read can skip the locks when it would not. */
export function hasStaleRestore(settingsPath: string, liveIdentities: ReadonlySet<string>, log?: RestoreLog): boolean {
  return Object.values(readRestoreStore(log)).some((rec) => rec.settingsPath === settingsPath && !liveIdentities.has(rec.identity));
}

/**
 * Drop every record of `settingsPath` whose identity is no longer a global
 * `packages[]` entry (uninstalled, reset to its published variant, moved
 * scope), so a later reinstall starts with no record. Writes only on change.
 * Returns the number of records removed.
 */
export function gcRestore(settingsPath: string, liveIdentities: ReadonlySet<string>, log?: RestoreLog): number {
  const store = readRestoreStore(log);
  let removed = 0;
  for (const [key, rec] of Object.entries(store)) {
    if (rec.settingsPath === settingsPath && !liveIdentities.has(rec.identity)) {
      delete store[key];
      removed++;
    }
  }
  if (removed > 0) writeRestoreStore(store);
  return removed;
}
