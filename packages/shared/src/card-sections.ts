/**
 * Session-card section visibility — ids, stored shape, and the single pure
 * resolver shared by the server store, the desktop card, and the mobile card.
 *
 * Resolution: folder override → global default → visible (design D5). A
 * section resolved visible still auto-hides when empty (callers AND this
 * into their existing gate). Folder keys follow the collapsed-folders fold
 * rule (`pathKey`, never realpath) so client and server agree (design D3).
 *
 * See change: configurable-session-card-sections.
 */
import { inferPlatform, pathKey } from "./session-group-path.js";
import type { DashboardSession } from "./types.js";

/** Built-in toggleable sections. Stored maps may carry other valid ids (future plugins). */
export const CARD_SECTION_IDS = [
  "openspec",
  "git",
  "process",
  "kb",
  "status",
  "flows",
  "memory",
  "tags",
  "spawn",
] as const;

export type CardSectionId = (typeof CARD_SECTION_IDS)[number];

/** Persisted shape (`preferences.json#cardSections`). Sparse: absent key = inherit. */
export interface CardSectionPrefs {
  global?: Record<string, boolean>;
  folders?: Record<string, Record<string, boolean>>;
}

/** Caps enforced by the server store (design D4). */
export const CARD_SECTIONS_MAX_FOLDERS = 1000;
export const CARD_SECTIONS_MAX_KEYS = 64;
export const CARD_SECTIONS_MAX_PATH = 4096;

const SECTION_ID_RE = /^[a-z0-9-]{1,64}$/;

export function isValidSectionId(id: unknown): id is string {
  return typeof id === "string" && SECTION_ID_RE.test(id);
}

/**
 * Accept only absolute paths (POSIX `/…`, drive `C:\…`/`C:/…`, UNC `\\…`) so a
 * folder key can never be a prototype-polluting token like `__proto__`.
 */
export function isValidFolderPath(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0 || p.length > CARD_SECTIONS_MAX_PATH) return false;
  return p.startsWith("/") || p.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(p);
}

/** Canonical folder key for a folder path (same fold rule as collapsed folders). */
export function cardSectionFolderKey(p: string): string {
  return pathKey(p, inferPlatform([p]));
}

/** Folder key a session's card resolves against: its sidebar group folder (worktree → main path). */
export function folderKeyForSession(session: Pick<DashboardSession, "cwd" | "gitWorktree">): string {
  const mainPath = session.gitWorktree?.mainPath;
  return cardSectionFolderKey(mainPath && mainPath.length > 0 ? mainPath : session.cwd);
}

function own(map: Record<string, boolean> | undefined, id: string): boolean | undefined {
  if (!map || !Object.hasOwn(map, id)) return undefined;
  const v = map[id];
  return typeof v === "boolean" ? v : undefined;
}

/** The folder's explicit override for `id`, or `null` when it inherits. */
export function getFolderOverride(
  prefs: CardSectionPrefs | undefined,
  folderKey: string | undefined,
  id: string,
): boolean | null {
  if (!folderKey || !prefs?.folders || !Object.hasOwn(prefs.folders, folderKey)) return null;
  return own(prefs.folders[folderKey], id) ?? null;
}

/** The global default for `id`, or `null` when unset (built-in default: visible). */
export function getGlobalValue(prefs: CardSectionPrefs | undefined, id: string): boolean | null {
  return own(prefs?.global, id) ?? null;
}

export function resolveCardSectionVisible(
  prefs: CardSectionPrefs | undefined,
  folderKey: string | undefined,
  id: string,
): boolean {
  return getFolderOverride(prefs, folderKey, id) ?? getGlobalValue(prefs, id) ?? true;
}

/** Number of folders with an explicit override for `id` (global settings block). */
export function countFolderOverrides(prefs: CardSectionPrefs | undefined, id: string): number {
  if (!prefs?.folders) return 0;
  let n = 0;
  for (const map of Object.values(prefs.folders)) if (own(map, id) !== undefined) n++;
  return n;
}
