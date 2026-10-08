/**
 * CardSectionsContext — the server-authoritative session-card section
 * visibility snapshot (`card_sections_updated`, kept in App state by
 * `useMessageHandler`) plus the send/toast sinks the legend menu and the
 * settings pages write through.
 *
 * Absent provider / empty snapshot → every section visible (today's cards).
 * See change: configurable-session-card-sections (design D5, D8).
 */
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import {
  builtinProfileFor,
  type CardSectionPrefs,
  captureFocusProfile,
  type FocusProfile,
  type FolderListMode,
  folderKeyForSession,
  getFolderOverride,
  getGlobalValue,
  isPluginSectionVisible,
  type PluginSectionKind,
  resolveCardSectionVisible,
} from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { createContext, useContext, useMemo } from "react";
import type { ToastAction, ToastVariant } from "../../components/primitives/Toast.js";
import { t as i18nT } from "../i18n/i18n.js";

export interface CardSectionsContextValue {
  prefs: CardSectionPrefs;
  send?: (msg: BrowserToServerMessage) => void;
  /** Live socket present. `false` during a reconnect gap disables writes; absent = assume connected. */
  connected?: boolean;
  showToast?: (text: string, variant?: ToastVariant, opts?: { action?: ToastAction }) => void;
  /** Configured (Focus-off) folder list mode; absent = `classic`. */
  folderListMode?: FolderListMode;
  /** Plugin id → display name for per-plugin settings rows (falls back to the id). */
  pluginNames?: Record<string, string>;
}

const EMPTY: CardSectionsContextValue = { prefs: {} };
const CardSectionsContext = createContext<CardSectionsContextValue>(EMPTY);

export function CardSectionsProvider({
  value,
  children,
}: {
  value: CardSectionsContextValue;
  children: React.ReactNode;
}) {
  return <CardSectionsContext.Provider value={value}>{children}</CardSectionsContext.Provider>;
}

export function useCardSectionPrefs(): CardSectionPrefs {
  return useContext(CardSectionsContext).prefs;
}

/** Resolved visibility of one section on this session's card (worktree → main folder). */
export function useCardSectionVisible(
  session: Pick<DashboardSession, "cwd" | "gitWorktree">,
  id: string,
): boolean {
  const { prefs } = useContext(CardSectionsContext);
  return resolveCardSectionVisible(prefs, folderKeyForSession(session), id);
}

export interface CardSectionActions {
  /** True when a transport is wired AND the socket is live; gates the legend menu + settings controls. */
  canWrite: boolean;
  /** `path` undefined → global default; `null` → inherit. */
  setVisibility(path: string | undefined, section: string, visible: boolean | null): void;
  resetFolder(path: string): void;
  /** Hide in one folder, with an Undo toast restoring the previous override. */
  hideInFolder(path: string, section: string, label: string): void;
  /** Hide globally, with an Undo toast restoring the previous global value. */
  hideEverywhere(section: string, label: string): void;
}

export function useCardSectionActions(): CardSectionActions {
  const { prefs, send, connected, showToast } = useContext(CardSectionsContext);
  return useMemo(() => {
    const setVisibility = (path: string | undefined, section: string, visible: boolean | null) => {
      send?.(
        path === undefined
          ? { type: "set_card_section_visibility", section, visible }
          : { type: "set_card_section_visibility", path, section, visible },
      );
    };
    const withUndo = (text: string, undo: () => void) => {
      showToast?.(text, "info", {
        action: { label: i18nT("common.undo", undefined, "Undo"), onClick: undo },
      });
    };
    return {
      canWrite: send !== undefined && connected !== false,
      setVisibility,
      resetFolder: (path) => send?.({ type: "reset_folder_card_sections", path }),
      hideInFolder: (path, section, label) => {
        // Capture BEFORE the write so Undo restores exactly the prior state.
        const prev = getFolderOverride(prefs, folderKeyForSession({ cwd: path }), section);
        setVisibility(path, section, false);
        withUndo(
          i18nT("cardSections.hiddenInFolder", { section: label }, "{section} hidden in this folder"),
          () => setVisibility(path, section, prev),
        );
      },
      hideEverywhere: (section, label) => {
        const prev = getGlobalValue(prefs, section);
        setVisibility(undefined, section, false);
        withUndo(
          i18nT("cardSections.hiddenEverywhere", { section: label }, "{section} hidden in all folders"),
          () => setVisibility(undefined, section, prev),
        );
      },
    };
  }, [prefs, send, connected, showToast]);
}

/**
 * Per-plugin visibility predicate for a slot kind in one folder. Plugins whose
 * derived section id is invalid (`null`) stay visible. The returned function is
 * stable while prefs/folder are unchanged.
 * See change: add-focus-mode-and-card-block-toggles (design D3).
 */
export function usePluginSectionFilter(kind: PluginSectionKind, folderKey: string | undefined): (pluginId: string) => boolean {
  const { prefs } = useContext(CardSectionsContext);
  return useMemo(
    () => (pluginId: string) => isPluginSectionVisible(prefs, folderKey, kind, pluginId),
    [prefs, kind, folderKey],
  );
}

export function usePluginNames(): Record<string, string> | undefined {
  return useContext(CardSectionsContext).pluginNames;
}

export interface FocusInfo {
  enabled: boolean;
  /** `custom` once a profile is stored; otherwise the built-in profile applies. */
  custom: boolean;
  profile: FocusProfile | undefined;
  /** The configured (Settings) folder list mode — what a profile without one falls back to. */
  configuredListMode: FolderListMode;
}

export function useFocusState(): FocusInfo {
  const { prefs, folderListMode } = useContext(CardSectionsContext);
  return {
    enabled: prefs.focus?.enabled === true,
    custom: prefs.focus?.profile !== undefined,
    profile: prefs.focus?.profile,
    configuredListMode: folderListMode ?? "classic",
  };
}

export interface FocusActions {
  canWrite: boolean;
  setEnabled(enabled: boolean): void;
  /** Snapshot the Focus-off global setup as the focus profile. */
  saveCurrent(offeredIds: readonly string[]): void;
  /** Edit one profile row (`null` = Not set). First edit copies the built-in profile. */
  setRow(id: string, value: boolean | null, offeredIds: readonly string[]): void;
  setFolderListMode(mode: FolderListMode, offeredIds: readonly string[]): void;
  reset(): void;
}

export function useFocusActions(): FocusActions {
  const { prefs, send, connected, folderListMode } = useContext(CardSectionsContext);
  return useMemo(() => {
    const current = (ids: readonly string[]): FocusProfile =>
      prefs.focus?.profile ?? builtinProfileFor(ids);
    return {
      canWrite: send !== undefined && connected !== false,
      setEnabled: (enabled) => send?.({ type: "set_focus_mode", enabled }),
      saveCurrent: (ids) =>
        send?.({ type: "set_focus_profile", profile: captureFocusProfile(prefs, ids, folderListMode ?? "classic") }),
      setRow: (id, value, ids) => {
        const base = current(ids);
        const sections = { ...(base.sections ?? {}) };
        if (value === null) delete sections[id];
        else sections[id] = value;
        send?.({ type: "set_focus_profile", profile: { ...base, sections } });
      },
      setFolderListMode: (mode, ids) =>
        send?.({ type: "set_focus_profile", profile: { ...current(ids), folderListMode: mode } }),
      reset: () => send?.({ type: "set_focus_profile", profile: null }),
    };
  }, [prefs, send, connected, folderListMode]);
}
