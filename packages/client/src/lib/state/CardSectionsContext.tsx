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
  type CardSectionPrefs,
  folderKeyForSession,
  getFolderOverride,
  getGlobalValue,
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
  showToast?: (text: string, variant?: ToastVariant, opts?: { action?: ToastAction }) => void;
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
  /** True when a transport is wired (App provider); gates the legend menu. */
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
  const { prefs, send, showToast } = useContext(CardSectionsContext);
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
      canWrite: send !== undefined,
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
  }, [prefs, send, showToast]);
}
