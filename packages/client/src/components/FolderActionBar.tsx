/**
 * Unified action bar for folder groups in the sidebar.
 * Desktop: +Session | +Worktree | Tools dropdown (Terminals, Editor, native editors, Pi Resources)
 * Mobile: +Session | +Worktree (compact, text always visible)
 */
import React from "react";
import { Icon } from "@mdi/react";
import {
  mdiPlus,
  mdiConsoleLine,
  mdiCodeBraces,
  mdiToyBrickOutline,
  mdiOpenInNew,
  mdiAlertCircleOutline,
  mdiCircleSmall,
  mdiFileTree,
} from "@mdi/js";
import type { DetectedEditor } from "../lib/editor-api.js";
import type { EditorInstanceStatus } from "@blackbelt-technology/pi-dashboard-shared/editor-types.js";

interface Props {
  cwd: string;
  terminalCount: number;
  editorStatus?: { id: string; status: EditorInstanceStatus } | null;
  editorAvailable?: boolean;
  nativeEditors: DetectedEditor[];
  spawningDisabled?: boolean;
  onSpawnSession: () => void;
  onSpawnWorktree?: () => void;
  onOpenTerminals: () => void;
  onOpenEditor: () => void;
  onOpenNativeEditor: (editorId: string) => void;
  onOpenPiResources: () => void;
}

const editorIcons: Record<string, string> = {
  zed: "Z",
};

export function FolderActionBar({
  cwd,
  terminalCount,
  editorStatus,
  editorAvailable = true,
  nativeEditors,
  spawningDisabled,
  onSpawnSession,
  onSpawnWorktree,
  onOpenTerminals,
  onOpenEditor,
  onOpenNativeEditor,
  onOpenPiResources,
}: Props) {
  const filteredNativeEditors = nativeEditors.filter((e) => e.id !== "vscode" && e.id !== "code");

  return (
    <div className="flex items-center gap-2">
      {/* +Session */}
      <button
        onClick={(e) => { e.stopPropagation(); onSpawnSession(); }}
        disabled={spawningDisabled}
        data-testid="spawn-session-btn"
        className={`flex items-center gap-1 px-2 md:px-2.5 py-2 md:py-1.5 text-sm md:text-xs font-medium rounded border border-green-500/30 text-green-500 bg-green-500/10 ${
          spawningDisabled ? "opacity-50 cursor-not-allowed" : "hover:bg-green-500/20 active:bg-green-500/20"
        } transition-colors`}
        title="New pi session"
      >
        <Icon path={mdiPlus} size={0.5} /> Session
      </button>

      {/* +Worktree */}
      {onSpawnWorktree && (
        <button
          onClick={(e) => { e.stopPropagation(); onSpawnWorktree(); }}
          disabled={spawningDisabled}
          data-testid="spawn-worktree-btn"
          className={`flex items-center gap-1 px-2 md:px-2.5 py-2 md:py-1.5 text-sm md:text-xs font-medium rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] ${
            spawningDisabled ? "opacity-50 cursor-not-allowed" : "hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-hover)]"
          } transition-colors`}
          title="Spawn session in a git worktree"
        >
          <Icon path={mdiFileTree} size={0.5} /> Worktree
        </button>
      )}

      {/* Tools dropdown — desktop only */}
      <details className="hidden md:block relative ml-auto">
        <summary className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] bg-[var(--bg-surface)] cursor-pointer transition-colors list-none">
          Tools <span className="text-[10px]">▾</span>
        </summary>
        <div className="absolute right-0 top-full mt-1 w-52 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg shadow-lg shadow-[var(--shadow-card)] flex flex-col py-1.5 z-10">
          {/* Terminals */}
          <button
            onClick={(e) => { e.stopPropagation(); onOpenTerminals(); }}
            className="flex items-center justify-between px-3 py-1.5 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <span className="flex items-center gap-2">
              <Icon path={mdiConsoleLine} size={0.55} className="text-[var(--text-tertiary)]" />
              Terminals
            </span>
            <span className="text-[11px] text-[var(--text-secondary)] font-medium">{terminalCount}</span>
          </button>

          {/* Editor */}
          <button
            onClick={(e) => { e.stopPropagation(); onOpenEditor(); }}
            className="flex items-center justify-between px-3 py-1.5 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <span className="flex items-center gap-2">
              <Icon path={mdiCodeBraces} size={0.55} className="text-[var(--text-tertiary)]" />
              Editor
              {editorAvailable === false && (
                <Icon path={mdiAlertCircleOutline} size={0.45} className="text-yellow-400" />
              )}
            </span>
            {editorStatus?.status === "ready" && (
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            )}
            {editorStatus?.status === "starting" && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            )}
          </button>

          {/* Native editors */}
          {filteredNativeEditors.map((editor) => (
            <button
              key={editor.id}
              onClick={(e) => { e.stopPropagation(); onOpenNativeEditor(editor.id); }}
              className="flex items-center justify-between px-3 py-1.5 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <span className="flex items-center gap-2">
                {editorIcons[editor.id] ? (
                  <span className="text-[13px] font-bold text-[var(--text-tertiary)]">{editorIcons[editor.id]}</span>
                ) : (
                  <Icon path={mdiOpenInNew} size={0.55} className="text-[var(--text-tertiary)]" />
                )}
                {editor.name}
              </span>
            </button>
          ))}

          <div className="h-px bg-[var(--border-subtle)] my-1.5 mx-2" />

          {/* Pi Resources */}
          <button
            onClick={(e) => { e.stopPropagation(); onOpenPiResources(); }}
            className="flex items-center justify-between px-3 py-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <span className="flex items-center gap-2">
              <Icon path={mdiToyBrickOutline} size={0.55} className="text-[var(--text-tertiary)]" />
              Pi Resources
            </span>
            <span className="text-[10px] text-[var(--text-tertiary)]">↗</span>
          </button>
        </div>
      </details>
    </div>
  );
}
