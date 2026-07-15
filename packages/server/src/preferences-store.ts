/**
 * Global UI preferences store — JSON-backed with debounced writes.
 * Stores cross-session state: pinned directories, session ordering, and
 * folder-workspaces (named, collapsible containers grouping folders).
 *
 * Workspace membership is authoritative and orthogonal to pinning — see
 * change: folder-workspaces. A folder may live in `pinnedDirectories`
 * AND a workspace's `folders[]` independently; the two lists do not
 * deduplicate against each other.
 *
 * Replaces `state-store.ts` (hidden state moved to per-session `.meta.json`).
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Workspace } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { CONFIG_DIR } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DisplayPrefs, PartialDisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import type { LiveServerTarget } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import { normalizePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { safeRealpathSync } from "./resolve-path.js";

export const PREFERENCES_FILE = path.join(CONFIG_DIR, "preferences.json");

const NAME_MAX = 80;

interface PreferencesData {
  sessionOrder: Record<string, string[]>;
  pinnedDirectories: string[];
  /**
   * User-curated favorite model labels (`"provider/id"`). Insertion-ordered,
   * deduped. Absent in legacy files → defaults to `[]`.
   * See change: enrich-model-selector-capabilities-favorites.
   */
  favoriteModels?: string[];
  workspaces?: Workspace[];
  /**
   * Global chat-display preferences. `undefined` means "never seeded" —
   * the first-launch modal SHALL prompt the user to choose a preset.
   * See change: configurable-chat-display.
   */
  displayPrefs?: DisplayPrefs;
  /**
   * Per-cwd signature of the workflow set at the time the dashboard last ran
   * `openspec update` for that cwd. Used to compute profile staleness.
   * Absence => never updated via dashboard ("unknown").
   * See change: add-openspec-profile-settings.
   */
  openspecUpdateSignatures?: Record<string, string>;
  /**
   * Opt-in: after a successful worktree spawn, auto-run the trusted
   * `worktreeInit` hook (no manual Initialize click). Absent/legacy files →
   * `false`. Untrusted hooks never auto-run regardless of this flag.
   * See change: auto-init-worktree-on-spawn.
   */
  autoInitWorktreeOnSpawn?: boolean;
  /**
   * Global toggle for automatic session topic-naming by the bridge. Defaults
   * to `true` when absent. Relayed to bridges via config push; the bridge
   * attempts naming only when this is true. See change: add-auto-session-naming.
   */
  autoNameSessions?: boolean;
  /**
   * First-run marker for `PI_DASHBOARD_PIN_DIRS` seeding. Set true the first
   * time the store loads; gates env-driven pin seeding so it never re-seeds
   * after the user has edited pins via the UI (even after unpinning all).
   * See change: docker-packaging.
   */
  pinSeeded?: boolean;
  /**
   * User-curated live-server-preview allowlist (loopback dev-server targets).
   * Absent in legacy files → `[]`. See change: improve-content-editor (§6).
   */
  liveServers?: LiveServerTarget[];
}

