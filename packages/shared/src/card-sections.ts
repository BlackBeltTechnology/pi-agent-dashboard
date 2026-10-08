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
  // Session-card line, directory-card blocks, effects (add-focus-mode-and-card-block-toggles).
  "openspec-badge",
  "folder-git",
  "folder-banner",
  "folder-openspec",
  "folder-create",
  "folder-ended",
  "fx-status-animation",
  "fx-selected-glow",
] as const;

export type CardSectionId = (typeof CARD_SECTION_IDS)[number];

/** Persisted shape (`preferences.json#cardSections`). Sparse: absent key = inherit. */
export interface CardSectionPrefs {
  global?: Record<string, boolean>;
  folders?: Record<string, Record<string, boolean>>;
  focus?: FocusState;
}

export type FolderListMode = "classic" | "accordion";

/** Sparse overlay applied while Focus mode is on (design D1). */
export interface FocusProfile {
  sections?: Record<string, boolean>;
  folderListMode?: FolderListMode;
}

export interface FocusState {
  enabled?: boolean;
  /** Absent = built-in `DEFAULT_FOCUS_PROFILE`. */
  profile?: FocusProfile;
}

/** Cap on stored profile keys (a profile enumerates every offered id). */
export const FOCUS_PROFILE_MAX_KEYS = 256;

/** Explicit ids hidden by the built-in profile; per-plugin ids are covered by a prefix rule. */
export const DEFAULT_FOCUS_PROFILE: Required<Pick<FocusProfile, "folderListMode">> & { sections: Record<string, boolean> } = {
  sections: Object.fromEntries(
    [
      "openspec", "openspec-badge", "git", "tags", "spawn", "kb", "status", "flows", "memory",
      "folder-git", "folder-banner", "folder-openspec", "folder-create", "folder-ended",
      "fx-status-animation", "fx-selected-glow",
    ].map((id) => [id, false]),
  ),
  folderListMode: "accordion",
};

const PLUGIN_ID_PREFIXES = {
  badge: "badge-",
  actionbar: "actionbar-",
  pill: "pill-",
} as const;
export type PluginSectionKind = keyof typeof PLUGIN_ID_PREFIXES;

const PLUGIN_PREFIX_RE = /^(badge|actionbar|pill)-/;

/** Caps enforced by the server store (design D4). */
export const CARD_SECTIONS_MAX_FOLDERS = 1000;
export const CARD_SECTIONS_MAX_KEYS = 64;
export const CARD_SECTIONS_MAX_PATH = 4096;

const SECTION_ID_RE = /^[a-z0-9-]{1,64}$/;

export function isValidSectionId(id: unknown): id is string {
  return typeof id === "string" && SECTION_ID_RE.test(id);
}

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Strict validation of a client-supplied focus profile. Returns the cleaned
 * profile, or `null` when ANYTHING is malformed (bad id, non-boolean value,
 * bad mode, >FOCUS_PROFILE_MAX_KEYS) so callers reject without mutation.
 */
export function validateFocusProfile(raw: unknown): FocusProfile | null {
  if (!isPlainRecord(raw)) return null;
  const out: FocusProfile = {};
  if (raw.sections !== undefined) {
    if (!isPlainRecord(raw.sections)) return null;
    const entries = Object.entries(raw.sections);
    if (entries.length > FOCUS_PROFILE_MAX_KEYS) return null;
    const sections: Record<string, boolean> = {};
    for (const [id, v] of entries) {
      if (!isValidSectionId(id) || typeof v !== "boolean") return null;
      sections[id] = v;
    }
    out.sections = sections;
  }
  if (raw.folderListMode !== undefined) {
    if (raw.folderListMode !== "classic" && raw.folderListMode !== "accordion") return null;
    out.folderListMode = raw.folderListMode;
  }
  return out;
}

