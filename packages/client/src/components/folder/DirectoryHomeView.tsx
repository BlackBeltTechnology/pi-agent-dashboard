/**
 * Directory home page for ANY groupable folder, reached via the bare
 * `/folder/:encodedCwd` route. Presents a vertically-centered prompt that, on
 * send, spawns a session in `cwd` with the typed text as `initialPrompt` and
 * (via App's Tier-1 spawn correlation) navigates to the new session.
 *
 * Design decisions (openspec/changes/add-directory-home-page/design.md):
 *  - D2: mounts `CommandInput` in spawn-mode — local draft state, NO
 *    `selectedId`, spawn `onSend` calling `handleSpawnSession(cwd, undefined,
 *    { initialPrompt })` (3-positional; 2nd arg is `attachProposal`).
 *  - D5: no model picker in v1 (spawns with pi's default model).
 *  - D6: navigation is owned by App's `pendingSpawnsRef` correlation.
 *
 * The former pinned-OR-workspace eligibility guard (and its cold-load gate on
 * `pinnedDirectoriesLoaded && workspacesLoaded`) is GONE: every cwd the sidebar
 * can group navigates here, so refusing to draw the page produced a dead end.
 * Organising a folder is an opt-in gesture from the row's icon cluster or the
 * Add Folders dialog, not a toll gate.
 * See change: add-directory-home-page, redesign-folder-workspace-add-flow.
 */
import type { CommandInfo, DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiCog, mdiConsole, mdiFileEdit, mdiFolderOpen } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useRef, useState } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { PopoverBoundaryProvider } from "../../lib/state/PopoverBoundaryContext.js";
import { CommandInput } from "../chat/CommandInput.js";

export interface DirectoryHomeViewProps {
  /** Decoded cwd for this folder route. */
  cwd: string;
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
  sessions,
  commands = [],
  onSpawnSession,
  onSelectSession,
  onOpenTerminals,
  onOpenEditor,
  onOpenSettings,
}: DirectoryHomeViewProps) {
  const { t } = useI18n();
  /**
   * This view's own scroll pane — the clipping boundary for the focal
   * `CommandInput`'s popovers (composer dropdown, model/thinking selectors),
   * which would otherwise measure against the viewport and overflow the pane.
   * See change: fix-popover-pane-bounded-height.
   */
  const paneRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  // A single spawn from this page disables the send control until the page
  // navigates away (design D6 / risk mitigation). Sticky by intent: on success
  // the page unmounts as it navigates to the new session.
  const [spawnInFlight, setSpawnInFlight] = useState(false);

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
    <PopoverBoundaryProvider value={paneRef}>
    <div ref={paneRef} data-testid="directory-home" className="flex-1 flex flex-col min-w-0 min-h-0 overflow-auto">
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
    </PopoverBoundaryProvider>
  );
}