export interface PreferencesStore {
  getSessionOrder(): Record<string, string[]>;
  setSessionOrder(order: Record<string, string[]>): void;
  getPinnedDirectories(): string[];
  setPinnedDirectories(dirs: string[]): void;
  pinDirectory(dirPath: string): void;
  unpinDirectory(dirPath: string): void;
  reorderPinnedDirs(dirs: string[]): void;
  // ── favorite models (enrich-model-selector-capabilities-favorites) ──
  getFavoriteModels(): string[];
  setFavoriteModels(labels: string[]): void;
  /** Append label if absent (dedupe). No-op when already present. */
  addFavoriteModel(label: string): void;
  /** Remove label if present. No-op when absent. */
  removeFavoriteModel(label: string): void;
  // ── folder-workspaces ────────────────────────────────────────────
  getWorkspaces(): Workspace[];
  /** Returns the created workspace, or null on invalid name. */
  createWorkspace(name: string): Workspace | null;
  /** Returns true on mutation, false on unknown id / invalid name. */
  renameWorkspace(id: string, name: string): boolean;
  /** Returns true on mutation, false on unknown id. */
  deleteWorkspace(id: string): boolean;
  /** Returns true on mutation, false on unknown id or no-op (same value). */
  setWorkspaceCollapsed(id: string, collapsed: boolean): boolean;
  /**
   * Adds `path` to workspace `id`. Single-membership invariant: removes
   * the canonicalized path from every other workspace first. Returns
   * true on mutation, false on unknown id or already-member (no-op).
   */
  addFolderToWorkspace(id: string, dirPath: string): boolean;
  /** Returns true on mutation, false on unknown id or not-member. */
  removeFolderFromWorkspace(id: string, dirPath: string): boolean;
  /**
   * Replaces a workspace's folder order. Rejected if `paths` does not
   * equal the current member set (after canonicalization). Returns true
   * on mutation, false otherwise.
   */
  reorderWorkspaceFolders(id: string, paths: string[]): boolean;
  /** Reorders workspaces. Rejected if `ids` doesn't equal current id set. */
  reorderWorkspaces(ids: string[]): boolean;
  // ── configurable-chat-display ──────────────────────────────
  /** Returns `undefined` when display prefs have never been seeded. */
  getDisplayPrefs(): DisplayPrefs | undefined;
  /**
   * Deep-merges `partial` over current display prefs and persists.
   * `toolCalls` is merged field-by-field. When no prefs exist yet,
   * uses the values from `partial` for top-level fields and from
   * `partial.toolCalls` (if any) for the nested record.
   */
  setDisplayPrefs(partial: PartialDisplayPrefs): DisplayPrefs;
  // ── add-openspec-profile-settings ──────────────────────────
  /** Returns the recorded workflow-set signature for `cwd`, or undefined. */
  getOpenSpecUpdateSignature(cwd: string): string | undefined;
  /** Records the workflow-set signature for `cwd` (after a dashboard-run update). */
  setOpenSpecUpdateSignature(cwd: string, signature: string): void;
  // ── auto-init-worktree-on-spawn ────────────────────────────
  /** Returns the opt-in auto-init-on-spawn flag. Absent → `false`. */
  getAutoInitWorktreeOnSpawn(): boolean;
  /** Persists the opt-in auto-init-on-spawn flag. */
  setAutoInitWorktreeOnSpawn(value: boolean): void;
  // ── add-auto-session-naming ────────────────────────────────
  /** Returns the auto-session-naming toggle. Absent → `true` (default ON). */
  getAutoNameSessions(): boolean;
  /** Persists the auto-session-naming toggle. */
  setAutoNameSessions(value: boolean): void;
  // ── live-server-preview (improve-content-editor §6) ────────
  /** Returns the persisted live-server allowlist. Absent → `[]`. */
  getLiveServers(): LiveServerTarget[];
  /** Replaces the live-server allowlist. */
  setLiveServers(targets: LiveServerTarget[]): void;
  flush(): void;
  dispose(): void;
}

const DEBOUNCE_MS = 1000;

function canonicalize(p: string): string {
  // IMPORTANT: wrap normalizePath in an arrow so Array.prototype.map's
  // (element, index, array) signature does not leak `index: number` into
  // its 2nd `platform` parameter. See preferences-store git blame.
  return safeRealpathSync(normalizePath(p));
}

function dedupePreserveOrder(arr: string[]): string[] {
  return [...new Set(arr)];
}

function setEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

function sanitizeName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > NAME_MAX) return null;
  return trimmed;
}

/**
 * Legacy backfill: files predating `reasoningAutoCollapseMs` /
 * `keepReasoningOpenUntilTurnEnds` load with the field absent. Single chokepoint
 * guaranteeing the client always receives a number (default 30000) and a boolean
 * (default false). See changes: reasoning-auto-collapse-timer,
 * keep-reasoning-open-until-turn-ends.
 */
function backfillDisplayPrefs(prefs: DisplayPrefs | undefined): DisplayPrefs | undefined {
  if (!prefs) return prefs;
  let out = prefs;
  if (typeof out.reasoningAutoCollapseMs !== "number") {
    out = { ...out, reasoningAutoCollapseMs: 30000 };
  }
  if (typeof out.keepReasoningOpenUntilTurnEnds !== "boolean") {
    out = { ...out, keepReasoningOpenUntilTurnEnds: false };
  }
  if (typeof out.toolGroupDefaultCollapsed !== "boolean") {
    out = { ...out, toolGroupDefaultCollapsed: false };
  }
  // Legacy prefs predating the change-summary block default it ON, matching
  // the standard/everything presets. See change: add-change-summary-table.
  if (typeof out.changeSummaryTable !== "boolean") {
    out = { ...out, changeSummaryTable: true };
  }
  // Legacy prefs predating the reserved process line default it OFF, matching
  // the simple/standard presets. See change: stable-process-line.
  if (typeof out.reserveProcessLineAtIdle !== "boolean") {
    out = { ...out, reserveProcessLineAtIdle: false };
  }
  return out;
}