/** Load-time lenient variant: drops invalid entries, caps keys, never throws. */
export function sanitizeFocusProfile(raw: unknown): FocusProfile | undefined {
  if (!isPlainRecord(raw)) return undefined;
  const out: FocusProfile = {};
  if (isPlainRecord(raw.sections)) {
    const sections: Record<string, boolean> = {};
    let n = 0;
    for (const [id, v] of Object.entries(raw.sections)) {
      if (n >= FOCUS_PROFILE_MAX_KEYS) break;
      if (isValidSectionId(id) && typeof v === "boolean") {
        sections[id] = v;
        n++;
      }
    }
    out.sections = sections;
  }
  if (raw.folderListMode === "classic" || raw.folderListMode === "accordion") out.folderListMode = raw.folderListMode;
  return out;
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

/** Section id for a plugin contribution, or `null` when the derived id is invalid (stays visible). */
export function pluginSectionId(kind: PluginSectionKind, pluginId: string): string | null {
  const id = `${PLUGIN_ID_PREFIXES[kind]}${pluginId}`;
  return isValidSectionId(id) ? id : null;
}

/** Visibility of one plugin's contribution; an invalid derived id stays visible. */
export function isPluginSectionVisible(
  prefs: CardSectionPrefs | undefined,
  folderKey: string | undefined,
  kind: PluginSectionKind,
  pluginId: string,
): boolean {
  const id = pluginSectionId(kind, pluginId);
  return id === null ? true : resolveCardSectionVisible(prefs, folderKey, id);
}

/** Legacy parent whose folder/global value an unset child inherits. */
export function parentOf(id: string): string | null {
  if (id === "openspec-badge") return "openspec";
  if (id.startsWith("badge-")) return "status";
  return null;
}

const isFxId = (id: string) => id.startsWith("fx-");

/** The built-in profile's value for `id` (explicit list, else the per-plugin prefix rule). */
export function defaultFocusValue(id: string): boolean | undefined {
  const v = own(DEFAULT_FOCUS_PROFILE.sections, id);
  if (v !== undefined) return v;
  return PLUGIN_PREFIX_RE.test(id) ? false : undefined;
}

function focusValue(prefs: CardSectionPrefs | undefined, id: string): boolean | undefined {
  const focus = prefs?.focus;
  if (!focus?.enabled) return undefined;
  if (focus.profile) return own(focus.profile.sections, id);
  return defaultFocusValue(id);
}

/** Explicit copy of the built-in profile over `offeredIds` (copy-on-first-edit). */
export function builtinProfileFor(offeredIds: readonly string[]): FocusProfile {
  const sections: Record<string, boolean> = {};
  for (const id of offeredIds) {
    const v = defaultFocusValue(id);
    if (v !== undefined) sections[id] = v;
  }
  return { sections, folderListMode: DEFAULT_FOCUS_PROFILE.folderListMode };
}

/**
 * "Save current": per offered id, the Focus-off, no-folder resolution as an
 * explicit value (global → legacy parent's global → visible), plus the
 * configured folder list mode. Never drifts when globals change later.
 */
export function captureFocusProfile(
  prefs: CardSectionPrefs | undefined,
  offeredIds: readonly string[],
  folderListMode: FolderListMode,
): FocusProfile {
  const base: CardSectionPrefs = { global: prefs?.global };
  const sections: Record<string, boolean> = {};
  for (const id of offeredIds) sections[id] = resolveCardSectionVisible(base, undefined, id);
  return { sections, folderListMode };
}

/** focus → folder → global → legacy parent (folder → global) → visible. `fx-*` ignore folders. */
export function resolveCardSectionVisible(
  prefs: CardSectionPrefs | undefined,
  folderKey: string | undefined,
  id: string,
): boolean {
  const fk = isFxId(id) ? undefined : folderKey;
  const focus = focusValue(prefs, id);
  if (focus !== undefined) return focus;
  const direct = getFolderOverride(prefs, fk, id) ?? getGlobalValue(prefs, id);
  if (direct !== null) return direct;
  const parent = parentOf(id);
  if (parent) return getFolderOverride(prefs, fk, parent) ?? getGlobalValue(prefs, parent) ?? true;
  return true;
}

/** Effective folder list mode: Focus profile (when on) overrides the configured one. */
export function resolveFolderListMode(
  prefs: CardSectionPrefs | undefined,
  config: { folderListMode?: FolderListMode },
): FolderListMode {
  const focus = prefs?.focus;
  if (focus?.enabled) {
    const mode = (focus.profile ?? DEFAULT_FOCUS_PROFILE).folderListMode;
    if (mode) return mode;
  }
  return config.folderListMode === "accordion" ? "accordion" : "classic";
}

/** Number of folders with an explicit override for `id` (global settings block). */
export function countFolderOverrides(prefs: CardSectionPrefs | undefined, id: string): number {
  if (!prefs?.folders) return 0;
  let n = 0;
  for (const map of Object.values(prefs.folders)) if (own(map, id) !== undefined) n++;
  return n;
}
