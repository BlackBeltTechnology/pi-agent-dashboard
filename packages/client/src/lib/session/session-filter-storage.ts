import { pathKey } from "@blackbelt-technology/pi-dashboard-shared/session-group-path.js";

const LEGACY_HIDDEN_KEY = "dashboard:hiddenSessions";
const ACTIVE_ONLY_KEY = "dashboard:activeOnly";
const COLLAPSED_GROUPS_KEY = "dashboard:collapsedGroups";
const TAG_AREA_OPEN_KEY = "sidebar.tagArea.open";
const INCLUDE_ARCHIVE_KEY = "sidebar.search.includeArchive";

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

// ── one-shot collapsed-folders migration ─────────────────────────────────
//
// Folder collapse moved from `localStorage` to the server's `preferences.json`
// (change: persist-folder-collapse-server-side). The live path no longer reads
// or writes local collapse state — `SessionList` renders straight from the
// `collapsedGroups` prop fed by the `collapsed_folders_updated` broadcast.
//
// These helpers exist ONLY to carry a pre-change `dashboard:collapsedGroups`
// value up to the server once, then delete it. A value that cannot be
// *confirmed* (its `set_folder_collapsed` echo never lands, e.g. the socket
// dropped first) is retained and retried on the next load — with a hard
// attempt backstop so a key the server never echoes cannot loop forever.
//
// The legacy record is a bare `string[]`; once the migration is running it is
// rewritten as `{ keys, attempts }` in the SAME key so the load counter
// survives a reload.
// See change: persist-folder-collapse-server-side (design D5).

/** Loads the migration may attempt before dropping an unconfirmed legacy set. */
export const COLLAPSED_MIGRATION_MAX_ATTEMPTS = 10;

export interface LegacyCollapsedGroupsRecord {
  /** Legacy folder keys awaiting confirmation, as last written. */
  keys: string[];
  /** Page loads the migration has been attempted (backstop counter). */
  attempts: number;
}

/**
 * Read the legacy collapsed-groups record. Tolerates both the pre-change bare
 * array (`attempts` 0) and the in-progress `{ keys, attempts }` shape. Returns
 * `null` only when the key is absent or unparseable — an empty array yields a
 * record with no keys so the caller can clear the stale key.
 */
export function readLegacyCollapsedGroups(): LegacyCollapsedGroupsRecord | null {
  try {
    const raw = getStorage().getItem(COLLAPSED_GROUPS_KEY);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (Array.isArray(parsed)) {
      return { keys: parsed.filter((v): v is string => typeof v === "string"), attempts: 0 };
    }
    if (parsed && typeof parsed === "object") {
      const rec = parsed as { keys?: unknown; attempts?: unknown };
      if (Array.isArray(rec.keys)) {
        const attempts =
          typeof rec.attempts === "number" && Number.isFinite(rec.attempts) && rec.attempts >= 0
            ? Math.floor(rec.attempts)
            : 0;
        return { keys: rec.keys.filter((v): v is string => typeof v === "string"), attempts };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist the in-progress migration record (keys + attempt counter). */
export function writeLegacyCollapsedGroups(record: LegacyCollapsedGroupsRecord): void {
  try {
    getStorage().setItem(
      COLLAPSED_GROUPS_KEY,
      JSON.stringify({ keys: record.keys, attempts: record.attempts }),
    );
  } catch { /* ignore */ }
}

/** Delete the legacy record — the migration is done (or dropped by backstop). */
export function clearLegacyCollapsedGroups(): void {
  try {
    getStorage().removeItem(COLLAPSED_GROUPS_KEY);
  } catch { /* ignore */ }
}

export interface CollapsedFoldersMigrationDecision {
  /** Canonical keys to send as `set_folder_collapsed { path, collapsed: true }`. */
  toSend: string[];
  /** Clear the legacy record now (all confirmed, or the backstop fired). */
  clearLegacy: boolean;
  /** Record to persist when `clearLegacy` is false (attempt counter advanced). */
  nextRecord: LegacyCollapsedGroupsRecord | null;
  /** True when the attempt backstop dropped a still-unconfirmed legacy set. */
  backstopDropped: boolean;
}

/**
 * Decide one migration step. Pure — all I/O is the caller's.
 *
 * `countAttempt` is true only on the FIRST evaluation after the connect
 * snapshot of this page load, so the backstop counts loads, not evaluations.
 *
 * Completion is monotone and union-safe: send only keys the server is known to
 * lack (a no-op mutation emits no echo and would hang the handshake), and stop
 * once every canonical legacy key is present in the latest known set.
 */
export function decideCollapsedFoldersMigration(args: {
  legacy: LegacyCollapsedGroupsRecord;
  /** Canonical server keys currently known to the client. */
  knownServerKeys: ReadonlySet<string>;
  /** Canonical keys already sent this load (never re-sent). */
  sentKeys: ReadonlySet<string>;
  platform: NodeJS.Platform;
  countAttempt: boolean;
}): CollapsedFoldersMigrationDecision {
  // Canonicalize + dedupe: `/repo/a` and `/repo/a/` are one key (design D5).
  const canonical: string[] = [];
  const seen = new Set<string>();
  for (const k of args.legacy.keys) {
    const ck = pathKey(k, args.platform);
    if (!seen.has(ck)) {
      seen.add(ck);
      canonical.push(ck);
    }
  }

  const remaining = canonical.filter((k) => !args.knownServerKeys.has(k));
  if (remaining.length === 0) {
    return { toSend: [], clearLegacy: true, nextRecord: null, backstopDropped: false };
  }

  const attempts = args.countAttempt ? args.legacy.attempts + 1 : args.legacy.attempts;
  if (attempts >= COLLAPSED_MIGRATION_MAX_ATTEMPTS) {
    return { toSend: [], clearLegacy: true, nextRecord: null, backstopDropped: true };
  }

  return {
    toSend: remaining.filter((k) => !args.sentKeys.has(k)),
    clearLegacy: false,
    nextRecord: { keys: canonical, attempts },
    backstopDropped: false,
  };
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
 * Include-archive search chip state. Absent ⇒ OFF (default) — archived
 * search is strictly opt-in.
 * See change: archive-sessions-lazy-load (#F13).
 */
export function getIncludeArchive(): boolean {
  try {
    return getStorage().getItem(INCLUDE_ARCHIVE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setIncludeArchive(value: boolean): void {
  try {
    getStorage().setItem(INCLUDE_ARCHIVE_KEY, String(value));
  } catch { /* ignore */ }
}