function normalizeWorkspaceOnLoad(ws: Workspace): Workspace {
  const folders = dedupePreserveOrder((ws.folders ?? []).map((p) => canonicalize(p)));
  return {
    id: typeof ws.id === "string" && ws.id.length > 0 ? ws.id : `ws_${randomUUID()}`,
    name: typeof ws.name === "string" ? ws.name : "",
    collapsed: Boolean(ws.collapsed),
    folders,
  };
}

export function createPreferencesStore(filePath: string = PREFERENCES_FILE): PreferencesStore {
  const data: PreferencesData = readJsonFile<PreferencesData>(filePath, {
    sessionOrder: {},
    pinnedDirectories: [],
    workspaces: [],
  });
  let sessionOrder: Record<string, string[]> = data.sessionOrder ?? {};
  // Normalize + resolve symlinks in stored pinned paths on load. Normalize
  // FIRST so cosmetic drift (trailing separator, mixed separators,
  // drive-letter case on Windows) collapses before realpath — then
  // realpath handles symlinks. Order matters: realpath can fail for
  // not-yet-existing paths, so we keep its best-effort fallback.
  // See change: platform-path-normalization.
  const rawPinned = data.pinnedDirectories ?? [];
  let pinnedDirectories: string[] = rawPinned
    .map((p) => normalizePath(p))
    .map((p) => safeRealpathSync(p));
  pinnedDirectories = dedupePreserveOrder(pinnedDirectories);

  // First-run pin seeding from PI_DASHBOARD_PIN_DIRS (docker-packaging).
  // Seed only when never seeded before AND no pins are persisted, so UI
  // edits (including unpinning all) always win. The `pinSeeded` marker is
  // persisted on first load so subsequent runs ignore the env entirely.
  let pinSeeded: boolean = data.pinSeeded === true;
  if (!pinSeeded) {
    if (rawPinned.length === 0) {
      const seed = (process.env.PI_DASHBOARD_PIN_DIRS ?? "")
        .split(path.delimiter)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((p) => safeRealpathSync(normalizePath(p)));
      if (seed.length > 0) {
        pinnedDirectories = dedupePreserveOrder(seed);
      }
    }
    pinSeeded = true;
  }

  const rawWorkspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
  let workspaces: Workspace[] = rawWorkspaces.map(normalizeWorkspaceOnLoad);
  let displayPrefs: DisplayPrefs | undefined = backfillDisplayPrefs(data.displayPrefs);
  let openspecUpdateSignatures: Record<string, string> = data.openspecUpdateSignatures ?? {};
  // Opt-in auto-init flag. Absent/non-boolean → false (today's behavior).
  let autoInitWorktreeOnSpawn: boolean = data.autoInitWorktreeOnSpawn === true;
  // Auto-naming toggle. Absent/non-false → true (default ON).
  let autoNameSessions: boolean = data.autoNameSessions !== false;
  let liveServers: LiveServerTarget[] = Array.isArray(data.liveServers) ? data.liveServers : [];
  // Favorite model labels — deduped, insertion-ordered. Default [] for legacy files.
  let favoriteModels: string[] = dedupePreserveOrder(
    Array.isArray(data.favoriteModels) ? data.favoriteModels.filter((l) => typeof l === "string") : [],
  );
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty =
    data.pinSeeded !== true ||
    pinnedDirectories.length !== rawPinned.length ||
    pinnedDirectories.some((p, i) => p !== rawPinned[i]) ||
    workspaces.length !== rawWorkspaces.length ||
    workspaces.some((ws, i) => {
      const raw = rawWorkspaces[i];
      if (!raw) return true;
      const rf = (raw.folders ?? []) as string[];
      return ws.folders.length !== rf.length || ws.folders.some((f, j) => f !== rf[j]);
    });

  function scheduleSave(): void {
    dirty = true;
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (dirty) {
        dirty = false;
        writeJsonFile(filePath, { sessionOrder, pinnedDirectories, favoriteModels, workspaces, displayPrefs, openspecUpdateSignatures, autoInitWorktreeOnSpawn, autoNameSessions, pinSeeded, liveServers } satisfies PreferencesData);
      }
    }, DEBOUNCE_MS);
  }

  function flushNow(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (dirty) {
      dirty = false;
      writeJsonFile(filePath, { sessionOrder, pinnedDirectories, favoriteModels, workspaces, displayPrefs, openspecUpdateSignatures, autoInitWorktreeOnSpawn, autoNameSessions, pinSeeded, liveServers } satisfies PreferencesData);
    }
  }

  if (dirty) scheduleSave();

  function findWs(id: string): Workspace | undefined {
    return workspaces.find((w) => w.id === id);
  }

  return {
    getSessionOrder(): Record<string, string[]> {
      return sessionOrder;
    },

    setSessionOrder(order: Record<string, string[]>): void {
      sessionOrder = order;
      scheduleSave();
    },

    getLiveServers(): LiveServerTarget[] {
      return [...liveServers];
    },

    setLiveServers(targets: LiveServerTarget[]): void {
      liveServers = [...targets];
      scheduleSave();
    },

    getPinnedDirectories(): string[] {
      return [...pinnedDirectories];
    },

    setPinnedDirectories(dirs: string[]): void {
      pinnedDirectories = [...dirs];
      scheduleSave();
    },

    pinDirectory(dirPath: string): void {
      if (pinnedDirectories.includes(dirPath)) return;
      pinnedDirectories.push(dirPath);
      scheduleSave();
    },

    unpinDirectory(dirPath: string): void {
      const idx = pinnedDirectories.indexOf(dirPath);
      if (idx === -1) return;
      pinnedDirectories.splice(idx, 1);
      scheduleSave();
    },

    reorderPinnedDirs(dirs: string[]): void {
      pinnedDirectories = [...dirs];
      scheduleSave();
    },

    // ── favorite models ─────────────────────────────────────

    getFavoriteModels(): string[] {
      return [...favoriteModels];
    },

    setFavoriteModels(labels: string[]): void {
      favoriteModels = dedupePreserveOrder(labels);
      scheduleSave();
    },

    addFavoriteModel(label: string): void {
      if (favoriteModels.includes(label)) return;
      favoriteModels.push(label);
      scheduleSave();
    },

    removeFavoriteModel(label: string): void {
      const idx = favoriteModels.indexOf(label);
      if (idx === -1) return;
      favoriteModels.splice(idx, 1);
      scheduleSave();
    },

    // ── folder-workspaces ───────────────────────────────────────────

    getWorkspaces(): Workspace[] {
      // Deep-ish clone so callers can't mutate internal state.
      return workspaces.map((w) => ({ ...w, folders: [...w.folders] }));
    },

    createWorkspace(name: string): Workspace | null {
      const clean = sanitizeName(name);
      if (clean === null) return null;
      const ws: Workspace = {
        id: `ws_${randomUUID()}`,
        name: clean,
        collapsed: false,
        folders: [],
      };
      workspaces.push(ws);
      scheduleSave();
      return { ...ws, folders: [...ws.folders] };
    },

    renameWorkspace(id: string, name: string): boolean {
      const clean = sanitizeName(name);
      if (clean === null) return false;
      const ws = findWs(id);
      if (!ws) return false;
      if (ws.name === clean) return false;
      ws.name = clean;
      scheduleSave();
      return true;
    },

    deleteWorkspace(id: string): boolean {
      const idx = workspaces.findIndex((w) => w.id === id);
      if (idx === -1) return false;
      workspaces.splice(idx, 1);
      scheduleSave();
      return true;
    },

    setWorkspaceCollapsed(id: string, collapsed: boolean): boolean {
      const ws = findWs(id);
      if (!ws) return false;
      if (ws.collapsed === collapsed) return false;
      ws.collapsed = collapsed;
      scheduleSave();
      return true;
    },

    addFolderToWorkspace(id: string, dirPath: string): boolean {
      const ws = findWs(id);
      if (!ws) return false;
      const canon = canonicalize(dirPath);
      if (ws.folders.includes(canon)) return false;
      // Single-membership invariant: detach from every OTHER workspace
      // first. Idempotent — no-op if not currently in any other workspace.
      for (const other of workspaces) {
        if (other.id === id) continue;
        const i = other.folders.indexOf(canon);
        if (i !== -1) other.folders.splice(i, 1);
      }
      ws.folders.push(canon);
      scheduleSave();
      return true;
    },

    removeFolderFromWorkspace(id: string, dirPath: string): boolean {
      const ws = findWs(id);
      if (!ws) return false;
      const canon = canonicalize(dirPath);
      const i = ws.folders.indexOf(canon);
      if (i === -1) return false;
      ws.folders.splice(i, 1);
      scheduleSave();
      return true;
    },

    reorderWorkspaceFolders(id: string, paths: string[]): boolean {
      const ws = findWs(id);
      if (!ws) return false;
      const canon = paths.map((p) => canonicalize(p));
      // Reject if the supplied set != current set.
      if (!setEquals(canon, ws.folders)) return false;
      // Reject duplicates within the new order.
      if (new Set(canon).size !== canon.length) return false;
      ws.folders = canon;
      scheduleSave();
      return true;
    },

    getDisplayPrefs(): DisplayPrefs | undefined {
      return displayPrefs ? { ...displayPrefs, toolCalls: { ...displayPrefs.toolCalls } } : undefined;
    },

    getOpenSpecUpdateSignature(cwd: string): string | undefined {
      return openspecUpdateSignatures[cwd];
    },

    setOpenSpecUpdateSignature(cwd: string, signature: string): void {
      if (openspecUpdateSignatures[cwd] === signature) return;
      openspecUpdateSignatures = { ...openspecUpdateSignatures, [cwd]: signature };
      scheduleSave();
    },

    getAutoInitWorktreeOnSpawn(): boolean {
      return autoInitWorktreeOnSpawn;
    },

    setAutoInitWorktreeOnSpawn(value: boolean): void {
      const next = value === true;
      if (autoInitWorktreeOnSpawn === next) return;
      autoInitWorktreeOnSpawn = next;
      scheduleSave();
    },

    getAutoNameSessions(): boolean {
      return autoNameSessions;
    },

    setAutoNameSessions(value: boolean): void {
      const next = value !== false;
      if (autoNameSessions === next) return;
      autoNameSessions = next;
      scheduleSave();
    },

    setDisplayPrefs(partial: PartialDisplayPrefs): DisplayPrefs {
      const base: DisplayPrefs = displayPrefs ?? {
        tokenStatsBar: false,
        contextUsageBar: false,
        reasoning: false,
        toolResults: false,
        turnMetadata: false,
        debugTools: false,
        toolCalls: { read: false, bash: false, edit: false, agent: false, generic: false },
        reasoningAutoCollapseMs: 30000,
        keepReasoningOpenUntilTurnEnds: false,
        toolGroupDefaultCollapsed: false,
        changeSummaryTable: false,
        reserveProcessLineAtIdle: false,
      };
      const merged: DisplayPrefs = {
        tokenStatsBar: partial.tokenStatsBar ?? base.tokenStatsBar,
        contextUsageBar: partial.contextUsageBar ?? base.contextUsageBar,
        reasoning: partial.reasoning ?? base.reasoning,
        toolResults: partial.toolResults ?? base.toolResults,
        turnMetadata: partial.turnMetadata ?? base.turnMetadata,
        debugTools: partial.debugTools ?? base.debugTools,
        toolCalls: { ...base.toolCalls, ...(partial.toolCalls ?? {}) },
        reasoningAutoCollapseMs: partial.reasoningAutoCollapseMs ?? base.reasoningAutoCollapseMs,
        keepReasoningOpenUntilTurnEnds:
          partial.keepReasoningOpenUntilTurnEnds ?? base.keepReasoningOpenUntilTurnEnds,
        toolGroupDefaultCollapsed:
          partial.toolGroupDefaultCollapsed ?? base.toolGroupDefaultCollapsed,
        changeSummaryTable: partial.changeSummaryTable ?? base.changeSummaryTable,
        reserveProcessLineAtIdle:
          partial.reserveProcessLineAtIdle ?? base.reserveProcessLineAtIdle,
      };
      displayPrefs = merged;
      scheduleSave();
      return { ...merged, toolCalls: { ...merged.toolCalls } };
    },

    reorderWorkspaces(ids: string[]): boolean {
      const currentIds = workspaces.map((w) => w.id);
      if (!setEquals(ids, currentIds)) return false;
      if (new Set(ids).size !== ids.length) return false;
      const byId = new Map(workspaces.map((w) => [w.id, w] as const));
      workspaces = ids.map((id) => byId.get(id)!).filter(Boolean) as Workspace[];
      scheduleSave();
      return true;
    },

    flush(): void {
      flushNow();
    },

    dispose(): void {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },
  };
}
