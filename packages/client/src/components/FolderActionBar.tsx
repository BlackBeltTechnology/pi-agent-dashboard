/**
 * Unified action bar for folder groups in the sidebar.
 * Buttons: +Session | +Worktree | Terminals(N) | Editor | Zed | Pi Resources
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

  const btn = (disabled: boolean) =>
    `text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] ${
      disabled ? "opacity-50 cursor-not-allowed" : ""
    }`;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* +Session */}
      <button
        onClick={(e) => { e.stopPropagation(); onSpawnSession(); }}
        disabled={spawningDisabled}
        data-testid="spawn-session-btn"
        className={`${btn(!!spawningDisabled)} ${spawningDisabled ? "" : "hover:text-green-400 hover:border-green-500/50"}`}
        title="New pi session"
      >
        <span className="inline-flex items-center gap-0.5">
          <Icon path={mdiPlus} size={0.5} /> Session
        </span>
      </button>

      {/* +Worktree */}
      {onSpawnWorktree && (
        <button
          onClick={(e) => { e.stopPropagation(); onSpawnWorktree(); }}
          disabled={spawningDisabled}
          data-testid="spawn-worktree-btn"
          className={`${btn(!!spawningDisabled)} ${spawningDisabled ? "" : "hover:text-green-400 hover:border-green-500/50"}`}
          title="Spawn session in a git worktree"
        >
          <span className="inline-flex items-center gap-0.5">
            <Icon path={mdiFileTree} size={0.5} /> Worktree
          </span>
        </button>
      )}

      {/* Terminals(N) */}
      <button
        onClick={(e) => { e.stopPropagation(); onOpenTerminals(); }}
        className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-cyan-400 hover:border-cyan-500/50"
        title="Open terminals view"
      >
        <span className="inline-flex items-center gap-0.5">
          <Icon path={mdiConsoleLine} size={0.5} />
          Terminals({terminalCount})
        </span>
      </button>

      {/* Editor */}
      <button
        onClick={(e) => { e.stopPropagation(); onOpenEditor(); }}
        className={`text-[10px] px-1.5 py-0.5 rounded border text-[var(--text-secondary)] ${
          editorStatus?.status === "ready"
            ? "border-green-500/50 text-green-400"
            : editorStatus?.status === "starting"
            ? "border-blue-500/50 text-blue-400"
            : editorAvailable === false
            ? "border-yellow-500/50"
            : "border-[var(--border-secondary)] hover:text-blue-400 hover:border-blue-500/50"
        }`}
        title={editorAvailable === false ? "code-server not found — click to see install guide" : editorStatus?.status === "ready" ? "Editor running — click to open" : editorStatus?.status === "starting" ? "Editor starting..." : "Open VS Code editor"}
      >
        <span className="inline-flex items-center gap-0.5">
          <Icon path={mdiCodeBraces} size={0.5} />
          Editor
          {editorAvailable === false && (
            <Icon path={mdiAlertCircleOutline} size={0.4} className="text-yellow-400" />
          )}
          {editorStatus?.status === "ready" && (
            <Icon path={mdiCircleSmall} size={0.6} className="text-green-500" />
          )}
          {editorStatus?.status === "starting" && (
            <Icon path={mdiCircleSmall} size={0.6} className="text-blue-400 animate-pulse" />
          )}
        </span>
      </button>

      {/* Native editors */}
      {filteredNativeEditors.map((editor) => (
        <button
          key={editor.id}
          onClick={(e) => { e.stopPropagation(); onOpenNativeEditor(editor.id); }}
          className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-blue-400 hover:border-blue-500/50"
          title={`Open in ${editor.name}`}
        >
          <span className="inline-flex items-center gap-0.5">
            {editorIcons[editor.id] ? (
              <span className="text-[10px] font-bold">{editorIcons[editor.id]}</span>
            ) : (
              <Icon path={mdiOpenInNew} size={0.5} />
            )}
            {editor.name}
          </span>
        </button>
      ))}

      {/* Pi Resources */}
      <button
        onClick={(e) => { e.stopPropagation(); onOpenPiResources(); }}
        className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-muted)] hover:text-purple-400 hover:border-purple-500/50"
        title="Pi Resources"
      >
        <Icon path={mdiToyBrickOutline} size={0.5} />
      </button>
    </div>
  );
}
