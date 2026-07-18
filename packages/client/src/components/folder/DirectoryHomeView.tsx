/**
 * Directory home page for a PINNED folder, reached via the bare
 * `/folder/:encodedCwd` route. Presents a vertically-centered prompt that, on
 * send, spawns a session in `cwd` with the typed text as `initialPrompt` and
 * (via App's Tier-1 spawn correlation) navigates to the new session.
 *
 * Design decisions (openspec/changes/add-directory-home-page/design.md):
 *  - D2: mounts `CommandInput` in spawn-mode — local draft state, NO
 *    `selectedId`, spawn `onSend` calling `handleSpawnSession(cwd, undefined,
 *    { initialPrompt })` (3-positional; 2nd arg is `attachProposal`).
 *  - D4: pinned guard gated on `pinnedDirectoriesLoaded` — loading skeleton
 *    until the list arrives, "not pinned" notice + pin CTA for non-pinned cwds.
 *  - D5: no model picker in v1 (spawns with pi's default model).
 *  - D6: navigation is owned by App's `pendingSpawnsRef` correlation.
 * See change: add-directory-home-page.
 */
import type { CommandInfo, DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiCog, mdiConsole, mdiFileEdit, mdiFolderOpen } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { CommandInput } from "../chat/CommandInput.js";

export interface DirectoryHomeViewProps {
  /** Decoded cwd for this folder route. */
  cwd: string;
  /** All pinned directories (from the WS snapshot). */
  pinnedDirectories: string[];
  /**
   * True once the pinned-directory snapshot has arrived. Gates the guard so a
   * direct URL / refresh shows a loading state instead of flashing "not
   * pinned" before data loads (design D4 cold-load guard).
   */
  pinnedDirectoriesLoaded: boolean;
  /**
   * Flat set of all workspace-owned folder paths (`workspaces[].folders`). A
   * cwd in this set is eligible for the home page even when not pinned
   * (change: enable-workspace-folder-home-page, design D1).
   */
  workspaceFolders: Set<string>;
  /**
   * True once the workspace snapshot has arrived. Pinned dirs and workspaces
   * arrive in SEPARATE WS messages, so the guard must wait on both flags to
   * avoid flashing the miss notice for a workspace-only cwd (design D3).
   */
  workspacesLoaded: boolean;
  /** Existing sessions whose cwd equals this folder. */
  sessions: DashboardSession[];
  /** Slash commands (optional; v1 has no session context). */
  commands?: CommandInfo[];
  /**
   * `handleSpawnSession`. Called as `(cwd, undefined, { initialPrompt })` —
   * the 2nd arg is `attachProposal`, NOT an options object (design D2).
   */
  onSpawnSession: (
    cwd: string,
    attachProposal?: string,
    opts?: { gitWorktreeBase?: string; placeholderCwd?: string; initialPrompt?: string },
  ) => void;
  /** Select an existing session (navigates to /session/:id). */
  onSelectSession: (id: string) => void;
  /** Pin this cwd (the not-pinned CTA). */
  onPinDirectory?: (cwd: string) => void;
  /** Quick action: open the folder terminals surface. */
  onOpenTerminals?: (cwd: string) => void;
  /** Quick action: open the folder editor surface. */
  onOpenEditor?: (cwd: string) => void;
  /** Quick action: open the folder settings surface. */
  onOpenSettings?: (cwd: string) => void;
}

function folderName(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export function DirectoryHomeView({
  cwd,
  pinnedDirectories,
  pinnedDirectoriesLoaded,
  workspaceFolders,
  workspacesLoaded,
  sessions,
  commands = [],
  onSpawnSession,
  onSelectSession,
  onPinDirectory,
  onOpenTerminals,
  onOpenEditor,
  onOpenSettings,
}: DirectoryHomeViewProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  // A single spawn from this page disables the send control until the page
  // navigates away (design D6 / risk mitigation). Sticky by intent: on success
  // the page unmounts as it navigates to the new session.
  const [spawnInFlight, setSpawnInFlight] = useState(false);

  // Cold-load guard: gate on BOTH loaded flags so a direct URL never flashes
  // the miss notice before either snapshot arrives. Pinned dirs and workspaces
  // land in separate WS messages (design D3 / D4 cold-load guard).
  if (!pinnedDirectoriesLoaded || !workspacesLoaded) {
    return (
      <div
        data-testid="directory-home-loading"
        className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]"
      >
        <div className="text-sm">{t("directoryHome.loading", undefined, "Loading…")}</div>
      </div>
    );
  }

  // Eligibility: a cwd is a valid home page when it is EITHER pinned OR a
  // member folder of some workspace (change: enable-workspace-folder-home-page,
  // design D1). The miss notice covers "neither pinned nor a workspace folder".
  if (!pinnedDirectories.includes(cwd) && !workspaceFolders.has(cwd)) {
    return (
      <div
        data-testid="directory-home-not-pinned"
        className="flex-1 flex items-center justify-center p-6"
      >
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <Icon path={mdiFolderOpen} size={1.6} className="text-[var(--text-muted)]" />
          <div className="text-base font-semibold text-[var(--text-primary)]">
            {t("directoryHome.notPinnedTitle", undefined, "This folder isn't available as a home page")}
          </div>
          <p className="text-sm text-[var(--text-tertiary)]">
            {t(
              "directoryHome.notPinnedBody",
              { path: cwd },
              `Pin ${cwd} to start sessions from its home page.`,
            )}
          </p>
          <button
            type="button"
            data-testid="directory-home-pin-cta"
            onClick={() => onPinDirectory?.(cwd)}
            className="text-sm px-3 py-1.5 rounded border border-blue-500/50 text-blue-400 hover:bg-blue-500/10 transition-colors"
          >
            {t("directoryHome.pinCta", undefined, "Pin this folder")}
          </button>
        </div>
      </div>
    );
  }

  const onSend = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || spawnInFlight) return;
    setSpawnInFlight(true);
    // 3-positional: (cwd, attachProposal=undefined, { initialPrompt }). Passing
    // the options object as the 2nd arg would serialize `[object Object]` as
    // the attach proposal (design D2).
    onSpawnSession(cwd, undefined, { initialPrompt: trimmed });
  };

  return (
    <div data-testid="directory-home" className="flex-1 flex flex-col min-w-0 min-h-0 overflow-auto">
      {/* Vertically-centered focal prompt (design D2). */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6 w-full">
        <div className="flex flex-col items-center gap-2 text-center">
          <Icon path={mdiFolderOpen} size={1.4} className="text-blue-500 opacity-70" />
          <div data-testid="directory-home-header" className="text-lg font-semibold text-[var(--text-primary)]">
            {folderName(cwd)}
          </div>
          <div className="text-xs text-[var(--text-tertiary)] truncate max-w-md">{cwd}</div>
        </div>

        <div data-testid="directory-home-prompt" className="w-full max-w-2xl">
          <CommandInput
            commands={commands}
            onSend={onSend}
            disabled={spawnInFlight}
            draft={draft}
            onDraftChange={setDraft}
            currentCwd={cwd}
          />
        </div>

        {/* Quick actions (design goal: terminals / editor / settings). */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="directory-home-open-terminals"
            onClick={() => onOpenTerminals?.(cwd)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <Icon path={mdiConsole} size={0.6} />
            {t("directoryHome.terminals", undefined, "Terminals")}
          </button>
          <button
            type="button"
            data-testid="directory-home-open-editor"
            onClick={() => onOpenEditor?.(cwd)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <Icon path={mdiFileEdit} size={0.6} />
            {t("directoryHome.editor", undefined, "Editor")}
          </button>
          <button
            type="button"
            data-testid="directory-home-open-settings"
            onClick={() => onOpenSettings?.(cwd)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <Icon path={mdiCog} size={0.6} />
            {t("directoryHome.settings", undefined, "Settings")}
          </button>
        </div>
      </div>

      {/* Existing sessions in this folder. Empty folder → empty list, no
          second onboarding surface (design; F4). */}
      {sessions.length > 0 && (
        <div className="border-t border-[var(--border-subtle)] p-4">
          <div className="text-xs font-medium text-[var(--text-tertiary)] mb-2">
            {t("directoryHome.sessions", { count: sessions.length }, `Sessions (${sessions.length})`)}
          </div>
          <ul data-testid="directory-home-session-list" className="flex flex-col gap-1">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  data-testid={`directory-home-session-${s.id}`}
                  onClick={() => onSelectSession(s.id)}
                  className="w-full text-left text-sm px-3 py-2 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors truncate"
                >
                  {s.name || s.id}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
